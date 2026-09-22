"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.META_INF_RESOURCES = void 0;
exports.findClasspathResource = findClasspathResource;
exports.listClasspathResourcesUnder = listClasspathResourcesUnder;
exports.readClasspathResource = readClasspathResource;
exports.findJarTldFunctions = findJarTldFunctions;
exports.findJarTldTags = findJarTldTags;
exports.findJarTldTagAttributes = findJarTldTagAttributes;
exports.findJarTldTagFileNames = findJarTldTagFileNames;
exports.trackClasspathInvalidation = trackClasspathInvalidation;
const child_process_1 = require("child_process");
const util_1 = require("util");
const vscode = __importStar(require("vscode"));
const javaExtensionGateway_1 = require("./javaExtensionGateway");
const tldParsing_1 = require("./tldParsing");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
// Exported so classpathResourceContentProvider.ts -- which reconstructs an
// entry name from a webapp-relative path the opposite direction this module
// strips it -- shares the exact same literal rather than an independently
// declared copy of it.
exports.META_INF_RESOURCES = 'META-INF/resources';
const MAX_BUFFER = 10 * 1024 * 1024;
/**
 * Shared by `getResourceIndex`/`getJarTldIndex`: `java.project.getClasspaths` is as
 * jdtls-dependent as workspace symbol search (see `javaExtensionGateway.isReady()`), but
 * unlike a class lookup this result gets memoized in `cache` for the rest of the session --
 * caching an empty index from a too-early call would mean every dependency-shipped
 * include/tag/TLD reads as broken until the next full window reload, with no self-correction
 * once jdtls actually finishes indexing. So: don't memoize (or even build, via `build`) the
 * index for `key` until the server is ready -- and even once it is, don't keep an empty result
 * (see the `.then` below): `isReady()` only means jdtls is accepting requests, not that its own
 * classpath resolution for every module has actually settled yet, so the very first build to run
 * right as readiness flips can still land in that gap and come back empty. A real module always
 * ships *something* here in practice (a real dependency jar's `META-INF/`), so an empty result this
 * early is far more likely "hasn't settled yet" than "genuinely nothing" -- worth a wasted rebuild
 * on the next lookup to find out, rather than freezing a wrong empty answer for the rest of the
 * session with no way to self-correct.
 */
function memoizeUntilReady(cache, key, build) {
    if (!javaExtensionGateway_1.javaExtensionGateway.isReady()) {
        return Promise.resolve(new Map());
    }
    let index = cache.get(key);
    if (!index) {
        index = build(key);
        cache.set(key, index);
    }
    return index.then((result) => {
        // Same reasoning as `getKnownProjectRoots`'s own guard: `isReady()` only means jdtls is accepting
        // requests, not that `java.project.getClasspaths` has settled for every module yet. The *first*
        // build to run right as readiness flips can land in that gap and come back with too few (or zero)
        // jars -- previously cached here forever, meaning a dependency-shipped include/tag/TLD read as
        // permanently unresolved for the rest of the session with no way to self-correct. An empty result
        // falls back out of the cache instead, so the next lookup retries against the real classpath.
        if (result.size === 0) {
            cache.delete(key);
        }
        return result;
    });
}
/**
 * Any classpath jar can ship webapp content under `META-INF/resources/` --
 * a Servlet 3.0+ container transparently merges that tree into the webapp
 * root at runtime (this is how Supermodel ships shared admin fragments/tags
 * without them ever being files in this workspace). This module asks the
 * Java extension for a project's actual runtime classpath, then indexes
 * those jars' `META-INF/resources/` entries so includes/tag files backed by
 * a dependency, not a workspace file, can still be resolved.
 */
// moduleRoot fsPath -> Promise<Map<webAppRelativePath, jarPath>>, built once
// per module and kept until that module's classpath actually changes (see
// invalidateModule / trackClasspathInvalidation below) -- a resolved
// dependency jar's content is immutable for a given path in ~/.m2, so the
// entry only needs rebuilding when the *set* of jars changes, not on a timer.
const resourceIndexByModuleRoot = new Map();
/**
 * jdtls's own live list of every project root it actually has imported (`java.project.getAll`,
 * the same `java.execute.workspaceCommand` delegation `getRuntimeClasspathJars` already uses for
 * `java.project.getClasspaths`). A `moduleRootOf(...)`-derived path can point anywhere a `pom.xml`
 * happens to exist -- a duplicate checkout, a stray module the workspace happens to contain,
 * anything -- and this extension has no way to predict in advance, for an arbitrary project on an
 * arbitrary machine, which of those jdtls actually imported: there's no directory-naming convention
 * ("build output", "a worktree", ...) that generalizes across every project this extension might run
 * against. Asking jdtls directly what it actually knows about is the one answer that's always
 * correct, since it's the same information `java.project.getClasspaths` itself would otherwise fail
 * on. Cached like the per-module indexes below and invalidated by the same trigger.
 */
let knownProjectRoots;
async function getKnownProjectRoots() {
    if (!knownProjectRoots) {
        knownProjectRoots = javaExtensionGateway_1.javaExtensionGateway
            .execute('java.execute.workspaceCommand', 'java.project.getAll')
            .then((uris) => new Set((uris ?? []).map((uri) => (0, javaExtensionGateway_1.moduleRootFromUri)(vscode.Uri.parse(uri)))));
    }
    const roots = await knownProjectRoots;
    // `javaExtensionGateway.isReady()` only means jdtls is accepting requests, not that its project
    // import has actually finished settling for every root -- `java.project.getAll` coming back empty
    // this soon after "ready" fires (as opposed to some later, genuine "no projects" state, which can't
    // happen for an open multi-module workspace) means it hasn't caught up yet, not that there truly are
    // no projects. Caching that would permanently starve `getRuntimeClasspathJars` for every module for
    // the rest of the session -- same reasoning as `memoizeUntilReady`'s own guard below, one level up
    // the same call chain. Fall back out of the cache so the next lookup retries instead of freezing this.
    if (roots.size === 0) {
        knownProjectRoots = undefined;
    }
    return roots;
}
async function getRuntimeClasspathJars(moduleRoot) {
    const knownRoots = await getKnownProjectRoots();
    if (!knownRoots.has(moduleRoot)) {
        // Not a failure -- jdtls simply never imported this path as a project, so asking it for
        // classpaths would only reproduce the exact "Launch configuration ... references non-existing
        // project" error it throws for that case. Skip the round trip entirely rather than let
        // javaExtensionGateway log a failure that was never really in question.
        return [];
    }
    const projectUri = vscode.Uri.file(moduleRoot).toString();
    const result = await javaExtensionGateway_1.javaExtensionGateway.execute('java.execute.workspaceCommand', 'java.project.getClasspaths', projectUri, JSON.stringify({ scope: 'runtime' }));
    const paths = [...(result?.classpaths ?? []), ...(result?.modulepaths ?? [])];
    return paths.filter((entry) => entry.toLowerCase().endsWith('.jar'));
}
// zipinfo-style listing restricted to the one directory we care about, so we
// never pay the cost of reading a jar's full (often much larger) class-file listing.
async function listResourceEntries(jarPath) {
    try {
        const { stdout } = await execFileAsync('unzip', ['-Z1', jarPath, `${exports.META_INF_RESOURCES}/*`], {
            maxBuffer: MAX_BUFFER,
        });
        return stdout
            .split('\n')
            .map((line) => line.trim())
            // Directory entries (e.g. "META-INF/resources/WEB-INF/") aren't resources themselves.
            .filter((line) => line && !line.endsWith('/'));
    }
    catch {
        // `unzip -Z1` exits non-zero when nothing matches the pattern -- that's
        // "this jar has no META-INF/resources", not a real error.
        return [];
    }
}
async function buildResourceIndex(moduleRoot) {
    const jars = await getRuntimeClasspathJars(moduleRoot);
    const index = new Map();
    const CONCURRENCY = 8;
    for (let i = 0; i < jars.length; i += CONCURRENCY) {
        const batch = jars.slice(i, i + CONCURRENCY);
        const listings = await Promise.all(batch.map(listResourceEntries));
        batch.forEach((jarPath, batchIndex) => {
            for (const entry of listings[batchIndex]) {
                const webAppRelativePath = entry.slice(exports.META_INF_RESOURCES.length);
                // Classpath order determines which jar "wins" a given resource path
                // at runtime too, so keep only the first (earliest) jar we see it in.
                if (webAppRelativePath && !index.has(webAppRelativePath)) {
                    index.set(webAppRelativePath, jarPath);
                }
            }
        });
    }
    return index;
}
function getResourceIndex(moduleRoot) {
    return memoizeUntilReady(resourceIndexByModuleRoot, moduleRoot, buildResourceIndex);
}
/**
 * Resolves a webapp-root-relative path (e.g. "/WEB-INF/foo.jspf") to the
 * classpath jar that supplies it via `META-INF/resources`, if any.
 */
async function findClasspathResource(moduleRoot, webAppRelativePath) {
    const index = await getResourceIndex(moduleRoot);
    return index.get(webAppRelativePath);
}
/**
 * Lists every resource path under `directoryPrefix` (e.g. a `tagdir`) that a
 * classpath jar supplies via `META-INF/resources` -- the counterpart to
 * `findClasspathResource` for listing a whole directory (e.g. for tag-*name*
 * completion) rather than resolving one exact path. The per-module index is
 * already built in full rather than scoped to one lookup, so this is just an
 * in-memory filter over it, not a new scan.
 */
async function listClasspathResourcesUnder(moduleRoot, directoryPrefix) {
    const index = await getResourceIndex(moduleRoot);
    const prefix = directoryPrefix.endsWith('/') ? directoryPrefix : `${directoryPrefix}/`;
    return Array.from(index.keys()).filter((path) => path.startsWith(prefix));
}
/** Reads a single entry's content out of a jar (e.g. for a virtual-document read-only preview). */
async function readClasspathResource(jarPath, entryName) {
    try {
        const { stdout } = await execFileAsync('unzip', ['-p', jarPath, entryName], {
            encoding: 'utf8',
            maxBuffer: MAX_BUFFER,
        });
        return stdout;
    }
    catch (error) {
        console.error(`[vscode-jsp-linker] failed to read "${entryName}" from "${jarPath}":`, error);
        return undefined;
    }
}
/**
 * A tag library jar (JSTL, Supermodel's `sm:`, the Cactuslab `wp:`/`input:`
 * libraries, ...) ships its `.tld`(s) somewhere under `META-INF/`, auto
 * -registered by the container under the URI each TLD declares in its own
 * `<uri>` element -- there's no central manifest to consult, so every jar's
 * `META-INF/` has to be listed. Same per-module caching (and invalidation)
 * approach as the `META-INF/resources` index above.
 */
// moduleRoot fsPath -> Promise<Map<taglib uri, ParsedTld>>
const jarTldIndexByModuleRoot = new Map();
async function listTldEntries(jarPath) {
    try {
        const { stdout } = await execFileAsync('unzip', ['-Z1', jarPath, 'META-INF/*.tld', 'META-INF/**/*.tld'], {
            maxBuffer: MAX_BUFFER,
        });
        return stdout.split('\n').map((line) => line.trim()).filter(Boolean);
    }
    catch {
        // `unzip -Z1` exits non-zero when nothing matches the pattern -- this
        // jar just doesn't bundle any TLDs.
        return [];
    }
}
async function buildJarTldIndex(moduleRoot) {
    const jars = await getRuntimeClasspathJars(moduleRoot);
    const index = new Map();
    const CONCURRENCY = 8;
    for (let i = 0; i < jars.length; i += CONCURRENCY) {
        const batch = jars.slice(i, i + CONCURRENCY);
        const listings = await Promise.all(batch.map(listTldEntries));
        await Promise.all(batch.map(async (jarPath, batchIndex) => {
            for (const entry of listings[batchIndex]) {
                const text = await readClasspathResource(jarPath, entry);
                const parsed = text ? (0, tldParsing_1.parseTld)(text) : undefined;
                // Classpath order determines which jar "wins" a given uri at
                // runtime too, so keep only the first (earliest) jar we see it in.
                if (parsed?.declaredUri && !index.has(parsed.declaredUri)) {
                    index.set(parsed.declaredUri, parsed);
                }
            }
        }));
    }
    return index;
}
function getJarTldIndex(moduleRoot) {
    return memoizeUntilReady(jarTldIndexByModuleRoot, moduleRoot, buildJarTldIndex);
}
/**
 * Resolves the EL functions declared by the TLD bound to `uri`, if that TLD
 * is bundled inside one of the owning module's runtime-classpath jars
 * rather than a workspace file.
 */
async function findJarTldFunctions(moduleRoot, uri) {
    const index = await getJarTldIndex(moduleRoot);
    return index.get(uri)?.functions;
}
/**
 * Resolves the Java-class-backed `<tag>` entries declared by the TLD bound
 * to `uri` (tag name -> `<tag-class>` FQCN), if that TLD is bundled inside
 * one of the owning module's runtime-classpath jars -- e.g. JSTL `c:`/`fmt:`
 * or Supermodel's `sm:` taglib.
 */
async function findJarTldTags(moduleRoot, uri) {
    const index = await getJarTldIndex(moduleRoot);
    return index.get(uri)?.tags;
}
/**
 * Resolves the per-tag `<attribute>` declarations for the TLD bound to
 * `uri` (tag name -> its declared attribute names / dynamic-attributes
 * flag), if that TLD is bundled inside one of the owning module's
 * runtime-classpath jars.
 */
async function findJarTldTagAttributes(moduleRoot, uri) {
    const index = await getJarTldIndex(moduleRoot);
    return index.get(uri)?.tagAttributes;
}
/**
 * Resolves the `<tag-file>` entries' names declared by the TLD bound to
 * `uri` (the counterpart to `findJarTldTags` for a tag supplied via a
 * packaged `.tag` resource rather than a Java class), if that TLD is
 * bundled inside one of the owning module's runtime-classpath jars.
 */
async function findJarTldTagFileNames(moduleRoot, uri) {
    const index = await getJarTldIndex(moduleRoot);
    return index.get(uri)?.tagFileNames;
}
/**
 * Drops both per-module caches for `moduleRoot`, so the next lookup rebuilds them rather than
 * serving a stale (or, per `trackClasspathInvalidation`'s own doc, possibly still-empty) one for
 * the rest of the session. Also drops `knownProjectRoots` -- shared by both of
 * `trackClasspathInvalidation`'s two triggers below, since a newly-imported or newly-changed
 * project is the same kind of event either way: something this module cached about it may no
 * longer be accurate.
 */
function invalidateModule(moduleRoot) {
    resourceIndexByModuleRoot.delete(moduleRoot);
    jarTldIndexByModuleRoot.delete(moduleRoot);
    knownProjectRoots = undefined;
}
/**
 * Subscribes to two distinct jdtls signals, both meaning "this module's classpath data may have
 * changed since it was last cached here" -- `onInvalidate` (with the module root) runs the same way
 * for either:
 *  - `onDidClasspathUpdate`: a later, mid-session change, e.g. a `pom.xml` dependency getting
 *    reimported.
 *  - `onDidProjectsImport`: jdtls actually finishing that project's *initial* import -- the genuine
 *    "safe to ask now" signal `javaExtensionGateway.trackReadiness`'s `isReady()` latch can't
 *    provide on its own. `isReady()` only means the server process itself has started, and can go
 *    true well before every project's `java.project.getClasspaths` data has actually settled (see
 *    `memoizeUntilReady`/`getKnownProjectRoots` above): a lookup landing in that gap discards its
 *    own empty result, exactly as if the classpath had changed underneath it, but until this event
 *    existed nothing ever told `extension.ts` it was safe to look again -- a document opened before
 *    the gap closed would stay unrevalidated for the rest of the session with no further signal
 *    (not even a stale cache -- there wasn't one to invalidate). Subscribing here means
 *    `extension.ts`'s existing `trackClasspathInvalidation(validateAllOpen)` call re-validates open
 *    documents for both triggers without needing to know that there are two.
 */
function trackClasspathInvalidation(onInvalidate) {
    javaExtensionGateway_1.javaExtensionGateway.onClasspathUpdate((moduleRoot) => {
        invalidateModule(moduleRoot);
        onInvalidate(moduleRoot);
    });
    javaExtensionGateway_1.javaExtensionGateway.onProjectsImported((moduleRoot) => {
        invalidateModule(moduleRoot);
        onInvalidate(moduleRoot);
    });
}
//# sourceMappingURL=classpathResources.js.map