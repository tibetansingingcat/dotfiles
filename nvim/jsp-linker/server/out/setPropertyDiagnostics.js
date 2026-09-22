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
exports.SetPropertyDiagnostics = exports.SET_PROPERTY_SOURCE = void 0;
const vscode = __importStar(require("vscode"));
const diagnostics_1 = require("./diagnostics");
const javaSymbols_1 = require("./javaSymbols");
const jspScan_1 = require("./jspScan");
const settings_1 = require("./settings");
/**
 * Prototype: flags `<jsp:setProperty name="X" property="Y" .../>` when `X`'s
 * declared Java type (via the shared `VariableTypeResolver` -- a
 * `<jsp:useBean id="X" class/type="...">` declaration, or a configured
 * `elBindingTags` tag binding, elsewhere in the same file) resolves to a
 * class jdtls can inspect, and that class has no JavaBean setter for `Y`
 * (e.g. `property="preson"` when only `setPerson` exists), e.g.:
 *
 * ```jsp
 * <jsp:useBean id="meViewingy" class="web.bean.MeViewingyBean" />
 * <jsp:setProperty name="meViewingy" property="preson" value="${user}" />  <!-- squiggle -->
 * ```
 *
 * `X`'s type not being resolvable at all (no `useBean`/tag binding for it, or
 * one exists but its own type didn't resolve) gets an `Information`-severity
 * `untypedSourceDiagnostic` (see `diagnostics.ts`, shared with
 * `TagFieldDiagnostics`) instead of the missing-setter squiggle above -- a
 * coverage gap, not proof of a real bug. Similarly, when `X`'s declared class
 * *does* resolve but the setter-existence check itself can't complete (the
 * declared class can't be resolved by jdtls -- not indexed, not on the
 * classpath here -- or its document symbols can't be fetched), that now gets
 * its own `Information`-severity `unknownMemberDiagnostic` rather than being
 * silently skipped with no diagnostic of either kind -- the same "checked and
 * fine" vs. "not actually checked" distinction `untypedSourceDiagnostic`
 * already draws for the source-unresolved case, one step later, once the
 * source resolved but the member lookup itself couldn't. `property="*"`
 * (bind-everything-from-request-params) is never checked -- there's no
 * single property name to validate.
 *
 * `resolveMemberReturnType` (with `setterCandidateNames`) finds a bean's
 * setters (declared directly or inherited from a supertype) via jdtls's
 * document-symbol outline, which by default
 * omits Lombok-generated methods (most JSP-facing beans here, e.g.
 * `MeViewingyBean`, declare their setters via field-level `@Setter` rather
 * than writing them out) -- this only works correctly because the
 * workspace's `.vscode/settings.json` sets `java.symbols.includeGeneratedCode:
 * true`. Without that setting, this would flag most real, valid
 * `<jsp:setProperty>` usages as errors.
 *
 * v1 scope, worth knowing before trusting this broadly:
 * - Sharing `VariableTypeResolver` with `ElDiagnostics` means this now also
 *   recognizes Supermodel's own `<sm:set var="X" name="..." field="...">`
 *   (once configured via `elBindingTags`) as a way of declaring `X`, not just
 *   `<jsp:useBean>` -- e.g. `<sm:set var="paginator" name="site"
 *   field="popularPersonPaginator"/>` followed by `<jsp:setProperty
 *   name="paginator" property="howMany" .../>` (see
 *   `WEB-INF/tags/sidebar/popular-people.tag`) now resolves. Everything here
 *   still surfaces an `Information` rather than guessing when a variable's
 *   type isn't resolvable, so this under-covers rather than false-positives.
 * - Resolves `id`/`var` -> declared class by walking every `useBean`/tag
 *   binding in true document order (see `VariableTypeResolver`), so a
 *   same-named variable redeclared with a different type partway through a
 *   file validates a `setProperty` against whichever declaration precedes it
 *   in source order, not just "the last one in the file".
 * - Doesn't check the setter's parameter type against the EL `value`
 *   expression's inferred type, only that a same-named setter exists at
 *   all -- e.g. it can't catch passing a `String` where the setter expects
 *   a `Person`.
 * - Wired into `checkAllCommand.ts`'s batch diagnostics (`jsp-setproperty` is
 *   in its `DIAGNOSTIC_SET_PROPERTY_SOURCES`), same as the other diagnostics.
 */
const ENABLED_SETTING = settings_1.BEAN_PROPERTY_VALIDATION_ENABLED_SETTING;
// The one place this diagnostic collection's name is spelled out -- reused
// below for both the collection itself and every diagnostic's `.source`, and
// exported so checkAllCommand.ts's DIAGNOSTIC_SOURCES can reference it too
// (see TldDiagnostics's own comment for why keeping these tied to one
// constant, rather than several independent literals, matters).
exports.SET_PROPERTY_SOURCE = 'jsp-setproperty';
class SetPropertyDiagnostics {
    variableTypes;
    collection = vscode.languages.createDiagnosticCollection(exports.SET_PROPERTY_SOURCE);
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
        const types = await this.variableTypes.resolveTypes(document, text);
        const diagnostics = [];
        for (const usage of (0, jspScan_1.findSetPropertyUsages)(text)) {
            const fqcn = types.at(usage.beanName, usage.propertyRange[0]);
            if (!fqcn) {
                diagnostics.push((0, diagnostics_1.untypedSourceDiagnostic)(document, usage.propertyRange, usage.beanName, usage.property, exports.SET_PROPERTY_SOURCE));
                continue;
            }
            const result = await (0, javaSymbols_1.resolveMemberReturnType)(fqcn, (0, javaSymbols_1.setterCandidateNames)(usage.property));
            const diagnostic = (0, javaSymbols_1.missingMemberDiagnostic)(document, usage.propertyRange, fqcn, result, (resolvedFqcn) => `${resolvedFqcn} has no setter for property "${usage.property}".`, exports.SET_PROPERTY_SOURCE) ??
                (0, javaSymbols_1.unknownMemberDiagnostic)(document, usage.propertyRange, fqcn, result, (resolvedFqcn) => `${resolvedFqcn} has a setter for property "${usage.property}"`, exports.SET_PROPERTY_SOURCE);
            if (diagnostic) {
                diagnostics.push(diagnostic);
            }
        }
        this.collection.set(document.uri, diagnostics);
    }
}
exports.SetPropertyDiagnostics = SetPropertyDiagnostics;
//# sourceMappingURL=setPropertyDiagnostics.js.map