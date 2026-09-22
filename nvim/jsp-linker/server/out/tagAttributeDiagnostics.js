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
exports.TagAttributeDiagnostics = exports.TAG_ATTRIBUTE_SOURCE = exports.BOOLEAN_TYPES = void 0;
exports.isValidBooleanLiteral = isValidBooleanLiteral;
const vscode = __importStar(require("vscode"));
const diagnostics_1 = require("./diagnostics");
const jspScan_1 = require("./jspScan");
// Attribute types whose literal value must be exactly "true" or "false"
// (case-insensitively). JSP's Boolean property editor doesn't reject
// anything else at request time -- it silently treats any non-"true" text
// as false -- so a typo here (e.g. `linked="fasle"`) is a silent bug rather
// than a startup or compile failure, which makes static detection valuable.
exports.BOOLEAN_TYPES = new Set(['boolean', 'java.lang.Boolean']);
const VALID_BOOLEAN_LITERAL = /^(true|false)$/i;
/** Case-insensitive "true"/"false" literal check, shared with `DirectiveAttributeDiagnostics`'s
 * equivalent check for a directive's own boolean-valued attributes (`required`, `isELIgnored`,
 * ...) -- both apply the same JSP-runtime leniency described above. */
function isValidBooleanLiteral(value) {
    return VALID_BOOLEAN_LITERAL.test(value);
}
// The one place this diagnostic collection's name is spelled out -- reused
// below for both the collection itself and every diagnostic's `.source`, and
// exported so checkAllCommand.ts's DIAGNOSTIC_SOURCES can reference it too
// (see TldDiagnostics's own comment for why keeping these tied to one
// constant, rather than several independent literals, matters).
exports.TAG_ATTRIBUTE_SOURCE = 'jsp-tag-attributes';
/**
 * Flags custom-tag attribute usages (e.g. `<my:avatar wrongName="...">`)
 * whose name isn't declared by the tag's known attribute list -- either a
 * `tagdir`-backed `.tag` file's `<%@attribute%>` directives, or a `uri`-bound
 * taglib's `<tag><attribute>` entries (workspace or jar-bundled TLD, see
 * `TldIndex.resolveTagAttributes`). Skips tags that declare
 * dynamic-attributes (any name is valid there) and tags we can't resolve an
 * attribute list for at all -- a `<tag-file>`-backed tag, an unindexed
 * taglib, or an unbound prefix all have nothing to check against.
 *
 * Also flags a literal value passed to a `Boolean`/`boolean`-typed attribute
 * that isn't "true" or "false" -- see `BOOLEAN_TYPES` above. Values
 * containing an EL expression (`${...}`) are skipped since they can only be
 * checked at runtime.
 *
 * A `.tag` file's own `<%@attribute%>` directive (e.g. a bad
 * `required="fallse"`) is a different construct -- a directive, not a custom
 * tag usage -- and is checked by `DirectiveAttributeDiagnostics` instead.
 */
class TagAttributeDiagnostics {
    resolver;
    collection = vscode.languages.createDiagnosticCollection(exports.TAG_ATTRIBUTE_SOURCE);
    constructor(resolver) {
        this.resolver = resolver;
    }
    dispose() {
        this.collection.dispose();
    }
    async validate(document) {
        const text = (0, jspScan_1.maskJspComments)(document.getText());
        const usages = (0, jspScan_1.findCustomTagUsages)(text);
        const diagnostics = [];
        for (const usage of usages) {
            const { info, describeTag } = await this.resolver.resolve(document, text, usage.prefix, usage.tagName);
            if (!info || info.hasDynamicAttributes) {
                continue;
            }
            for (const attribute of usage.attributes) {
                if (!info.declaredNames.has(attribute.name)) {
                    diagnostics.push(this.makeDiagnostic(document, attribute.range, `${describeTag()} has no attribute "${attribute.name}".`, vscode.DiagnosticSeverity.Error));
                    continue;
                }
                const declaredType = info.declaredTypes.get(attribute.name);
                if (declaredType &&
                    exports.BOOLEAN_TYPES.has(declaredType) &&
                    attribute.value !== undefined &&
                    attribute.valueRange &&
                    !attribute.value.includes('${') &&
                    !isValidBooleanLiteral(attribute.value)) {
                    diagnostics.push(this.makeDiagnostic(document, attribute.valueRange, `${describeTag()}'s "${attribute.name}" is boolean; "${attribute.value}" isn't "true" or "false" and will silently be treated as false.`, vscode.DiagnosticSeverity.Error));
                }
            }
        }
        this.collection.set(document.uri, diagnostics);
    }
    makeDiagnostic(document, range, message, severity) {
        return (0, diagnostics_1.createDiagnostic)(document, range, message, severity, exports.TAG_ATTRIBUTE_SOURCE);
    }
}
exports.TagAttributeDiagnostics = TagAttributeDiagnostics;
//# sourceMappingURL=tagAttributeDiagnostics.js.map