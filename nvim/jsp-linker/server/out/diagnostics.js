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
exports.rangeOf = rangeOf;
exports.createDiagnostic = createDiagnostic;
exports.untypedSourceDiagnostic = untypedSourceDiagnostic;
exports.unresolvedTagSourceDiagnostic = unresolvedTagSourceDiagnostic;
exports.unresolvedExpressionDiagnostic = unresolvedExpressionDiagnostic;
exports.unresolvedIterationDiagnostic = unresolvedIterationDiagnostic;
const vscode = __importStar(require("vscode"));
/**
 * Converts one of this extension's own `[start,end]` offset ranges into a `vscode.Range` against
 * `document` -- shared by every diagnostic and hover provider that anchors UI to a scanned range.
 */
function rangeOf(document, range) {
    return new vscode.Range(document.positionAt(range[0]), document.positionAt(range[1]));
}
/**
 * Builds one `vscode.Diagnostic` at `range`, stamped with `source` -- the one construction path
 * every diagnostic in this extension should go through, rather than each diagnostic class
 * hand-rolling its own local copy of "Range + Diagnostic + set `.source`". Six independent copies
 * of that exact snippet existed before this was extracted (`linkDiagnostics.ts`,
 * `tldDiagnostics.ts`, `directiveAttributeDiagnostics.ts`, `tagAttributeDiagnostics.ts`,
 * `elDiagnostics.ts` twice), one of which -- `TldDiagnostics` -- had its `.source` silently
 * copy-pasted from `LinkDiagnostics`'s own copy and never updated, so every TLD-class diagnostic
 * was mislabeled `jsp-broken-links` instead of `jsp-tld-classes` (fixed as a side effect of
 * routing that call through here with its own, now-explicit, `source` argument).
 */
function createDiagnostic(document, range, message, severity, source) {
    const diagnostic = new vscode.Diagnostic(rangeOf(document, range), message, severity);
    diagnostic.source = source;
    return diagnostic;
}
/**
 * Shared by `SetPropertyDiagnostics` and `TagFieldDiagnostics` for the one case they both used to
 * handle by silently skipping: a `<jsp:setProperty name="X" property="Y">` / configured tag's
 * `field="Y"` usage whose sibling `name`/`source` variable `X` is real but has no known Java type
 * in this document (most commonly Supermodel's implicit `name="object"` left untyped, or -- as with
 * `site` in a `.jspf` fragment that never itself declares it -- a variable this file relies on its
 * includer to provide). That's a coverage gap, not evidence of a bug, so `Information` rather than
 * `Warning`/`Error` -- but staying silent made it look identical to "checked, and fine" rather than
 * "not checked at all". `JspHoverProvider`'s `untypedSource` case (see `resolvePropertyNameTargetAt`
 * in `tokenResolution.ts`) already explains this on hover; this is that same explanation surfaced as
 * a diagnostic too; the message text differs slightly (`"X"` rather than the hover's `` `X` ``, since
 * a `vscode.Diagnostic` message is plain text, not Markdown), same underlying condition.
 */
function untypedSourceDiagnostic(document, range, sourceVarName, propertyLabel, source) {
    return createDiagnostic(document, range, `Type of "${sourceVarName}" couldn't be resolved, so "${propertyLabel}" isn't validated.`, vscode.DiagnosticSeverity.Information, source);
}
/**
 * The `'alias'`-kind counterpart to `untypedSourceDiagnostic` above, for a configured tag usage
 * that reads a `source` but has no `field` at all to validate a property against (e.g. Supermodel's
 * `<sm:when name="X">`/`<sm:out name="X">`, which read `X` from the page context directly) -- see
 * `TagVariableBindingUsage`'s `'alias'` case. Same `Information` severity and same underlying
 * reasoning as `untypedSourceDiagnostic`: `X` not resolving to anything declared in this file is a
 * coverage gap this scanner can't rule either way (`X` might be a real typo, or a request/session
 * attribute set by Java code this scanner has no way to see -- the exact same ambiguity
 * `elDiagnostics.ts`'s `jsp-el-unknown-variable` tier already carves out for EL, just surfaced here
 * for a tag's `name=`-style attribute instead of a `${...}` expression).
 */
function unresolvedTagSourceDiagnostic(document, range, sourceVarName, source) {
    return createDiagnostic(document, range, `"${sourceVarName}" isn't declared anywhere in this file.`, vscode.DiagnosticSeverity.Information, source);
}
/**
 * The `'expression'`-kind counterpart to `untypedSourceDiagnostic`/`unresolvedTagSourceDiagnostic`
 * above, for a configured tag's EL-expression attribute (e.g. `sm:set`'s `value="${...}"`,
 * `sm:forEach`'s `items="${...}"` -- the attribute name varies per tag, see
 * `BindingTagConfig.value`'s own doc, which is deliberately why this message names the expression
 * itself rather than an attribute) that `inferElExpressionType` couldn't resolve to any type -- see
 * `UnresolvedUsage`'s own doc in variableTypes.ts. Same `Information` severity and same underlying
 * reasoning as its two siblings: this scanner can't tell a real gap (a method call whose argument
 * type it can't infer, an unsupported expression shape) from a genuine bug, so it's surfaced rather
 * than asserted either way.
 */
function unresolvedExpressionDiagnostic(document, range, sourceText, source) {
    return createDiagnostic(document, range, `The expression "${sourceText}" couldn't be resolved to a type.`, vscode.DiagnosticSeverity.Information, source);
}
/**
 * The `'iteration'`-kind counterpart above -- for a configured tag usage that resolved its own
 * source/expression to a real type (unlike the two diagnostics above, which fire when *that* step
 * fails), but whose tag requests `iterates` (or an `index` attribute -- see `indexed`) and
 * `resolveIterationElementType` still couldn't pin down a concrete element type for `resolvedType` --
 * see `UnresolvedUsage`'s own doc in variableTypes.ts. Two distinct underlying causes share this one
 * diagnostic, deliberately worded to cover both rather than assert either specifically (this function
 * has no way to tell which one actually happened): `resolvedType`'s own real type hierarchy might
 * genuinely never reach `Iterable`/`Map` at all, or it might reach one but bottom out at an unbound
 * generic type variable rather than a real class (e.g. iterating a Paginator object directly via
 * `<sm:forEach name="X">`, reached through a JSP `<jsp:useBean>` declaring a *raw* generic interface
 * type -- see `resolveIterationElementType`'s own doc for why that case still abstains rather than
 * guessing). Same `Information` severity and reasoning as its siblings: this is a coverage gap, not
 * proof `X` itself is wrong.
 *
 * `indexed` picks between two wordings for the same underlying failure -- an `index`-attribute usage
 * (e.g. `<sm:set field="x" index="0">`) never loops at all, so the default "loop variable" phrasing
 * would misdescribe it; see `BindingTagConfig.index`'s own doc in variableTypes.ts.
 */
function unresolvedIterationDiagnostic(document, range, resolvedType, indexed, source) {
    const consequence = indexed ? "the variable it's indexed into isn't validated" : "the loop variable it's iterated into isn't validated";
    return createDiagnostic(document, range, `"${resolvedType}" couldn't be resolved to a concrete element type here, so ${consequence}.`, vscode.DiagnosticSeverity.Information, source);
}
//# sourceMappingURL=diagnostics.js.map