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
exports.ScannerParseFailureDiagnostics = exports.SCANNER_PARSE_FAILURE_SOURCE = void 0;
const vscode = __importStar(require("vscode"));
const diagnostics_1 = require("./diagnostics");
const jspScan_1 = require("./jspScan");
// The one place this diagnostic collection's name is spelled out -- reused below for both the
// collection itself and every diagnostic's `.source`, and exported so checkAllCommand.ts's
// DIAGNOSTIC_SOURCES can reference it too (see TldDiagnostics's own comment for why keeping these
// tied to one constant, rather than several independent literals, matters).
exports.SCANNER_PARSE_FAILURE_SOURCE = 'jsp-linker-parse-failure';
const MESSAGE = "vscode-jsp-linker couldn't parse this tag's attributes. This is a limitation in the extension itself, not necessarily a problem with this JSP -- please report it (with this file and line) so it can be fixed.";
/**
 * Flags a `<jsp:useBean>`/`<jsp:setProperty>` tag whose required attributes (`id`+`class`/`type`
 * for the former, `name`+`property` for the latter) are textually present in the source but this
 * extension's own regex-based scanner (`findUseBeanDeclarations`/`findSetPropertyUsages` in
 * jspScan.ts) still failed to extract them -- see `findUseBeanParseFailures`/
 * `findSetPropertyParseFailures`'s own doc.
 *
 * This is a different kind of gap from every other diagnostic in this extension: elsewhere, "can't
 * resolve" is deliberately read as a coverage gap (a real request/session attribute set by Java
 * code this scanner has no way to see) rather than a bug, and stays silent or Information-level
 * accordingly (see `TagFieldDiagnostics`'s/`ElDiagnostics`'s own doc on that distinction). Here the
 * attribute is right there in the document, visibly present -- there's nothing external it could
 * legitimately be deferring to, so a failure to extract it can only be this scanner's own bug (a
 * quoting/character-class edge case it doesn't handle yet, the same shape of bug
 * `USE_BEAN_TAG`/`SET_PROPERTY_TAG` themselves used to have before their own `>`-inside-quotes fix).
 *
 * Surfaced as a real editor diagnostic rather than routed only to a background/CI check: the
 * engineer who happens to open this file is the best-placed person to notice something's off and
 * report it (with the exact file/line), even though they personally can't fix the extension's own
 * parser -- that's a genuinely different, but still real, thing to ask of them than "your JSP has a
 * bug", which is why the message says so explicitly rather than reading like every other squiggle
 * in this file.
 *
 * No settings-gated opt-out (unlike `TagFieldDiagnostics`/`SetPropertyDiagnostics`'s
 * `beanPropertyValidation.enabled`, or `ElDiagnostics`'s `elUnknownVariableWarning.enabled`) --
 * those exist because their checks are inherently uncertain (a real coverage gap can look
 * identical to a real bug). This one is a hard, confident finding by construction (the attribute
 * really is there in the text), so -- like `TagAttributeDiagnostics`'s "unknown attribute" or
 * `TldDiagnostics`'s class checks -- it doesn't need one, and ideally almost never fires at all.
 */
class ScannerParseFailureDiagnostics {
    collection = vscode.languages.createDiagnosticCollection(exports.SCANNER_PARSE_FAILURE_SOURCE);
    dispose() {
        this.collection.dispose();
    }
    validate(document) {
        const text = (0, jspScan_1.maskJspComments)(document.getText());
        const diagnostics = [...(0, jspScan_1.findUseBeanParseFailures)(text), ...(0, jspScan_1.findSetPropertyParseFailures)(text)].map((range) => (0, diagnostics_1.createDiagnostic)(document, range, MESSAGE, vscode.DiagnosticSeverity.Warning, exports.SCANNER_PARSE_FAILURE_SOURCE));
        this.collection.set(document.uri, diagnostics);
    }
}
exports.ScannerParseFailureDiagnostics = ScannerParseFailureDiagnostics;
//# sourceMappingURL=scannerParseFailureDiagnostics.js.map