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
exports.TagFieldDiagnostics = exports.TAG_FIELD_SOURCE = void 0;
const vscode = __importStar(require("vscode"));
const diagnostics_1 = require("./diagnostics");
const javaSymbols_1 = require("./javaSymbols");
const jspScan_1 = require("./jspScan");
const settings_1 = require("./settings");
const variableTypes_1 = require("./variableTypes");
const ENABLED_SETTING = settings_1.BEAN_PROPERTY_VALIDATION_ENABLED_SETTING;
// The one place this diagnostic collection's name is spelled out -- reused
// below for both the collection itself and every diagnostic's `.source`, and
// exported so checkAllCommand.ts's DIAGNOSTIC_SOURCES can reference it too
// (see TldDiagnostics's own comment for why keeping these tied to one
// constant, rather than several independent literals, matters).
exports.TAG_FIELD_SOURCE = 'jsp-tag-field';
/**
 * Flags a configured tag binding's own `field="..."` attribute (see
 * `vscode-jsp-linker.elBindingTags`, e.g. `<sm:forEach field="displayableGenres">`)
 * when the *source* variable it reads that property off resolves to a Java
 * class jdtls can inspect, and that class has no JavaBean getter for the
 * named property, e.g.:
 *
 * ```jsp
 * <jsp:useBean id="object" type="com.letterboxd.om.Genre" scope="request" />
 * <sm:forEach var="displayable" field="displayableGenres" .../>  <!-- squiggle: no such property -->
 * ```
 *
 * The same shape of check `ElDiagnostics`'s chain tier already does for a
 * `${...}` property access, applied instead to a tag attribute's own
 * `field=` value -- before this existed, a typo'd `field=` produced no
 * diagnostic at all: `VariableTypeResolver` just silently left the declared
 * variable untyped (a `'field'` usage whose getter lookup fails resolves to
 * `undefined`, same as any other unresolvable binding) rather than flagging
 * the attribute itself. Gets an `Information`-severity `untypedSourceDiagnostic`
 * (see `diagnostics.ts`) rather than a missing-property squiggle when `source`
 * doesn't resolve to a known Java type at all (most commonly Supermodel's
 * implicit `name="object"` left untyped, or a `.jspf` fragment that relies on
 * its includer to declare `source`, see the README's "Known limitations") --
 * a coverage gap, not proof of a real bug, so it's called out rather than
 * squiggled like one. Silently skipped entirely, with no diagnostic of either
 * kind, only when `field` itself isn't a literal property name -- a handful
 * of real usages put a dynamic EL expression there instead (e.g.
 * `field="${fieldName}"`, resolved to a runtime string by the JSP engine
 * before the tag ever sees it), which `findTagVariableBindingUsages`
 * deliberately never reports as a `'field'` kind usage in the first place,
 * since there's no way to know statically which property that resolves to
 * (see its own doc comment).
 *
 * Same tier and opt-out as `SetPropertyDiagnostics`/`ElDiagnostics`'s chain
 * check (`beanPropertyValidation.enabled`) -- jdtls-dependent, can
 * under-cover but shouldn't false-positive.
 *
 * Also flags a `'alias'`-kind usage's own `source` the same way, when it's unresolved -- a
 * configured tag with no `field=` at all, e.g. Supermodel's `<sm:when name="X">`/`<sm:out
 * name="X">`, which read `X` from the page context directly rather than a property of it. There's
 * no property lookup to attempt here (no `field`, so no missing-member squiggle is possible), just
 * the same `source`-unresolved case as above, via `unresolvedTagSourceDiagnostic` -- reusing this
 * class rather than adding a second one, since it's the exact same `types.at(usage.source, usage.offset)`
 * check, just without a `field` to also validate once `source` resolves.
 *
 * Also flags a `'expression'`-kind usage (a configured tag's own EL-expression attribute, e.g.
 * `sm:set`'s `value="${...}"`) whose expression `VariableTypeResolver` tried and failed to type,
 * and -- for every kind above plus `'expression'` -- a usage whose `iterates`-requesting tag
 * resolved its own source fine but whose element type `resolveIterationElementType` still couldn't
 * pin down (e.g. iterating a Paginator object directly, reached through a raw generic interface
 * type, rather than via the `paginator="..."` shorthand). See
 * `UnresolvedUsage`'s own doc in variableTypes.ts for both: two independent failure points in the
 * same `computeTypes` pipeline, not one. `'field'`/`'alias'`'s own *source*-unresolved checks above
 * predate `UnresolvedUsage` and still cover the first failure point for those two kinds directly;
 * `UnresolvedUsage` covers the first for `'expression'` (which has no separate source to check) and
 * the second for all three -- together, every non-`'literal'`, non-`'unresolved'` way a usage can
 * end up untyped in this file now has *some* diagnostic, rather than being covered kind-by-kind as
 * each one happened to get noticed.
 */
class TagFieldDiagnostics {
    variableTypes;
    collection = vscode.languages.createDiagnosticCollection(exports.TAG_FIELD_SOURCE);
    constructor(variableTypes) {
        this.variableTypes = variableTypes;
    }
    dispose() {
        this.collection.dispose();
    }
    async validate(document) {
        // See the `vscode-jsp-linker.beanPropertyValidation.enabled` description
        // in package.json for why this prototype-quality check has its own
        // opt-out, unlike the more established diagnostics in this extension.
        if (!vscode.workspace.getConfiguration().get(ENABLED_SETTING, true)) {
            this.collection.set(document.uri, []);
            return;
        }
        const text = (0, jspScan_1.maskJspComments)(document.getText());
        // Shares `resolveTypes`' own cached computation (same `document`/`text`, same cache key) --
        // see `VariableTypeResolver.resolveUnresolvedUsages`'s own doc.
        const [types, unresolvedUsages] = await Promise.all([
            this.variableTypes.resolveTypes(document, text),
            this.variableTypes.resolveUnresolvedUsages(document, text),
        ]);
        const diagnostics = unresolvedUsages.map((usage) => usage.kind === 'expression'
            ? (0, diagnostics_1.unresolvedExpressionDiagnostic)(document, usage.range, usage.sourceText, exports.TAG_FIELD_SOURCE)
            : (0, diagnostics_1.unresolvedIterationDiagnostic)(document, usage.range, usage.resolvedType, usage.indexed, exports.TAG_FIELD_SOURCE));
        for (const usage of (0, variableTypes_1.findTagVariableBindingUsages)(text, (0, variableTypes_1.getBindingTagConfigs)())) {
            if (usage.kind === 'alias') {
                // No `field` at all here -- just `source` itself, so there's nothing further to validate
                // once it resolves (unlike the `'field'` branch below). `sourceRange` is absent when
                // `source` came from `defaultSource`'s literal fallback rather than a real attribute on
                // this usage -- same "no token to squiggle" case `'field'`'s own `fieldRange` gets.
                if (usage.sourceRange && !types.at(usage.source, usage.offset)) {
                    diagnostics.push((0, diagnostics_1.unresolvedTagSourceDiagnostic)(document, usage.sourceRange, usage.source, exports.TAG_FIELD_SOURCE));
                }
                continue;
            }
            if (usage.kind !== 'field') {
                continue;
            }
            // `fieldRange` is absent for a `field` resolved via `alternateSources` (see its own doc in
            // variableTypes.ts) -- the property name itself (e.g. "page") is fixed by config, not written
            // anywhere in the document, so there's genuinely no token *that* text could anchor to. But its
            // `source` reference (e.g. `paginator="_viewingPaginator"`) still has a real one -- `sourceRange`
            // -- and every check below is just as meaningful anchored there instead: an unresolvable source,
            // or one that resolves but has no matching getter, is exactly the same kind of bug either way.
            // Skipping the whole usage whenever `fieldRange` alone was missing (the previous behavior) meant
            // an `alternateSources` usage -- e.g. every `<sm:forEach paginator="...">` in this codebase --
            // was never validated at all: an unresolvable `paginator="X"` produced no diagnostic anywhere,
            // even though `X` itself was a real token this could have anchored one to all along.
            const range = usage.fieldRange ?? usage.sourceRange;
            if (!range) {
                continue;
            }
            const sourceType = types.at(usage.source, usage.offset);
            if (!sourceType) {
                diagnostics.push((0, diagnostics_1.untypedSourceDiagnostic)(document, range, usage.source, usage.field, exports.TAG_FIELD_SOURCE));
                continue;
            }
            const lookup = await (0, javaSymbols_1.resolveMemberReturnType)(sourceType, (0, javaSymbols_1.getterCandidateNames)(usage.field));
            const diagnostic = (0, javaSymbols_1.missingMemberDiagnostic)(document, range, sourceType, lookup, (fqcn) => `${fqcn} has no property "${usage.field}".`, exports.TAG_FIELD_SOURCE) ??
                (0, javaSymbols_1.unknownMemberDiagnostic)(document, range, sourceType, lookup, (fqcn) => `${fqcn} has a property "${usage.field}"`, exports.TAG_FIELD_SOURCE);
            if (diagnostic) {
                diagnostics.push(diagnostic);
            }
        }
        this.collection.set(document.uri, diagnostics);
    }
}
exports.TagFieldDiagnostics = TagFieldDiagnostics;
//# sourceMappingURL=tagFieldDiagnostics.js.map