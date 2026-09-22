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
exports.TagAttributeCompletionProvider = void 0;
const vscode = __importStar(require("vscode"));
const jspScan_1 = require("./jspScan");
const tagAttributes_1 = require("./tagAttributes");
const tagAttributeDiagnostics_1 = require("./tagAttributeDiagnostics");
/**
 * Completes a custom tag's own name for `uri`-bound taglibs (e.g. `<sm:|` ->
 * `url`, `set`, `if`, ...), and once a tag name is resolved, its attribute
 * names (e.g. `<sm:url |` -> `route`, `codeOrId`, ...) and, for a
 * `Boolean`/`boolean`-typed attribute, its `"true"`/`"false"` literal value
 * (e.g. `<sm:url addContextPath="|"`). Tag-name completion only covers
 * `uri`-bound taglibs (JSTL `c:`/`fmt:`, Supermodel `sm:`, ...) -- listing
 * every name is just exposing `TldIndex`'s existing per-taglib map, which it
 * only has for those. A `tagdir`-bound prefix (this codebase's own
 * `.tag`-file-backed tags, e.g. `<my:avatar>`) isn't covered yet -- that
 * would need listing `.tag` files in a directory instead, workspace and
 * jar-bundled, which nothing here does today (see README "Known
 * limitations"). Attribute name/value completion reuses the same
 * `TagAttributesResolver` that backs the hover and "unknown attribute"
 * diagnostic (see `tagAttributeDiagnostics.ts`), so all three agree on what a
 * tag's attributes are; it covers both `tagdir`-backed `.tag` files and
 * `uri`-bound Java-class `<tag>` entries, and is silent under the same
 * conditions (dynamic-attributes, an unresolvable tag).
 */
class TagAttributeCompletionProvider {
    resolver;
    tldIndex;
    constructor(resolver, tldIndex) {
        this.resolver = resolver;
        this.tldIndex = tldIndex;
    }
    async provideCompletionItems(document, position) {
        const text = (0, jspScan_1.maskJspComments)(document.getText());
        const offset = document.offsetAt(position);
        const nameContext = (0, jspScan_1.findCustomTagNameContextAt)(text, offset);
        if (nameContext) {
            const tagNames = await this.tldIndex.listTagNames(text, document.uri, nameContext.prefix);
            return tagNames?.map((name) => new vscode.CompletionItem(name, vscode.CompletionItemKind.Class));
        }
        const tag = (0, jspScan_1.findEnclosingCustomTag)(text, offset);
        if (!tag) {
            return undefined;
        }
        const { info } = await this.resolver.resolve(document, text, tag.prefix, tag.tagName);
        if (!info || info.hasDynamicAttributes) {
            return undefined;
        }
        const context = (0, jspScan_1.classifyAttributePosition)(tag.attributes, offset);
        if (context.kind === 'value') {
            const declaredType = info.declaredTypes.get(context.attributeName);
            if (!declaredType || !tagAttributeDiagnostics_1.BOOLEAN_TYPES.has(declaredType)) {
                return undefined;
            }
            return ['true', 'false'].map((value) => new vscode.CompletionItem(value, vscode.CompletionItemKind.Value));
        }
        const items = [];
        for (const name of info.declaredNames) {
            if (context.usedNames.has(name)) {
                continue;
            }
            const type = (0, tagAttributes_1.declaredAttributeType)(info, name);
            const required = info.requiredNames.has(name);
            const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Property);
            item.detail = `${type}${required ? ' (required)' : ''}`;
            item.insertText = new vscode.SnippetString(`${name}="$0"`);
            item.sortText = (0, jspScan_1.requiredFirstSortText)(name, required);
            items.push(item);
        }
        return items;
    }
}
exports.TagAttributeCompletionProvider = TagAttributeCompletionProvider;
//# sourceMappingURL=tagAttributeCompletionProvider.js.map