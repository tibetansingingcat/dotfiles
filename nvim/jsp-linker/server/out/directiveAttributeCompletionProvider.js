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
exports.DirectiveAttributeCompletionProvider = void 0;
const vscode = __importStar(require("vscode"));
const directiveAttributes_1 = require("./directiveAttributes");
const jspScan_1 = require("./jspScan");
const hoverMarkdown_1 = require("./hoverMarkdown");
/**
 * Completes a directive's own name (e.g. `<%@|` -> `page`, `include`,
 * `taglib`, `tag`, `attribute`, `variable`), and once one's typed, its
 * attribute names -- plus, for an attribute constrained to a fixed set of
 * literal values (a boolean, or an enum like `body-content`), the value
 * itself -- e.g. `<%@page isELIgnored="|"` -> `true`/`false`, `<%@tag
 * body-content="|"` -> `empty`/`scriptless`/`tagdependent`. Reuses
 * `DIRECTIVES` (see `directiveAttributes.ts`), the same table
 * `DirectiveHoverProvider` shows on hover, so both agree on what a
 * directive -- and its attributes -- are.
 */
class DirectiveAttributeCompletionProvider {
    provideCompletionItems(document, position) {
        const text = (0, jspScan_1.maskJspComments)(document.getText());
        const offset = document.offsetAt(position);
        const enclosing = (0, jspScan_1.findEnclosingDirective)(text, offset);
        if (!enclosing) {
            return undefined;
        }
        if ((0, hoverMarkdown_1.offsetWithin)(offset, enclosing.nameRange)) {
            return Object.values(directiveAttributes_1.DIRECTIVES).map((directive) => {
                const item = new vscode.CompletionItem(directive.name, vscode.CompletionItemKind.Keyword);
                item.detail = directive.description;
                return item;
            });
        }
        const directive = directiveAttributes_1.DIRECTIVES[enclosing.directiveName];
        if (!directive) {
            return undefined;
        }
        const context = (0, jspScan_1.classifyAttributePosition)(enclosing.attributes, offset);
        if (context.kind === 'value') {
            const attribute = directive.attributes.find((candidate) => candidate.name === context.attributeName);
            if (!attribute?.values) {
                return undefined;
            }
            return attribute.values.map((value) => new vscode.CompletionItem(value, vscode.CompletionItemKind.Value));
        }
        const items = [];
        for (const attribute of directive.attributes) {
            if (context.usedNames.has(attribute.name)) {
                continue;
            }
            const item = new vscode.CompletionItem(attribute.name, vscode.CompletionItemKind.Property);
            item.detail = attribute.values ? attribute.values.join(' | ') : attribute.description;
            item.documentation = new vscode.MarkdownString(attribute.description);
            item.insertText = new vscode.SnippetString(`${attribute.name}="$0"`);
            item.sortText = (0, jspScan_1.requiredFirstSortText)(attribute.name, attribute.required);
            items.push(item);
        }
        return items;
    }
}
exports.DirectiveAttributeCompletionProvider = DirectiveAttributeCompletionProvider;
//# sourceMappingURL=directiveAttributeCompletionProvider.js.map