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
exports.TldDiagnostics = exports.TLD_SOURCE = void 0;
const vscode = __importStar(require("vscode"));
const diagnostics_1 = require("./diagnostics");
const javaSymbols_1 = require("./javaSymbols");
const tldParsing_1 = require("./tldParsing");
// The one place this diagnostic collection's name is spelled out -- reused
// below for both the collection itself and every diagnostic's `.source`, and
// exported so checkAllCommand.ts's DIAGNOSTIC_SOURCES can reference it too.
// Previously this file's diagnostics carried a copy-pasted `jsp-broken-links`
// source (from LinkDiagnostics's own near-identical helper) while this
// collection was named `jsp-tld-classes` -- exactly the class of bug tying
// every consumer to one exported constant, instead of each keeping its own
// independent copy of the literal, is meant to make impossible.
exports.TLD_SOURCE = 'jsp-tld-classes';
// `TldRange` and `JspRange` (createDiagnostic's own param type) are the same
// `[number, number]` shape under different names, so this is a plain
// structural match, no conversion needed.
function diagnostic(document, range, message) {
    return (0, diagnostics_1.createDiagnostic)(document, range, message, vscode.DiagnosticSeverity.Warning, exports.TLD_SOURCE);
}
/**
 * Flags a .tld's `<tag-class>`/`<function-class>` entries that don't resolve
 * to an actual Java class. Same resolveClasses semantics as
 * LinkDiagnostics.checkClassReferences: a warning, not an error, since
 * resolution is delegated to the Java extension, and `resolveClasses` itself
 * abstains (doesn't flag) rather than guessing when the language server isn't
 * ready or active.
 */
class TldDiagnostics {
    collection = vscode.languages.createDiagnosticCollection(exports.TLD_SOURCE);
    dispose() {
        this.collection.dispose();
    }
    async validate(document) {
        const usages = (0, tldParsing_1.findAllTldClassReferences)(document.getText());
        // resolveClasses abstains (undefined) rather than falsely reporting
        // `false` when the language server isn't ready or active -- checking
        // `=== false` specifically (not just falsy) is what makes that matter.
        const resolutions = await (0, javaSymbols_1.resolveClasses)(usages.map((usage) => usage.fqcn));
        const diagnostics = [];
        for (const usage of usages) {
            if (resolutions.get(usage.fqcn) === false) {
                diagnostics.push(diagnostic(document, usage.range, `Cannot resolve Java class "${usage.fqcn}".`));
            }
        }
        this.collection.set(document.uri, diagnostics);
    }
}
exports.TldDiagnostics = TldDiagnostics;
//# sourceMappingURL=tldDiagnostics.js.map