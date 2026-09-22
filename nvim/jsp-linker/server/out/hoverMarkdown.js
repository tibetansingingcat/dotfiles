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
exports.rangeOf = void 0;
exports.offsetWithin = offsetWithin;
exports.codeLink = codeLink;
exports.trustedMarkdown = trustedMarkdown;
const vscode = __importStar(require("vscode"));
// Shared by JspHoverProvider, DirectiveHoverProvider, and
// DirectiveAttributeCompletionProvider, which all show/position against the
// same kind of markdown hover or attribute range for a different construct.
function offsetWithin(offset, range) {
    return offset >= range[0] && offset <= range[1];
}
// Re-exported from diagnostics.ts (its real home -- range conversion isn't
// hover-specific, diagnostics need it too) so existing hover-provider imports
// don't all need to change name/module.
var diagnostics_1 = require("./diagnostics");
Object.defineProperty(exports, "rangeOf", { enumerable: true, get: function () { return diagnostics_1.rangeOf; } });
/** Renders `label` as inline code, linked to `location` (via a trusted
 * `vscode.open` command link) when one resolved. */
function codeLink(label, location) {
    const code = `\`${label}\``;
    if (!location) {
        return code;
    }
    const openArgs = encodeURIComponent(JSON.stringify([location.uri.toString(), { selection: location.range }]));
    return `[${code}](command:vscode.open?${openArgs})`;
}
function trustedMarkdown() {
    const markdown = new vscode.MarkdownString();
    markdown.isTrusted = { enabledCommands: ['vscode.open'] };
    return markdown;
}
//# sourceMappingURL=hoverMarkdown.js.map