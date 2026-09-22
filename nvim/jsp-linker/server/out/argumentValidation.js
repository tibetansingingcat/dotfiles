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
exports.validateCallArguments = validateCallArguments;
const vscode = __importStar(require("vscode"));
const diagnostics_1 = require("./diagnostics");
const javaSymbols_1 = require("./javaSymbols");
/**
 * Validates one call's arguments against its resolved parameter-type list -- shared by EL function
 * calls (`ElDiagnostics`'s `validateElFunctionCalls`, param types from a TLD `<function-signature>`)
 * and, previously, chain-ending method calls too -- that second use has since moved into
 * `resolveChainHop`'s own overload-aware resolution (`javaSymbols.ts`), which needs to select the
 * right overload *before* it can validate anything against it, so it now calls `inferArgumentType`/
 * `checkArgumentCompatibility` directly rather than through this wrapper. This function still owns
 * the "did the caller even find one, unambiguous signature to validate against" shape (arity first,
 * then per-argument) for the TLD case, where there's no overload-selection question at all -- a TLD
 * function has exactly one signature.
 *
 * Arity first: a count mismatch is an Error (deterministic once `paramTypes` is the right list) and
 * short-circuits per-argument checking (there's no correct pairing to check hop-by-hop once the
 * counts don't even match). Otherwise, each argument is paired positionally with its declared
 * parameter type. A confident `'incompatible'` becomes a Warning (weaker than the arity Error, since
 * this is a heuristic over EL's own permissive coercion rules, not jdtls ground truth); `'compatible'`
 * needs no diagnostic at all (it checked out). `inferArgumentType`'s `undefined` (can't confidently
 * type this argument -- a ternary, an operator expression, ...) and `checkArgumentCompatibility`'s
 * `'unknown'` (the declared/actual type comparison itself couldn't complete) each get their own
 * `Information` diagnostic instead -- previously both were silently skipped with no diagnostic of
 * any kind, which meant "this argument was never actually checked" read identically to "checked, and
 * fine". Same reasoning as `untypedSourceDiagnostic`'s own "couldn't check this" admission elsewhere
 * in this extension.
 *
 * `resolveFunction`, when supplied, is passed straight through to `inferArgumentType` so a nested EL
 * function call used as one of this call's own arguments (e.g. `lfn:instantToDate(x)` inside
 * `lfn:formatISO8601UTC(lfn:instantToDate(x))`) can be typed too, not just a literal or a dotted
 * property chain.
 */
async function validateCallArguments(document, calleeDescription, callRange, args, paramTypes, knownTypes, source, resolveFunction) {
    if (args.length !== paramTypes.length) {
        return [
            (0, diagnostics_1.createDiagnostic)(document, callRange, `${calleeDescription} takes ${paramTypes.length} argument${paramTypes.length === 1 ? '' : 's'}, but ${args.length} ${args.length === 1 ? 'was' : 'were'} given.`, vscode.DiagnosticSeverity.Error, source),
        ];
    }
    const diagnostics = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const declaredType = paramTypes[i];
        const actualType = await (0, javaSymbols_1.inferArgumentType)(arg, knownTypes, resolveFunction);
        if (!actualType) {
            diagnostics.push((0, diagnostics_1.createDiagnostic)(document, arg.range, `Argument ${i + 1} to ${calleeDescription} couldn't be resolved to a type, so it isn't validated against its declared ${declaredType}.`, vscode.DiagnosticSeverity.Information, source));
            continue;
        }
        const compatibility = await (0, javaSymbols_1.checkArgumentCompatibility)(actualType, declaredType);
        if (compatibility === 'incompatible') {
            diagnostics.push((0, diagnostics_1.createDiagnostic)(document, arg.range, `Argument ${i + 1} to ${calleeDescription} is declared ${declaredType}, but this looks like ${actualType}.`, vscode.DiagnosticSeverity.Warning, source));
        }
        else if (compatibility === 'unknown') {
            diagnostics.push((0, diagnostics_1.createDiagnostic)(document, arg.range, `Couldn't confirm whether ${actualType} (argument ${i + 1}) is compatible with ${calleeDescription}'s declared ${declaredType}.`, vscode.DiagnosticSeverity.Information, source));
        }
    }
    return diagnostics;
}
//# sourceMappingURL=argumentValidation.js.map