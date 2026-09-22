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
exports.resolveGeneratedArtifacts = resolveGeneratedArtifacts;
const vscode = __importStar(require("vscode"));
const webAppPaths_1 = require("./webAppPaths");
const WEB_INF_TAGS_SEGMENT = '/WEB-INF/tags/';
const TAG_EXTENSION = '.tag';
const JSP_EXTENSION = '.jsp';
const SAFE_IDENTIFIER_CHAR = /[A-Za-z0-9]/;
// Jasper's standard name-mangling: any character that isn't a plain ASCII
// letter/digit (including "-", ".", and literal "_", to keep them
// unambiguous with the escape sequence itself) becomes `_XXXX`, the
// lowercase 4-digit hex of its Unicode code point -- e.g. "-" (U+002D)
// becomes "_002d". Confirmed against real Jasper output in this repo:
// `WEB-INF/tags/avatar.tag` -> class `org.apache.jsp.tag.web.avatar_tag`,
// `activity-list-entries.tag` -> `activity_002dlist_002dentries_tag`.
function mangleSegment(segment) {
    let result = '';
    for (const ch of segment) {
        result += SAFE_IDENTIFIER_CHAR.test(ch) ? ch : `_${ch.codePointAt(0).toString(16).padStart(4, '0')}`;
    }
    return result;
}
// Tag files always compile under the fixed package `org.apache.jsp.tag.web`
// regardless of their real subdirectory under WEB-INF/tags (per the JSP
// spec) -- e.g. "avatar.tag" -> "avatar_tag",
// "video-store/product-poster.tag" -> "video_002dstore/product_002dposter_tag".
function tagClassPathInfo(filePath) {
    const tagsIndex = filePath.indexOf(WEB_INF_TAGS_SEGMENT);
    if (tagsIndex === -1) {
        return undefined;
    }
    const relative = filePath.slice(tagsIndex + WEB_INF_TAGS_SEGMENT.length, -TAG_EXTENSION.length);
    const segments = relative.split('/').map(mangleSegment);
    const className = `${segments.pop()}_tag`;
    return { packageRoot: 'org/apache/jsp/tag/web', mangledRelativePath: [...segments, className].join('/') };
}
// Ordinary JSPs mirror their *entire* webapp-relative path (including
// "WEB-INF" itself) into the package, unlike tag files -- e.g.
// "WEB-INF/templates/object/filmlist.jsp" ->
// "org.apache.jsp.WEB_002dINF.templates.object.filmlist_jsp". Resolves the
// webapp root via `webAppPaths.ts`'s `webAppRootOf` -- the same helper every
// other webapp-relative-path resolution in this extension already goes
// through -- rather than this file's own bare `/src/main/webapp/` substring
// search, which used to silently return `undefined` (no CodeLens at all) for
// a JSP living in this project's documented, gitignored overlay convention
// (see `webAppRootOf`'s own comment), where its pom.xml-based fallback is
// specifically needed.
async function jspClassPathInfo(fileUri) {
    const root = await (0, webAppPaths_1.webAppRootOf)(fileUri.fsPath);
    if (!root) {
        return undefined;
    }
    // `webAppRootOf` returns a native filesystem path (`path.sep`-joined);
    // `fileUri.path` is always forward-slash, so compare/slice via a URI built
    // from the same root rather than the raw string.
    const rootPath = vscode.Uri.file(root).path;
    if (!fileUri.path.startsWith(`${rootPath}/`)) {
        return undefined;
    }
    const relative = fileUri.path.slice(rootPath.length + 1, -JSP_EXTENSION.length);
    const segments = relative.split('/').map(mangleSegment);
    const className = `${segments.pop()}_jsp`;
    return { packageRoot: 'org/apache/jsp', mangledRelativePath: [...segments, className].join('/') };
}
async function classPathInfoOf(fileUri) {
    const filePath = fileUri.path;
    if (filePath.endsWith(TAG_EXTENSION)) {
        return tagClassPathInfo(filePath);
    }
    if (filePath.endsWith(JSP_EXTENSION)) {
        return jspClassPathInfo(fileUri);
    }
    return undefined;
}
async function findFirst(pattern) {
    const matches = await vscode.workspace.findFiles(pattern, undefined, 1);
    const uri = matches[0];
    return uri ? new vscode.Location(uri, new vscode.Position(0, 0)) : undefined;
}
/**
 * Resolves a `.tag` or `.jsp` file to whichever Jasper-generated artifacts
 * already exist on disk for it:
 *  - `.java`: only produced by a local embedded-Tomcat dev run actually
 *    serving that page/tag (lazy, on first request) -- most won't have this.
 *  - `.class`: also produced by the build-time `jspc` Maven plugin (e.g.
 *    `mvn install -Pcli`), so it covers more files than `.java` does, at the
 *    cost of being raw bytecode rather than readable source.
 * Both searches use a broad "**" glob so they match any of the several
 * output directories a build/run can leave classes in (target/classes,
 * target/build-cli/classes, an exploded WAR, or a Tomcat work directory)
 * without hardcoding which one.
 */
async function resolveGeneratedArtifacts(fileUri) {
    const info = await classPathInfoOf(fileUri);
    if (!info) {
        return undefined;
    }
    const [java, classFile] = await Promise.all([
        findFirst(`**/${info.packageRoot}/${info.mangledRelativePath}.java`),
        findFirst(`**/${info.packageRoot}/${info.mangledRelativePath}.class`),
    ]);
    return java || classFile ? { java, classFile } : undefined;
}
//# sourceMappingURL=generatedJavaResolver.js.map