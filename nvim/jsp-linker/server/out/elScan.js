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
exports.findAllElPropertyChains = findAllElPropertyChains;
exports.findAllElSyntaxErrors = findAllElSyntaxErrors;
exports.findAllElFunctionCalls = findAllElFunctionCalls;
exports.findTokenAt = findTokenAt;
const jspScan = __importStar(require("./jspScan"));
const variableTypes_1 = require("./variableTypes");
/**
 * The vscode-aware counterpart to `jspScan.ts`'s document-wide EL scanners
 * (`findAllElPropertyChains`/`findAllElSyntaxErrors`/`findAllElFunctionCalls`/`findTokenAt`) --
 * every real caller in this extension (`ElDiagnostics`, `LinkDiagnostics`, `JspHoverProvider`,
 * `JspDefinitionProvider`) should import these, not the ones in `jspScan.ts` directly.
 *
 * `jspScan.ts` itself can't compute a document's `bareSpans` (see `BareElSpan`'s own doc there) --
 * that needs `vscode-jsp-linker.elBindingTags`' `bareElAttributes` config, which means calling
 * `vscode.workspace.getConfiguration()`, which is exactly what keeps `jspScan.ts` a dependency-free
 * text scanner the plain `node --test` unit tests can load with no `vscode` module in scope (see
 * `resolvePropertyNameTargetAt`'s own comment on why that boundary matters). Rather than pushing
 * that computation out to every call site -- a `bareSpans` parameter threaded through five-plus
 * signatures, and `findConfiguredBareElSpans(text, getBindingTagConfigs())` copy-pasted at every
 * one of them, which is exactly the kind of narrow, easy-to-forget-at-the-next-call-site duplication
 * this extension keeps having to unwind -- this module is the one place that does it, so every real
 * caller keeps the exact same signature (`findAllElPropertyChains(text)`, `findTokenAt(text,
 * offset)`, ...) it always had.
 */
// Single-entry memo, not a real cache -- same reasoning and shape as `el/elParser.ts`'s own
// `lastParsedText`/`lastParsedDocument` (which this indirectly feeds): a `validate()` pass
// typically calls two or three of the functions below back-to-back against the *same* document
// text, and `parseElDocument`'s own memo only hits when it's handed the *same `bareSpans` array
// instance* each time (see its comment) -- recomputing a fresh array on every call here would
// silently defeat that. Keyed on `text` alone (no per-document identity needed): a single-entry
// memo already collapses to "the last document scanned", which is always the one every call in a
// single `validate()`/hover/definition request shares.
let lastText;
let lastBareSpans;
function bareSpansFor(text) {
    if (text === lastText && lastBareSpans) {
        return lastBareSpans;
    }
    const bareSpans = (0, variableTypes_1.findConfiguredBareElSpans)(text, (0, variableTypes_1.getBindingTagConfigs)());
    lastText = text;
    lastBareSpans = bareSpans;
    return bareSpans;
}
function findAllElPropertyChains(text) {
    return jspScan.findAllElPropertyChains(text, bareSpansFor(text));
}
function findAllElSyntaxErrors(text) {
    return jspScan.findAllElSyntaxErrors(text, bareSpansFor(text));
}
function findAllElFunctionCalls(text) {
    return jspScan.findAllElFunctionCalls(text, bareSpansFor(text));
}
function findTokenAt(text, offset) {
    return jspScan.findTokenAt(text, offset, bareSpansFor(text));
}
//# sourceMappingURL=elScan.js.map