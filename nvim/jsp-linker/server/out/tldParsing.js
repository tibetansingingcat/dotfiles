"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitParamTypes = splitParamTypes;
exports.parseTld = parseTld;
exports.findAllTldClassReferences = findAllTldClassReferences;
const tagAttributes_1 = require("./tagAttributes");
const TAGLIB_URI = /<uri>\s*([^<\s]+)\s*<\/uri>/;
const NAME_ELEMENT = /<name>\s*([^<\s]+)\s*<\/name>/;
// Every block-element pattern below tolerates attributes on its own opening
// tag (e.g. `<tag xmlns="">`, seen in the wild in a real jar-bundled TLD --
// some generators, xdoclet apparently among them, emit a redundant
// `xmlns=""` on every element) via `(?:\s[^>]*)?` -- deliberately requiring
// *whitespace* before any attributes, not just "not immediately '>'", so
// `<tag` doesn't also swallow `<tag-file>` (a sibling element name that
// starts with the same four letters) as if "-file" were its attributes.
const FUNCTION_BLOCK = /<function(?:\s[^>]*)?>([\s\S]*?)<\/function>/g;
const FUNCTION_CLASS = /<function-class>\s*([^<\s]+)\s*<\/function-class>/;
// `[\s\S]*?` (any character, non-greedy), not `[^<]+?` -- a signature's parameter list can
// legitimately contain a generic type argument (e.g. `boolean isElementOf(java.util.List
// <java.lang.String>, java.lang.String)`, the exact shape `splitParamTypes` above is already built
// to depth-track commas for), and `[^<]+?` excludes `<` from matching *at all*, not just
// greedily -- no amount of backtracking lets it cross one, so a signature containing one silently
// fails this whole regex, dropping the entire `<function>` block (see `parseTld`'s own `if (name &&
// className && methodName)`). Same failure shape `USE_BEAN_TYPE_ATTR` (jspScan.ts) used to have for
// a generic `type="..."` value, and the same fix: match up to the literal closing tag instead of
// excluding a character real content can contain. Safe here for the same reason `FUNCTION_BLOCK`/
// `TAG_BLOCK` below already use `[\s\S]*?` for their own body capture: a signature's own text can
// never legitimately contain the literal string `</function-signature>`, so non-greedy is enough to
// find the real closing tag without depth-tracking.
const FUNCTION_SIGNATURE = /<function-signature>\s*([\s\S]*?)\s*<\/function-signature>/;
const METHOD_NAME_FROM_SIGNATURE = /(\w+)\s*\(([^)]*)\)\s*$/;
/**
 * Splits a Java method signature's parameter-type list (e.g.
 * `"java.lang.String, java.util.List<java.lang.String>"`) on top-level commas, tracking `<...>`
 * depth so a comma inside a generic type argument doesn't split wrong -- no quote-awareness
 * needed, unlike `splitArgs` (jspScan.ts), since a Java type list never contains string literals.
 * Every real `<function-signature>` in this repo's one function-declaring TLD
 * (`functions.tld`) is a flat, non-generic FQCN list, so this is mostly future-proofing.
 */
function splitParamTypes(text) {
    const types = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '<') {
            depth++;
        }
        else if (ch === '>') {
            depth--;
        }
        else if (ch === ',' && depth === 0) {
            const piece = text.slice(start, i).trim();
            if (piece) {
                types.push(piece);
            }
            start = i + 1;
        }
    }
    const last = text.slice(start).trim();
    if (last) {
        types.push(last);
    }
    return types;
}
const TAG_BLOCK = /<tag(?:\s[^>]*)?>([\s\S]*?)<\/tag>/g;
const TAG_FILE_BLOCK = /<tag-file(?:\s[^>]*)?>([\s\S]*?)<\/tag-file>/g;
// The hyphen in `<tag-class>` is optional: pre-JSP-2.0 TLDs (the
// `web-jsptaglibrary_1_1.dtd`/`_1_2.dtd` era -- some real dependencies of
// this codebase still ship one, e.g. cactuslab-web's webparts.tld) spell
// this and other multi-word element names without one, e.g. `<tagclass>`.
const TAG_CLASS = /<tag-?class>\s*([^<\s]+)\s*<\/tag-?class>/;
const TAG_CLASS_INDEXED = /<tag-?class>\s*([^<\s]+)\s*<\/tag-?class>/gd;
const FUNCTION_CLASS_INDEXED = /<function-class>\s*([^<\s]+)\s*<\/function-class>/gd;
const ATTRIBUTE_BLOCK = /<attribute(?:\s[^>]*)?>([\s\S]*?)<\/attribute>/g;
const TYPE_ELEMENT = /<type>\s*([^<\s]+)\s*<\/type>/;
const REQUIRED_ELEMENT = /<required>\s*true\s*<\/required>/i;
const DYNAMIC_ATTRIBUTES_ELEMENT = /<dynamic-attributes>\s*true\s*<\/dynamic-attributes>/;
/**
 * Parses a TLD's declared `<uri>`, `<function>`, Java-class-backed `<tag>`
 * entries (including each tag's own `<attribute>` declarations), and
 * `<tag-file>` entries' names out of its raw text. Shared between workspace
 * `.tld` files (read via a `TextDocument`) and TLDs bundled inside a
 * classpath jar's `META-INF/` (read via `unzip`) -- both are just XML text
 * by the time they get here.
 */
function parseTld(text) {
    const functions = new Map();
    let block;
    FUNCTION_BLOCK.lastIndex = 0;
    while ((block = FUNCTION_BLOCK.exec(text)) !== null) {
        const body = block[1];
        const name = NAME_ELEMENT.exec(body)?.[1];
        const className = FUNCTION_CLASS.exec(body)?.[1];
        const signature = FUNCTION_SIGNATURE.exec(body)?.[1];
        const signatureMatch = signature ? METHOD_NAME_FROM_SIGNATURE.exec(signature) : undefined;
        const methodName = signatureMatch?.[1];
        if (name && className && methodName) {
            functions.set(name, { className, methodName, paramTypes: splitParamTypes(signatureMatch[2]) });
        }
    }
    const tags = new Map();
    const tagAttributes = new Map();
    TAG_BLOCK.lastIndex = 0;
    while ((block = TAG_BLOCK.exec(text)) !== null) {
        const body = block[1];
        const name = NAME_ELEMENT.exec(body)?.[1];
        const tagClass = TAG_CLASS.exec(body)?.[1];
        if (name && tagClass) {
            tags.set(name, tagClass);
        }
        if (name) {
            const attributes = [];
            let attributeBlock;
            ATTRIBUTE_BLOCK.lastIndex = 0;
            while ((attributeBlock = ATTRIBUTE_BLOCK.exec(body)) !== null) {
                const attributeName = NAME_ELEMENT.exec(attributeBlock[1])?.[1];
                if (attributeName) {
                    attributes.push({
                        name: attributeName,
                        type: TYPE_ELEMENT.exec(attributeBlock[1])?.[1],
                        required: REQUIRED_ELEMENT.test(attributeBlock[1]),
                    });
                }
            }
            tagAttributes.set(name, (0, tagAttributes_1.buildTagAttributesInfo)(attributes, DYNAMIC_ATTRIBUTES_ELEMENT.test(body)));
        }
    }
    const tagFileNames = new Set();
    TAG_FILE_BLOCK.lastIndex = 0;
    while ((block = TAG_FILE_BLOCK.exec(text)) !== null) {
        const name = NAME_ELEMENT.exec(block[1])?.[1];
        if (name) {
            tagFileNames.add(name);
        }
    }
    return { declaredUri: TAGLIB_URI.exec(text)?.[1], functions, tags, tagAttributes, tagFileNames };
}
/**
 * Finds every `<tag-class>` and `<function-class>` entry in a .tld's raw
 * text, with their own ranges -- unlike `parseTld`'s `tags`/`functions` maps,
 * which are keyed by tag/function name for lookup, this is for linting the
 * .tld file itself (e.g. flagging a class that doesn't resolve).
 */
function findAllTldClassReferences(text) {
    const usages = [];
    for (const pattern of [TAG_CLASS_INDEXED, FUNCTION_CLASS_INDEXED]) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const range = match.indices?.[1];
            if (range) {
                usages.push({ fqcn: match[1], range });
            }
        }
    }
    return usages;
}
//# sourceMappingURL=tldParsing.js.map