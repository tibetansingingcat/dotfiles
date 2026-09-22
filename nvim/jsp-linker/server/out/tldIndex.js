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
exports.TldIndex = void 0;
const vscode = __importStar(require("vscode"));
const classpathResources_1 = require("./classpathResources");
const webAppPaths_1 = require("./webAppPaths");
const tldParsing_1 = require("./tldParsing");
const jspScan_1 = require("./jspScan");
const settings_1 = require("./settings");
// Matches both `<%@ taglib prefix="x" uri="y" %>` and `<%@ taglib prefix="x" tagdir="y" %>`.
const TAGLIB_DIRECTIVE = /<%@\s*taglib\s+([^%]+?)%>/g;
const PREFIX_ATTR = /prefix\s*=\s*"([^"]+)"/;
const URI_ATTR = /uri\s*=\s*"([^"]+)"/;
const TAGDIR_ATTR = /tagdir\s*=\s*"([^"]+)"/;
const WEB_INF_SEGMENT = '/WEB-INF/';
const COMPILER_RECOGNIZED_EL_FUNCTIONS_SETTING = 'vscode-jsp-linker.compilerRecognizedElFunctions';
// The JSP spec reserves this prefix for the standard actions (`<jsp:useBean>`, `<jsp:include>`,
// `<jsp:setProperty>`, ...) -- it's implicitly bound by the container itself, the same way the
// `http://java.sun.com/JSP/Page` XML namespace is implicit in a JSP document, so no `<%@ taglib %>`
// directive ever exists (or could exist) for it. `checkTagUsage` is the only place this matters --
// see its own comment.
const RESERVED_STANDARD_ACTION_PREFIX = 'jsp';
/**
 * True when `documentText` declares `xmlns:prefix="..."` somewhere -- e.g. `xmlns:atom=` on an RSS
 * feed JSP's own `<rss>` tag, so `<atom:link>` renders as literal Atom-namespaced XML in the
 * response, or `xmlns:v=` on a VML `<v:rect>` in an email fragment. This is never a `<%@ taglib %>`
 * binding -- there's no tag library behind it, just a namespace declaration for the *generated*
 * document -- so the JSP container doesn't recognize `<prefix:tag>` as a custom action at all in
 * this case; it passes straight through as static template text, exactly as intended. `checkTagUsage`
 * uses this to tell that apart from an actually-unbound (typo'd) prefix. Scoped to `documentText`
 * only, not the include chain `resolvePrefix` walks: every instance of this pattern in this codebase
 * declares the namespace on an element in the same file that uses it.
 */
function declaresXmlNamespace(documentText, prefix) {
    return new RegExp(`\\bxmlns:${prefix}\\s*=`).test(documentText);
}
function webAppRelativePathOf(uri) {
    const index = uri.path.indexOf(WEB_INF_SEGMENT);
    return index === -1 ? undefined : uri.path.slice(index);
}
/**
 * Indexes every JSP TLD in the workspace (EL function -> {class, method}), so
 * EL function calls like `lfn:checkCapability(...)` and custom tags like
 * `<my:avatar>` can be resolved without a full JSP/EL parser. Taglib prefix
 * bindings themselves aren't pre-indexed here -- see `resolvePrefix`, which
 * walks each document's actual `<%@include%>` chain on demand, caching each
 * included fragment's own directives by path (`fragmentBindingsCache`) so a
 * fragment shared by many documents (this codebase's own
 * `WEB-INF/**\/global.jspf`, or any other shared fragment) is only parsed
 * once per session rather than once per document that includes it.
 */
class TldIndex {
    uriToTld = new Map();
    fragmentBindingsCache = new Map();
    async build() {
        this.uriToTld.clear();
        this.fragmentBindingsCache.clear();
        const tldFiles = await vscode.workspace.findFiles('**/WEB-INF/**/*.tld', (0, settings_1.getExcludeGlob)());
        for (const uri of tldFiles) {
            await this.indexTld(uri);
        }
    }
    /**
     * Drops every cached fragment's own parsed `<%@ taglib %>` directives (see
     * `fragmentBindingsOf`) without re-scanning workspace `.tld` files -- the cheap counterpart to
     * `build()` for a `.jsp`/`.jspf` change, which can only ever affect a fragment's own bindings,
     * never the `.tld` index. `build()` itself already does this as part of a full rebuild; this
     * exists so a plain fragment edit doesn't pay for re-globbing and re-parsing every `.tld` in the
     * workspace too.
     */
    clearFragmentBindingsCache() {
        this.fragmentBindingsCache.clear();
    }
    async indexTld(uri) {
        const doc = await vscode.workspace.openTextDocument(uri);
        const parsed = (0, tldParsing_1.parseTld)(doc.getText());
        // A `<%@ taglib uri="..." %>` directive can reference a TLD either by
        // the logical URI the TLD declares in its own <uri> element, or by a
        // direct webapp-relative path to the .tld file itself (both are valid
        // per the JSP spec) -- e.g. functions.tld declares
        // <uri>https://letterboxd.com/jstl/functions</uri>, but this codebase's
        // global.jspf actually binds `lfn` via uri="/WEB-INF/functions.tld".
        // Index under both so either style of directive resolves.
        if (parsed.declaredUri) {
            this.uriToTld.set(parsed.declaredUri, parsed);
        }
        const webAppRelativePath = webAppRelativePathOf(uri);
        if (webAppRelativePath) {
            this.uriToTld.set(webAppRelativePath, parsed);
        }
    }
    indexTaglibDirectives(text, intoUri, intoTagdir) {
        let directive;
        TAGLIB_DIRECTIVE.lastIndex = 0;
        while ((directive = TAGLIB_DIRECTIVE.exec(text)) !== null) {
            const attrs = directive[1];
            const prefix = PREFIX_ATTR.exec(attrs)?.[1];
            if (!prefix) {
                continue;
            }
            const uri = URI_ATTR.exec(attrs)?.[1];
            const tagdir = TAGDIR_ATTR.exec(attrs)?.[1];
            if (uri) {
                intoUri.set(prefix, uri);
            }
            if (tagdir) {
                intoTagdir.set(prefix, tagdir);
            }
        }
    }
    /**
     * Functions for a taglib URI, checking the workspace TLD index first and,
     * on a miss, falling back to TLDs bundled inside the owning module's
     * runtime-classpath jars (e.g. JSTL `fn:` or the Supermodel `sm:` taglib,
     * whose TLDs ship inside a dependency jar rather than as a workspace
     * file -- see `classpathResources.findJarTldFunctions`).
     */
    async functionsForUri(uri, documentUri) {
        const workspaceFunctions = this.uriToTld.get(uri)?.functions;
        if (workspaceFunctions) {
            return workspaceFunctions;
        }
        const moduleRoot = await (0, webAppPaths_1.moduleRootOf)(documentUri.fsPath);
        return moduleRoot ? (0, classpathResources_1.findJarTldFunctions)(moduleRoot, uri) : undefined;
    }
    /** Same idea as `functionsForUri`, but for Java-class-backed `<tag>` entries. */
    async tagsForUri(uri, documentUri) {
        const workspaceTags = this.uriToTld.get(uri)?.tags;
        if (workspaceTags) {
            return workspaceTags;
        }
        const moduleRoot = await (0, webAppPaths_1.moduleRootOf)(documentUri.fsPath);
        return moduleRoot ? (0, classpathResources_1.findJarTldTags)(moduleRoot, uri) : undefined;
    }
    /** Same idea as `functionsForUri`, but for each `<tag>` entry's `<attribute>` declarations. */
    async tagAttributesForUri(uri, documentUri) {
        const workspaceTagAttributes = this.uriToTld.get(uri)?.tagAttributes;
        if (workspaceTagAttributes) {
            return workspaceTagAttributes;
        }
        const moduleRoot = await (0, webAppPaths_1.moduleRootOf)(documentUri.fsPath);
        return moduleRoot ? (0, classpathResources_1.findJarTldTagAttributes)(moduleRoot, uri) : undefined;
    }
    /** Same idea as `functionsForUri`, but for `<tag-file>` entries' names -- the counterpart to
     * `tagsForUri` for a taglib that supplies a tag via a packaged `.tag` resource instead of a
     * Java class. Only used to check a tag *name* exists (see `checkTagUsage`); there's no
     * attribute list behind a `<tag-file>` entry to also resolve, unlike `tagsForUri`. */
    async tagFileNamesForUri(uri, documentUri) {
        const workspaceTagFileNames = this.uriToTld.get(uri)?.tagFileNames;
        if (workspaceTagFileNames) {
            return workspaceTagFileNames;
        }
        const moduleRoot = await (0, webAppPaths_1.moduleRootOf)(documentUri.fsPath);
        return moduleRoot ? (0, classpathResources_1.findJarTldTagFileNames)(moduleRoot, uri) : undefined;
    }
    /**
     * The fragment file at `uri`'s own `<%@ taglib %>` directives -- cached by Uri so a fragment
     * included by many documents (e.g. a `global.jspf`-style shared fragment) is only opened and
     * parsed once per session, not once per including document per lookup.
     */
    async fragmentBindingsOf(uri) {
        const key = uri.toString();
        const cached = this.fragmentBindingsCache.get(key);
        if (cached) {
            return cached;
        }
        const doc = await vscode.workspace.openTextDocument(uri);
        const text = doc.getText();
        const prefixToUri = new Map();
        const prefixToTagdir = new Map();
        this.indexTaglibDirectives(text, prefixToUri, prefixToTagdir);
        const bindings = { text, prefixToUri, prefixToTagdir };
        this.fragmentBindingsCache.set(key, bindings);
        return bindings;
    }
    /**
     * Resolves what `prefix` is bound to (a taglib `uri` or tag-file `tagdir`), given the text and
     * Uri of the JSP file it's used in. A prefix isn't necessarily bound by a directive in the
     * document itself -- per the JSP spec, `<%@include file="...">` is a translation-time text
     * merge, so a `<%@ taglib %>` directive in any file reached through a chain of such includes is
     * just as much in scope as one written directly in the document. (`<jsp:include page="...">` is
     * different: a request-time dispatch to a separately-compiled page with its own independent
     * scope, so it's deliberately *not* followed here -- see `IncludePathUsage.kind`.) So this
     * checks the document's own directives first (closest scope wins, matching how a real JSP
     * compiler would resolve a prefix redeclared at multiple levels), then walks its static include
     * chain depth-first. There's no special case for any particular fragment filename (this used to
     * hardcode `global.jspf`, which only happened to work because that's the one fragment nearly
     * every JSP in this codebase includes -- other shared fragments bind prefixes the exact same
     * way and were silently missed).
     */
    async resolvePrefix(documentText, documentUri, prefix) {
        const localPrefixToUri = new Map();
        const localPrefixToTagdir = new Map();
        this.indexTaglibDirectives(documentText, localPrefixToUri, localPrefixToTagdir);
        if (localPrefixToUri.has(prefix) || localPrefixToTagdir.has(prefix)) {
            return { uri: localPrefixToUri.get(prefix), tagdir: localPrefixToTagdir.get(prefix) };
        }
        return this.resolvePrefixViaIncludes(documentText, documentUri, prefix, new Set([documentUri.toString()]));
    }
    /**
     * The include-walking half of `resolvePrefix`: checks each statically-included fragment's own
     * bindings, then recurses into *its* includes, depth-first in source order (the first directive
     * that binds `prefix` anywhere in the chain wins, same as a real translation unit). `visited`
     * guards against a fragment include cycle re-entering itself forever -- keyed by resolved Uri
     * rather than raw include path, since two different paths (e.g. a file-relative one and a
     * webapp-root-relative one) can resolve to the same file.
     */
    async resolvePrefixViaIncludes(text, fromUri, prefix, visited) {
        for (const usage of (0, jspScan_1.findAllIncludePaths)(text)) {
            if (usage.kind !== 'directive') {
                continue;
            }
            const location = await (0, webAppPaths_1.resolveIncludePath)(fromUri, usage.path);
            if (!location) {
                continue;
            }
            const key = location.uri.toString();
            if (visited.has(key)) {
                continue;
            }
            visited.add(key);
            const fragment = await this.fragmentBindingsOf(location.uri);
            if (fragment.prefixToUri.has(prefix) || fragment.prefixToTagdir.has(prefix)) {
                return { uri: fragment.prefixToUri.get(prefix), tagdir: fragment.prefixToTagdir.get(prefix) };
            }
            const fromNested = await this.resolvePrefixViaIncludes(fragment.text, location.uri, prefix, visited);
            if (fromNested) {
                return fromNested;
            }
        }
        return undefined;
    }
    /**
     * Resolves `prefix:functionName` to its backing Java class/method, given
     * the text and Uri of the JSP file the call appears in.
     */
    async resolveFunction(documentText, documentUri, prefix, functionName) {
        const uri = (await this.resolvePrefix(documentText, documentUri, prefix))?.uri;
        if (!uri) {
            return undefined;
        }
        const functions = await this.functionsForUri(uri, documentUri);
        return functions?.get(functionName);
    }
    /**
     * Looks up `prefix:functionName` in `vscode-jsp-linker.compilerRecognizedElFunctions` (see
     * `CompilerRecognizedElFunctionConfig`). Shared by `checkFunctionCall` (to exempt these from
     * the unbound-prefix error below) and `describeCompilerRecognizedFunction` (hover text),
     * rather than each re-reading and re-searching the setting independently.
     */
    findCompilerRecognizedFunction(prefix, functionName) {
        const configs = vscode.workspace
            .getConfiguration()
            .get(COMPILER_RECOGNIZED_EL_FUNCTIONS_SETTING, []);
        return configs.find((c) => c.function === `${prefix}:${functionName}`);
    }
    /** Hover-facing counterpart to `findCompilerRecognizedFunction` -- just the description, if any. */
    describeCompilerRecognizedFunction(prefix, functionName) {
        return this.findCompilerRecognizedFunction(prefix, functionName)?.description;
    }
    /**
     * Distinguishes four cases for `prefix:functionName(...)`, only two of which are worth a
     * diagnostic:
     *  - `'unbound-prefix'`: no `<%@ taglib %>` directive anywhere in scope (see `resolvePrefix`)
     *    binds this prefix to anything, *and* it isn't declared in `compilerRecognizedElFunctions`
     *    either -- there's nothing that could ever make this call work, so this is as deterministic
     *    a typo as `'unknown-function'` below and is reported the same way.
     *  - `'compiler-recognized'`: same as above, except the prefix:function pair *is* declared in
     *    `compilerRecognizedElFunctions` -- expected, deliberately unlinkable, not a typo.
     *  - `'unresolved-taglib'`: the prefix *is* bound to a real taglib uri, but that taglib's TLD
     *    couldn't be found (workspace or classpath jar) -- can't tell "still indexing" from a real,
     *    lasting gap, so `LinkDiagnostics.checkElFunctionCalls` abstains here exactly like
     *    `checkClassReferences` already does for Java class references, rather than guess wrong.
     *    `javaExtensionGateway.trackReadiness(validateAllOpen)` redoes this once the classpath
     *    genuinely settles -- see `classpathResources.ts`'s own caching fix for why that's reliable.
     *  - `'unknown-function'`: the taglib *is* indexed and declares no such function -- an actual
     *    typo.
     */
    async checkFunctionCall(documentText, documentUri, prefix, functionName) {
        const uri = (await this.resolvePrefix(documentText, documentUri, prefix))?.uri;
        if (!uri) {
            return this.findCompilerRecognizedFunction(prefix, functionName) ? 'compiler-recognized' : 'unbound-prefix';
        }
        const functions = await this.functionsForUri(uri, documentUri);
        if (!functions) {
            return 'unresolved-taglib';
        }
        return functions.has(functionName) ? 'resolved' : 'unknown-function';
    }
    /**
     * Resolves `<prefix:tagName>` to the webapp-relative path of the tag file
     * backing it (e.g. `my:avatar` -> `/WEB-INF/tags/avatar.tag`), given the
     * text and Uri of the JSP file the tag is used in.
     */
    async resolveTagFile(documentText, documentUri, prefix, tagName) {
        const tagdir = (await this.resolvePrefix(documentText, documentUri, prefix))?.tagdir;
        return tagdir ? `${tagdir}/${tagName}.tag` : undefined;
    }
    /**
     * Resolves `<prefix:tagName>` to the FQCN of the Java tag-handler class
     * backing it, for taglibs bound via `uri` rather than `tagdir` (JSTL
     * `c:`/`fmt:`, Supermodel `sm:`, ...) -- the counterpart to
     * `resolveTagFile` for tags that aren't `.tag` files. Only covers
     * Java-class-backed `<tag>` entries; a taglib can also supply a tag via a
     * `<tag-file>` entry pointing at a packaged `.tag` resource, which isn't
     * parsed here and so won't resolve (see README known limitations).
     */
    async resolveTagClass(documentText, documentUri, prefix, tagName) {
        const uri = (await this.resolvePrefix(documentText, documentUri, prefix))?.uri;
        if (!uri) {
            return undefined;
        }
        const tags = await this.tagsForUri(uri, documentUri);
        return tags?.get(tagName);
    }
    /**
     * Checks whether `<prefix:tagName>` refers to an entry -- either a
     * Java-class-backed `<tag>` or a `<tag-file>` -- the resolved `uri`-bound
     * taglib actually declares. Same four-way shape as `checkFunctionCall`, for
     * the same reason, and previously collapsed into one `'unchecked'` case --
     * this now distinguishes them exactly as `checkFunctionCall` already does:
     *  - `'unbound-prefix'`: no `<%@ taglib %>` directive anywhere in scope
     *    (see `resolvePrefix`) binds this prefix to anything. Unlike an EL function
     *    call, a custom tag has no `compilerRecognizedElFunctions`-style
     *    escape hatch -- the JSP spec requires a taglib directive to use
     *    `<prefix:tagName>` at all, so an unbound prefix here is exactly as
     *    deterministic a typo as `'unknown-tag'` below, not a coverage gap.
     *  - `'unresolved-taglib'`: the prefix *is* bound to a real taglib uri, but
     *    that taglib's TLD couldn't be found (workspace or classpath jar) --
     *    can't tell "still indexing" from a real, lasting gap, so
     *    `LinkDiagnostics.checkCustomTags` abstains here exactly like
     *    `checkClassReferences` already does for Java class references, rather
     *    than guess wrong. `javaExtensionGateway.trackReadiness(validateAllOpen)`
     *    redoes this once the classpath genuinely settles -- see
     *    `classpathResources.ts`'s own caching fix for why that's reliable.
     *  - `'unknown-tag'`: the taglib *is* indexed and declares neither a
     *    `<tag>` nor a `<tag-file>` by this name -- an actual typo.
     *  - `'reserved-prefix'`: `prefix` is `jsp`, the JSP spec's own reserved
     *    prefix for standard actions (`<jsp:useBean>`, `<jsp:include>`, ...) --
     *    see `RESERVED_STANDARD_ACTION_PREFIX`. Never bound by a taglib
     *    directive, but expected, not a typo -- one of the two prefixes
     *    `'unbound-prefix'` below must not fire for.
     *  - `'xml-namespace-prefix'`: `prefix` is declared via `xmlns:prefix="..."` in the document
     *    itself -- see `declaresXmlNamespace`. Also never bound by a taglib directive, also expected,
     *    for the same reason as `'reserved-prefix'` above: there's no typo to report.
     *
     * Not for `tagdir`-bound prefixes -- `resolveTagFile`'s file-existence
     * check already covers those (a `.tag` file either exists at the expected
     * path or it doesn't).
     */
    async checkTagUsage(documentText, documentUri, prefix, tagName) {
        if (prefix === RESERVED_STANDARD_ACTION_PREFIX) {
            return 'reserved-prefix';
        }
        const uri = (await this.resolvePrefix(documentText, documentUri, prefix))?.uri;
        if (!uri) {
            return declaresXmlNamespace(documentText, prefix) ? 'xml-namespace-prefix' : 'unbound-prefix';
        }
        const [tags, tagFileNames] = await Promise.all([
            this.tagsForUri(uri, documentUri),
            this.tagFileNamesForUri(uri, documentUri),
        ]);
        if (!tags && !tagFileNames) {
            return 'unresolved-taglib';
        }
        return tags?.has(tagName) || tagFileNames?.has(tagName) ? 'resolved' : 'unknown-tag';
    }
    /**
     * Lists every tag name available for a prefix -- for `tagdir` binding
     * (this codebase's own `.tag`-file-backed tags, e.g. `my:avatar`), every
     * `.tag` file under that directory (workspace or jar-bundled, see
     * `listTagFileNamesUnder`); for `uri` binding, every tag name declared via
     * a Java-class `<tag>` entry (the counterpart to `resolveTagClass`, which
     * needs every name up front rather than checking one at a time -- same
     * coverage caveat: a `<tag-file>`-backed tag isn't in the map this reads
     * from, so it won't be suggested). Returns `undefined` when the prefix
     * isn't bound to either, or a `uri`-bound taglib isn't indexed anywhere
     * (workspace or classpath jar) -- nothing to suggest, as opposed to
     * "declares no tags".
     */
    async listTagNames(documentText, documentUri, prefix) {
        const binding = await this.resolvePrefix(documentText, documentUri, prefix);
        if (binding?.tagdir) {
            return (0, webAppPaths_1.listTagFileNamesUnder)(documentUri, binding.tagdir);
        }
        if (!binding?.uri) {
            return undefined;
        }
        const tags = await this.tagsForUri(binding.uri, documentUri);
        return tags ? Array.from(tags.keys()) : undefined;
    }
    /**
     * Resolves `<prefix:tagName>`'s declared `<attribute>` names (plus its
     * `<dynamic-attributes>` flag), for taglibs bound via `uri` -- the
     * counterpart to `tagAttributes.parseTagAttributes` for tags that aren't
     * `.tag` files. Only covers Java-class-backed `<tag>` entries, same
     * caveat as `resolveTagClass`: a `<tag-file>`-backed tag returns
     * `undefined` here (nothing to check its attributes against), not "no
     * attributes declared".
     */
    async resolveTagAttributes(documentText, documentUri, prefix, tagName) {
        const uri = (await this.resolvePrefix(documentText, documentUri, prefix))?.uri;
        if (!uri) {
            return undefined;
        }
        const tagAttributes = await this.tagAttributesForUri(uri, documentUri);
        return tagAttributes?.get(tagName);
    }
}
exports.TldIndex = TldIndex;
//# sourceMappingURL=tldIndex.js.map