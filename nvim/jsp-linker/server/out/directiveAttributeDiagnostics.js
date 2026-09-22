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
exports.DirectiveAttributeDiagnostics = exports.DIRECTIVE_ATTRIBUTE_SOURCE = void 0;
const vscode = __importStar(require("vscode"));
const directiveAttributes_1 = require("./directiveAttributes");
const diagnostics_1 = require("./diagnostics");
const jspScan_1 = require("./jspScan");
const tagAttributeDiagnostics_1 = require("./tagAttributeDiagnostics");
// Booleans are checked case-insensitively (matching the JSP runtime's own
// leniency, and TagAttributeDiagnostics's equivalent check); an enum like
// `body-content`/`scope` is a fixed set of literal tokens, checked exactly.
function isBooleanValues(values) {
    return values.length === 2 && values.includes('true') && values.includes('false');
}
function isValidLiteralValue(attribute, value) {
    if (!attribute.values) {
        return true;
    }
    return isBooleanValues(attribute.values) ? (0, tagAttributeDiagnostics_1.isValidBooleanLiteral)(value) : attribute.values.includes(value);
}
// The one place this diagnostic collection's name is spelled out -- reused
// below for both the collection itself and every diagnostic's `.source`, and
// exported so checkAllCommand.ts's DIAGNOSTIC_SOURCES can reference it too
// (see TldDiagnostics's own comment for why keeping these tied to one
// constant, rather than several independent literals, matters).
exports.DIRECTIVE_ATTRIBUTE_SOURCE = 'jsp-directive-attributes';
/**
 * Flags a directive attribute usage (e.g. `<%@page pageEncdoing="UTF-8" %>`)
 * whose name isn't one `DIRECTIVES` (see `directiveAttributes.ts`) declares
 * for that directive -- most likely a typo, the same idea as
 * `TagAttributeDiagnostics`'s "unknown attribute" check for custom tags, but
 * for directives instead.
 *
 * Also flags a literal value that doesn't match the attribute's fixed set of
 * valid values, when it declares one -- every boolean-valued attribute
 * (`required`, `isELIgnored`, ...), plus the enum-valued `body-content` and
 * `scope`, e.g. `<%@attribute required="fallse" %>` or
 * `<%@tag body-content="scriptles" %>`. Unlike the equivalent check for
 * custom tag attributes, there's no EL-expression exception to make here:
 * directive attribute values are always static string literals per the JSP
 * spec, never runtime expressions.
 *
 * Silent for a directive name `DIRECTIVES` doesn't recognize (nothing to
 * check its attributes against) and for one that's still being typed (no
 * closing `%>` yet) -- `findAllDirectives` only reports complete directives
 * in the first place. Runs on the same open/edit/save schedule as the other
 * diagnostics.
 */
class DirectiveAttributeDiagnostics {
    collection = vscode.languages.createDiagnosticCollection(exports.DIRECTIVE_ATTRIBUTE_SOURCE);
    dispose() {
        this.collection.dispose();
    }
    validate(document) {
        const text = (0, jspScan_1.maskJspComments)(document.getText());
        const diagnostics = [];
        for (const usage of (0, jspScan_1.findAllDirectives)(text)) {
            const directive = directiveAttributes_1.DIRECTIVES[usage.directiveName];
            if (!directive) {
                continue;
            }
            for (const attribute of usage.attributes) {
                const attributeInfo = directive.attributes.find((candidate) => candidate.name === attribute.name);
                if (!attributeInfo) {
                    diagnostics.push(this.makeDiagnostic(document, attribute.range, `<%@ ${usage.directiveName} %> has no attribute "${attribute.name}".`));
                    continue;
                }
                if (attribute.value !== undefined && attribute.valueRange && !isValidLiteralValue(attributeInfo, attribute.value)) {
                    diagnostics.push(this.makeDiagnostic(document, attribute.valueRange, `<%@ ${usage.directiveName} %>'s "${attribute.name}" must be one of: ${attributeInfo.values.join(', ')}.`));
                }
            }
        }
        this.collection.set(document.uri, diagnostics);
    }
    makeDiagnostic(document, range, message) {
        return (0, diagnostics_1.createDiagnostic)(document, range, message, vscode.DiagnosticSeverity.Error, exports.DIRECTIVE_ATTRIBUTE_SOURCE);
    }
}
exports.DirectiveAttributeDiagnostics = DirectiveAttributeDiagnostics;
//# sourceMappingURL=directiveAttributeDiagnostics.js.map