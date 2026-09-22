"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveElFunctionTarget = resolveElFunctionTarget;
exports.resolveElPropertyChainTarget = resolveElPropertyChainTarget;
exports.resolvePropertyNameTargetAt = resolvePropertyNameTargetAt;
const hoverMarkdown_1 = require("./hoverMarkdown");
const javaSymbols_1 = require("./javaSymbols");
const jspScan_1 = require("./jspScan");
const variableTypes_1 = require("./variableTypes");
/**
 * Resolves an EL function call (e.g. `lfn:checkCapability(...)`) to its backing Java
 * class/method -- shared by `JspHoverProvider` and `JspDefinitionProvider` so both actually agree
 * on how `prefix:functionName` resolves, rather than each independently chaining the same
 * `tldIndex.resolveFunction` -> `resolveMember` calls (harmless today since both calls are pure
 * pass-throughs to shared functions with no room to diverge, but exactly the shape of duplication
 * that already caused real drift elsewhere in this extension -- see `resolveMember`'s and
 * `TagAttributesResolver`'s own history).
 */
async function resolveElFunctionTarget(tldIndex, text, documentUri, prefix, functionName) {
    const fn = await tldIndex.resolveFunction(text, documentUri, prefix, functionName);
    if (!fn) {
        return undefined;
    }
    const location = await (0, javaSymbols_1.resolveMember)(fn.className, fn.methodName);
    return { className: fn.className, methodName: fn.methodName, location };
}
/**
 * Resolves an EL property chain's last segment (e.g. `film` in `${_favourite.film}`) to its Java
 * type/location -- shared by `JspHoverProvider` and `JspDefinitionProvider`, same reasoning as
 * `resolveElFunctionTarget` above.
 */
async function resolveElPropertyChainTarget(variableTypes, document, text, segments) {
    const types = await variableTypes.resolveTypes(document, text);
    return (0, javaSymbols_1.resolveChainSegment)(types.asOf(segments[0].range[0]), segments);
}
/**
 * Finds and resolves whichever "attribute value that's a literal Java property name, resolved
 * against a sibling attribute's variable type" usage (if any) covers `offset` -- currently
 * `<jsp:setProperty property="...">` (a setter, via `findSetPropertyUsages`) and an
 * `elBindingTags`-configured tag's own `field="...">` (a getter, via
 * `findTagVariableBindingUsages`'s `'field'` kind). Both `SetPropertyDiagnostics` and
 * `TagFieldDiagnostics` already validate these exact (source, property) pairs the same way; this
 * is the hover/"go to definition" counterpart, sharing the same `resolveMemberReturnType` +
 * `getterCandidateNames`/`setterCandidateNames` primitives rather than either construct getting
 * its own bespoke resolution path.
 *
 * These aren't part of `JspToken`/`findTokenAt`: `jspScan.ts` is deliberately dependency-free (a
 * pure text scanner every other module builds on), and the `elBindingTags` binding scan needs the
 * user's configured tag list from `variableTypes.ts`, which would make `jspScan.ts` depend on a
 * module that already depends on it -- so `JspHoverProvider`/`JspDefinitionProvider` each check
 * this directly, the same way they already special-case a custom tag's own name/attribute-name
 * before falling through to `findTokenAt`.
 */
async function resolvePropertyNameTargetAt(variableTypes, document, text, offset) {
    let sourceVarName;
    let propertyName;
    let range;
    let candidateNames;
    const setPropertyUsage = (0, jspScan_1.findSetPropertyUsages)(text).find((usage) => (0, hoverMarkdown_1.offsetWithin)(offset, usage.propertyRange));
    if (setPropertyUsage) {
        sourceVarName = setPropertyUsage.beanName;
        propertyName = setPropertyUsage.property;
        range = setPropertyUsage.propertyRange;
        candidateNames = javaSymbols_1.setterCandidateNames;
    }
    else {
        const fieldUsage = (0, variableTypes_1.findTagVariableBindingUsages)(text, (0, variableTypes_1.getBindingTagConfigs)()).find(
        // No `fieldRange` means this `field` was resolved via `alternateSources` (see its own doc
        // in variableTypes.ts) -- the property name there is fixed by config, not written anywhere
        // in the document, so there's no token here for hover/"go to definition" to resolve.
        (usage) => usage.kind === 'field' && !!usage.fieldRange && (0, hoverMarkdown_1.offsetWithin)(offset, usage.fieldRange));
        if (!fieldUsage || fieldUsage.kind !== 'field' || !fieldUsage.fieldRange) {
            return undefined;
        }
        sourceVarName = fieldUsage.source;
        propertyName = fieldUsage.field;
        range = fieldUsage.fieldRange;
        candidateNames = javaSymbols_1.getterCandidateNames;
    }
    const types = await variableTypes.resolveTypes(document, text);
    const fqcn = types.at(sourceVarName, offset);
    if (!fqcn) {
        return { kind: 'untypedSource', sourceVarName, propertyName, range };
    }
    const lookup = await (0, javaSymbols_1.resolveMemberReturnType)(fqcn, candidateNames(propertyName));
    // A real getter/setter lookup (unlike `resolveChainHop`'s `Map<K,V>` case) always has a location
    // when `status` is 'found' -- the `lookup.location` check is just to satisfy `location`'s now-
    // optional type, not a case this is expected to actually hit.
    return lookup.status === 'found' && lookup.location ? { kind: 'resolved', propertyName, range, location: lookup.location } : undefined;
}
//# sourceMappingURL=tokenResolution.js.map