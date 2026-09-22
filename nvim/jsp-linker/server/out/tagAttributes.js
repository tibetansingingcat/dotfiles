"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.declaredAttributeType = declaredAttributeType;
exports.buildTagAttributesInfo = buildTagAttributesInfo;
exports.parseTagAttributes = parseTagAttributes;
const jspScan_1 = require("./jspScan");
/**
 * Populates a `TagAttributesInfo`'s three attribute-name collections from a flat list of parsed
 * declarations -- shared between `parseTagAttributes` (below) and `tldParsing.ts`'s `<tag>` block,
 * the same three-collection population logic over two different source syntaxes.
 */
/**
 * An attribute's declared Java type, defaulting to `java.lang.String` per the JSP spec when none
 * was declared (and no `fragment="true"`, which this codebase's tags don't use) -- shared by the
 * hover and completion providers so both apply the same default rather than each hard-coding its
 * own copy of the same spec fact.
 */
function declaredAttributeType(info, name) {
    return info.declaredTypes.get(name) ?? 'java.lang.String';
}
function buildTagAttributesInfo(attributes, hasDynamicAttributes) {
    const declaredNames = new Set();
    const declaredTypes = new Map();
    const requiredNames = new Set();
    for (const attribute of attributes) {
        declaredNames.add(attribute.name);
        if (attribute.type) {
            declaredTypes.set(attribute.name, attribute.type);
        }
        if (attribute.required) {
            requiredNames.add(attribute.name);
        }
    }
    return { declaredNames, declaredTypes, requiredNames, hasDynamicAttributes };
}
/**
 * Parses a `.tag` file's own `<%@attribute%>` declarations and whether it
 * opts into `<%@tag dynamic-attributes="...">`, which makes *any* attribute
 * name valid (they're collected into a Map instead of being an error).
 *
 * Goes through `findAllDirectives` (jspScan.ts) -- the same quote-aware
 * directive/attribute-list scanner `ElDiagnostics`'s `collectElNames` already
 * uses for a `.tag` file's own declared-attribute names -- rather than this
 * module's own independent, non-quote-aware regexes (`[^%]+?%>`), which used
 * to silently fail to match a directive whose attribute value contained a
 * literal "%" (e.g. `<%@attribute name="ratio" default="${a % b}" %>`),
 * dropping that attribute here while `findAllDirectives`-backed callers saw
 * it fine -- the same "one parser is the real one, the other quietly drifts"
 * shape as `resolveChainHop`'s own history (see that function's own comment).
 */
function parseTagAttributes(text) {
    const attributes = [];
    let hasDynamicAttributes = false;
    for (const directive of (0, jspScan_1.findAllDirectives)(text)) {
        if (directive.directiveName === 'attribute') {
            const name = directive.attributes.find((attribute) => attribute.name === 'name')?.value;
            if (name) {
                attributes.push({
                    name,
                    type: directive.attributes.find((attribute) => attribute.name === 'type')?.value,
                    required: /^true$/i.test(directive.attributes.find((attribute) => attribute.name === 'required')?.value ?? ''),
                });
            }
        }
        else if (directive.directiveName === 'tag') {
            // Per the JSP tag-file spec (`<%@tag%>`'s `dynamic-attributes`), the value is either the
            // literal "true" (dynamic attributes are accepted but not exposed to the tag body) or any
            // other valid identifier, naming a `java.util.Map<String,Object>` variable the tag body reads
            // them from -- e.g. `WEB-INF/tags/widget/button.tag`'s `dynamic-attributes="dynamicAttributes"`,
            // iterated via `<sm:forEach name="dynamicAttributes">`. Both forms mean "accept any attribute
            // name", so presence with any non-empty value is what opts in -- unlike the TLD-based
            // `DYNAMIC_ATTRIBUTES_ELEMENT` in tldParsing.ts, which really is a plain boolean there (a
            // Java-class-backed tag's dynamic attributes are instead exposed via the `DynamicAttributes`
            // Java interface, not a declared variable name, so a TLD has no equivalent identifier form).
            // Requiring exactly "true" here (a previous version of this check did, incorrectly reasoning
            // from the TLD case above) stopped recognizing the identifier form and produced a false
            // "unknown attribute" diagnostic for every attribute on every tag using it.
            if (directive.attributes.find((attribute) => attribute.name === 'dynamic-attributes')?.value) {
                hasDynamicAttributes = true;
            }
        }
    }
    return buildTagAttributesInfo(attributes, hasDynamicAttributes);
}
//# sourceMappingURL=tagAttributes.js.map