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
exports.ClasspathResourceContentProvider = exports.CLASSPATH_RESOURCE_SCHEME = void 0;
exports.classpathResourceUri = classpathResourceUri;
const vscode = __importStar(require("vscode"));
const classpathResources_1 = require("./classpathResources");
exports.CLASSPATH_RESOURCE_SCHEME = 'jsp-linker-jarfile';
/**
 * Builds a virtual-document URI for a `META-INF/resources` entry inside a
 * classpath jar, e.g. for `/WEB-INF/foo.jspf` supplied by `some.jar`. The jar
 * path travels in the query component since it's arbitrary, unencoded data;
 * the webapp-relative path stays as the URI's path so the editor tab title
 * (and the language-mode file-extension sniff) reads naturally.
 */
function classpathResourceUri(jarPath, webAppRelativePath) {
    return vscode.Uri.from({
        scheme: exports.CLASSPATH_RESOURCE_SCHEME,
        path: webAppRelativePath,
        query: encodeURIComponent(jarPath),
    });
}
/** Serves read-only content for `classpathResourceUri(...)` URIs, fetched from the jar on demand. */
class ClasspathResourceContentProvider {
    async provideTextDocumentContent(uri) {
        const jarPath = decodeURIComponent(uri.query);
        const entryName = `${classpathResources_1.META_INF_RESOURCES}${uri.path}`;
        const content = await (0, classpathResources_1.readClasspathResource)(jarPath, entryName);
        return content ?? `Could not read "${entryName}" from "${jarPath}".`;
    }
}
exports.ClasspathResourceContentProvider = ClasspathResourceContentProvider;
//# sourceMappingURL=classpathResourceContentProvider.js.map