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
exports.TagAttributesResolver = void 0;
const vscode = __importStar(require("vscode"));
const webAppPaths_1 = require("./webAppPaths");
const javaSymbols_1 = require("./javaSymbols");
const tagAttributes_1 = require("./tagAttributes");
/**
 * Resolves a `<prefix:tagName>` usage to its declared attribute info --
 * either a `tagdir`-backed `.tag` file's `<%@attribute%>` directives or a
 * `uri`-bound taglib's `<tag><attribute>` entries -- shared between
 * `TagAttributeDiagnostics` (attribute-name/type validation) and
 * `JspHoverProvider` (surfacing a tag's attributes, and an attribute's
 * declared Java type, on hover), so both agree on how a tag's attributes
 * are looked up and on the `.tag` file parse cache.
 */
class TagAttributesResolver {
    tldIndex;
    tagFileInfoCache = new Map();
    constructor(tldIndex) {
        this.tldIndex = tldIndex;
    }
    invalidateTagFile(uri) {
        this.tagFileInfoCache.delete(uri.fsPath);
    }
    async resolve(document, text, prefix, tagName) {
        const tagFilePath = await this.tldIndex.resolveTagFile(text, document.uri, prefix, tagName);
        if (tagFilePath) {
            const location = await (0, webAppPaths_1.resolveWebAppRelativePath)(document.uri, tagFilePath);
            const info = location ? await this.getTagAttributesInfo(location.uri) : undefined;
            return {
                info,
                describeTag: () => `<${prefix}:${tagName}> (${tagFilePath})`,
                // Already resolved above (needed it to get `info` anyway) -- free to return.
                resolveBacking: async () => ({ label: tagFilePath, location }),
            };
        }
        // Not tagdir-bound -- try a uri-bound taglib's <tag><attribute> entries instead.
        const info = await this.tldIndex.resolveTagAttributes(text, document.uri, prefix, tagName);
        return {
            info,
            describeTag: () => `<${prefix}:${tagName}>`,
            resolveBacking: async () => {
                const tagClass = await this.tldIndex.resolveTagClass(text, document.uri, prefix, tagName);
                const location = tagClass ? await (0, javaSymbols_1.resolveClass)(tagClass) : undefined;
                return { label: tagClass, location };
            },
        };
    }
    async getTagAttributesInfo(tagFileUri) {
        const cached = this.tagFileInfoCache.get(tagFileUri.fsPath);
        if (cached) {
            return cached;
        }
        try {
            const doc = await vscode.workspace.openTextDocument(tagFileUri);
            const info = (0, tagAttributes_1.parseTagAttributes)(doc.getText());
            this.tagFileInfoCache.set(tagFileUri.fsPath, info);
            return info;
        }
        catch {
            return undefined;
        }
    }
}
exports.TagAttributesResolver = TagAttributesResolver;
//# sourceMappingURL=tagAttributesResolver.js.map