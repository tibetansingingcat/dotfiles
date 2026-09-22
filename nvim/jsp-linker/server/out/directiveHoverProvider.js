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
exports.DirectiveHoverProvider = void 0;
const vscode = __importStar(require("vscode"));
const directiveAttributes_1 = require("./directiveAttributes");
const jspScan_1 = require("./jspScan");
const hoverMarkdown_1 = require("./hoverMarkdown");
function describeAttribute(attribute) {
    const values = attribute.values ? ` (\`${attribute.values.join('` | `')}\`)` : '';
    const required = attribute.required ? ' *(required)*' : '';
    return `**${attribute.name}**: ${attribute.description}${values}${required}`;
}
/**
 * Hovers over a JSP/tag-file directive (`<%@page%>`, `<%@include%>`,
 * `<%@taglib%>`, `<%@tag%>`, `<%@attribute%>`, `<%@variable%>`) --
 * every directive kind defined by the Jakarta Server Pages spec, per
 * `DIRECTIVES` in `directiveAttributes.ts`:
 *
 * - The directive's own name (e.g. "attribute" in `<%@attribute name="x"%>`)
 *   shows what the directive is for and every attribute it accepts.
 * - One attribute name at a usage site (e.g. "type" in the same directive)
 *   shows just that attribute's own description.
 *
 * Silent for a directive name `DIRECTIVES` doesn't recognize (not a real
 * directive -- `findEnclosingDirective` only checks the shape `<%@word`, not
 * that `word` is one of the six the spec defines) or an attribute name the
 * directive doesn't declare (most likely a typo, which is for a future
 * diagnostic to flag, not for hover to guess at).
 */
class DirectiveHoverProvider {
    provideHover(document, position) {
        const text = (0, jspScan_1.maskJspComments)(document.getText());
        const offset = document.offsetAt(position);
        const enclosing = (0, jspScan_1.findEnclosingDirective)(text, offset);
        if (!enclosing) {
            return undefined;
        }
        const directive = directiveAttributes_1.DIRECTIVES[enclosing.directiveName];
        if (!directive) {
            return undefined;
        }
        if ((0, hoverMarkdown_1.offsetWithin)(offset, enclosing.nameRange)) {
            return this.hoverForDirective(document, directive, enclosing.nameRange);
        }
        const attribute = enclosing.attributes.find((candidate) => (0, hoverMarkdown_1.offsetWithin)(offset, candidate.range));
        if (!attribute) {
            return undefined;
        }
        const attributeInfo = directive.attributes.find((candidate) => candidate.name === attribute.name);
        if (!attributeInfo) {
            return undefined;
        }
        const markdown = (0, hoverMarkdown_1.trustedMarkdown)();
        markdown.appendMarkdown(describeAttribute(attributeInfo));
        return new vscode.Hover(markdown, (0, hoverMarkdown_1.rangeOf)(document, attribute.range));
    }
    hoverForDirective(document, directive, nameRange) {
        const markdown = (0, hoverMarkdown_1.trustedMarkdown)();
        markdown.appendMarkdown(`**&lt;%@ ${directive.name} %&gt;**\n\n${directive.description}`);
        markdown.appendMarkdown(`\n\n${directive.attributes.map((attribute) => `- ${describeAttribute(attribute)}`).join('\n')}`);
        return new vscode.Hover(markdown, (0, hoverMarkdown_1.rangeOf)(document, nameRange));
    }
}
exports.DirectiveHoverProvider = DirectiveHoverProvider;
//# sourceMappingURL=directiveHoverProvider.js.map