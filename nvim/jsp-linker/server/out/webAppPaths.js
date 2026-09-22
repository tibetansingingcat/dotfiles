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
exports.webAppRootOf = webAppRootOf;
exports.listTagFileNamesUnder = listTagFileNamesUnder;
exports.moduleRootOf = moduleRootOf;
exports.resolveWebAppRelativePath = resolveWebAppRelativePath;
exports.resolveIncludePath = resolveIncludePath;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const classpathResourceContentProvider_1 = require("./classpathResourceContentProvider");
const classpathResources_1 = require("./classpathResources");
const WEBAPP_ROOT_SEGMENT = `${path.sep}src${path.sep}main${path.sep}webapp`;
async function pathExists(candidate) {
    try {
        await vscode.workspace.fs.stat(vscode.Uri.file(candidate));
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Walks upward from a file to the nearest Maven module (a directory with a
 * `pom.xml`) -- also the project root the Java extension knows that module
 * by, needed to ask it for the module's runtime classpath.
 */
async function findModuleRoot(fromFile) {
    let dir = path.dirname(fromFile);
    let parent = path.dirname(dir);
    while (parent !== dir) {
        if (await pathExists(path.join(dir, 'pom.xml'))) {
            return dir;
        }
        dir = parent;
        parent = path.dirname(dir);
    }
    return undefined;
}
/**
 * Falls back for files that live outside their module's `src/main/webapp`
 * (e.g. a local, gitignored `etc/opt/<site>/webapp/...` overlay): root-relative
 * paths in those files are still resolved against the deployed webapp root they
 * get merged into at build time, not their own directory tree. Uses the nearest
 * Maven module's `src/main/webapp`, if it has one.
 */
async function findModuleWebAppRoot(fromFile) {
    const moduleRoot = await findModuleRoot(fromFile);
    if (!moduleRoot) {
        return undefined;
    }
    const webapp = path.join(moduleRoot, 'src', 'main', 'webapp');
    return (await pathExists(webapp)) ? webapp : undefined;
}
/**
 * Shared shape behind `webAppRootOf`/`moduleRootOf`: both cheaply derive a root directory from
 * the `/src/main/webapp` convention when a file follows it (`sliceEnd` picks how much of that
 * match to keep -- through the whole segment for the webapp root itself, or just up to it for the
 * owning module root), falling back to `findFallback`'s upward `pom.xml` search otherwise.
 */
function rootOf(fromFile, sliceEnd, findFallback) {
    const index = fromFile.indexOf(WEBAPP_ROOT_SEGMENT);
    if (index !== -1) {
        return fromFile.slice(0, sliceEnd(index));
    }
    return findFallback(fromFile);
}
function webAppRootOf(fromFile) {
    return rootOf(fromFile, (index) => index + WEBAPP_ROOT_SEGMENT.length, findModuleWebAppRoot);
}
/**
 * Lists every `.tag` file under a `tagdir`-bound directory -- both a
 * workspace directory and, per "Webapp-relative paths supplied by a
 * dependency jar" in the README, one a classpath jar supplies via
 * `META-INF/resources` (e.g. Supermodel's own tag files). Returns bare tag
 * names (directory and `.tag` extension stripped), deduplicated -- the
 * counterpart to `resolveWebAppRelativePath` for listing a whole directory
 * (e.g. for tag-*name* completion) rather than resolving one exact path.
 */
async function listTagFileNamesUnder(fromDocumentUri, tagdir) {
    const names = new Set();
    const root = await webAppRootOf(fromDocumentUri.fsPath);
    if (root) {
        const pattern = new vscode.RelativePattern(vscode.Uri.file(path.join(root, tagdir)), '*.tag');
        for (const file of await vscode.workspace.findFiles(pattern)) {
            names.add(path.basename(file.fsPath, '.tag'));
        }
    }
    const moduleRoot = await moduleRootOf(fromDocumentUri.fsPath);
    if (moduleRoot) {
        for (const entry of await (0, classpathResources_1.listClasspathResourcesUnder)(moduleRoot, tagdir)) {
            if (entry.endsWith('.tag')) {
                names.add(path.posix.basename(entry, '.tag'));
            }
        }
    }
    return Array.from(names);
}
/**
 * The Maven module directory owning this file -- cheaply derived from the
 * `/src/main/webapp` convention when the file follows it, falling back to
 * the same upward `pom.xml` search `findModuleWebAppRoot` uses otherwise.
 */
function moduleRootOf(fromFile) {
    return rootOf(fromFile, (index) => index, findModuleRoot);
}
async function resolveExisting(targetPath) {
    if (!targetPath) {
        return undefined;
    }
    const targetUri = vscode.Uri.file(targetPath);
    try {
        await vscode.workspace.fs.stat(targetUri);
    }
    catch {
        return undefined;
    }
    return new vscode.Location(targetUri, new vscode.Position(0, 0));
}
/**
 * Resolves a webapp-root-relative path (leading "/", e.g. a tagdir + tag
 * name) against the `src/main/webapp` ancestor of the given file.
 */
async function resolveWebAppRelativePath(fromDocumentUri, webAppRelativePath) {
    const root = await webAppRootOf(fromDocumentUri.fsPath);
    const local = await resolveExisting(root ? path.join(root, webAppRelativePath) : undefined);
    if (local) {
        return local;
    }
    // Not a workspace file -- Servlet 3.0+ containers also resolve webapp
    // paths from any classpath jar's `META-INF/resources/` tree (e.g.
    // Supermodel ships shared admin fragments/tags this way), so ask the Java
    // extension for the owning module's runtime classpath and check there too.
    const moduleRoot = await moduleRootOf(fromDocumentUri.fsPath);
    if (!moduleRoot) {
        return undefined;
    }
    const jarPath = await (0, classpathResources_1.findClasspathResource)(moduleRoot, webAppRelativePath);
    return jarPath ? new vscode.Location((0, classpathResourceContentProvider_1.classpathResourceUri)(jarPath, webAppRelativePath), new vscode.Position(0, 0)) : undefined;
}
/**
 * Resolves an `<%@include file="...">` / `<jsp:include page="...">` path to
 * the file it points at. A leading "/" means webapp-root-relative; otherwise
 * it's relative to the including file's own directory, per the JSP spec.
 */
function resolveIncludePath(fromDocumentUri, rawPath) {
    if (rawPath.startsWith('/')) {
        return resolveWebAppRelativePath(fromDocumentUri, rawPath);
    }
    return resolveExisting(path.join(path.dirname(fromDocumentUri.fsPath), rawPath));
}
//# sourceMappingURL=webAppPaths.js.map