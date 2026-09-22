"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.maskJspComments = maskJspComments;
exports.parseChain = parseChain;
exports.findAllElPropertyChains = findAllElPropertyChains;
exports.findAllElSyntaxErrors = findAllElSyntaxErrors;
exports.findTokenAt = findTokenAt;
exports.findAllUseBeanClasses = findAllUseBeanClasses;
exports.findAllAttributeTypes = findAllAttributeTypes;
exports.findAllIncludePaths = findAllIncludePaths;
exports.findAllElFunctionCalls = findAllElFunctionCalls;
exports.findAllScriptletFqcns = findAllScriptletFqcns;
exports.findAllPageImportFqcns = findAllPageImportFqcns;
exports.findUseBeanDeclarations = findUseBeanDeclarations;
exports.findUseBeanParseFailures = findUseBeanParseFailures;
exports.findSetPropertyUsages = findSetPropertyUsages;
exports.findSetPropertyParseFailures = findSetPropertyParseFailures;
exports.classifyAttributePosition = classifyAttributePosition;
exports.requiredFirstSortText = requiredFirstSortText;
exports.findCustomTagUsages = findCustomTagUsages;
exports.findEnclosingCustomTag = findEnclosingCustomTag;
exports.findEnclosingDirective = findEnclosingDirective;
exports.findCustomTagNameContextAt = findCustomTagNameContextAt;
exports.findAllDirectives = findAllDirectives;
exports.findPageImports = findPageImports;
const elChainAdapter_1 = require("./el/elChainAdapter");
const elLexer_1 = require("./el/elLexer");
// A scriptlet or scriptlet-expression, but not a directive (`<%@`) or comment (`<%--`).
const SCRIPTLET_BLOCK = /<%(?!@|--)=?([\s\S]*?)%>/gd;
// One or more lowercase-led package segments followed by a capitalized type name.
const FQCN_TOKEN = /\b(?:[a-z][a-zA-Z0-9_]*\.)+[A-Z][A-Za-z0-9_]*\b/gd;
// `<%@include file="...">` and the equivalent `<jsp:include page="...">` action.
const INCLUDE_DIRECTIVE = /<%@\s*include\s+file\s*=\s*"([^"]+)"/gd;
const JSP_INCLUDE_ACTION = /<jsp:include\s+page\s*=\s*"([^"]+)"/gd;
// An opening custom-tag element, e.g. `<my:avatar ...>` or `<video-store:product-poster ...>`.
// Requires a letter right after "<" so closing tags (matched separately below) never match here.
const CUSTOM_TAG_ELEMENT = /<([A-Za-z][\w-]*):([A-Za-z][\w-]*)\b/gd;
// A closing custom-tag element, e.g. `</my:avatar>`. No attributes are possible here,
// so it's just prefix:name up to the ">".
const CUSTOM_TAG_CLOSING = /<\/([A-Za-z][\w-]*):([A-Za-z][\w-]*)>/gd;
// A tag file's own `<%@attribute name="..." type="com.foo.Bar" %>` declaration.
const ATTRIBUTE_TYPE = /<%@\s*attribute\b[^%]*\btype\s*=\s*"([\w.]+)"/gd;
// `<%@page import="...">` -- the value is a comma-separated list of FQCNs
// (optionally wildcarded, e.g. "java.util.*"), and a JSP commonly has one
// directive per import (as in this codebase's convention) or several packed
// into one, so both need splitting the same way.
const PAGE_IMPORT = /<%@\s*page\b[^%]*\bimport\s*=\s*"([^"]+)"/gd;
// A JSP comment. Unlike SCRIPTLET_BLOCK, none of this module's other
// patterns (custom tags, useBean, includes, page imports, EL calls) know to
// avoid matching inside one.
const JSP_COMMENT = /<%--[\s\S]*?--%>/g;
/**
 * Blanks out JSP comment (`<%-- ... --%>`) contents, replacing every
 * non-newline character with a space. Every scanner in this module treats
 * commented-out markup as if it were live otherwise -- e.g. a `<my:avatar>`
 * usage left inside a comment for later would still get "unknown attribute"
 * diagnostics -- since none of their patterns are comment-aware. Callers
 * should run this once on a document's raw text and scan the result instead:
 * offsets and line numbers are unchanged (only characters are replaced, none
 * removed), so ranges computed against the masked text remain valid against
 * the original document.
 */
function maskJspComments(text) {
    return text.replace(JSP_COMMENT, (comment) => comment.replace(/[^\n]/g, ' '));
}
function within(offset, range) {
    return offset >= range[0] && offset < range[1];
}
// Splits a `<%@page import="a.B,c.D">`-style comma list into its individual
// FQCNs with their own absolute ranges, dropping wildcard entries (`x.y.*`)
// since there's no single class there to link to or verify.
function splitFqcnList(text, groupRange) {
    const raw = text.slice(groupRange[0], groupRange[1]);
    const results = [];
    let cursor = 0;
    for (const part of raw.split(',')) {
        const leadingWhitespace = part.length - part.trimStart().length;
        const fqcn = part.trim();
        if (fqcn && !fqcn.endsWith('.*')) {
            const start = groupRange[0] + cursor + leadingWhitespace;
            results.push({ fqcn, range: [start, start + fqcn.length] });
        }
        cursor += part.length + 1; // +1 to skip the comma itself
    }
    return results;
}
// Built on `scanUseBeanTags` (below) rather than its own independent regex/scan -- it used to have
// one (`USE_BEAN_CLASS`, sharing nothing with `scanUseBeanTags`'s own `USE_BEAN_TAG`/attribute
// regexes), which drifted out of sync with the fix `USE_BEAN_TAG`/`USE_BEAN_TYPE_ATTR` got for a
// generic `type="..."` value (see `USE_BEAN_TAG`'s own comment) and silently stopped matching a
// `<jsp:useBean>` tag with one at all -- exactly the "same concept, two independent
// implementations, and the gap between them is where the bug lives" pattern this extension has hit
// before (`TagAttributesResolver`'s and `resolveChainHop`'s own history). `findAllUseBeanClasses`
// below shares the same fix for the same reason.
function findUseBeanClassAt(text, offset) {
    for (const declaration of scanUseBeanTags(text).declarations) {
        if (within(offset, declaration.fqcnRange)) {
            return { kind: 'useBeanClass', fqcn: declaration.fqcn, range: declaration.fqcnRange };
        }
    }
    return undefined;
}
function findElFunctionCallAt(text, offset, bareSpans) {
    const found = (0, elChainAdapter_1.findElFunctionCallAt)(text, offset, bareSpans);
    return found && { kind: 'elFunctionCall', ...found };
}
function findScriptletFqcnAt(text, offset) {
    SCRIPTLET_BLOCK.lastIndex = 0;
    let block;
    while ((block = SCRIPTLET_BLOCK.exec(text)) !== null) {
        const contentRange = block.indices?.[1];
        if (!contentRange || !within(offset, contentRange)) {
            continue;
        }
        const content = text.slice(contentRange[0], contentRange[1]);
        FQCN_TOKEN.lastIndex = 0;
        let fqcnMatch;
        while ((fqcnMatch = FQCN_TOKEN.exec(content)) !== null) {
            const localRange = fqcnMatch.indices?.[0];
            if (!localRange) {
                continue;
            }
            const absoluteRange = [contentRange[0] + localRange[0], contentRange[0] + localRange[1]];
            if (within(offset, absoluteRange)) {
                return { kind: 'scriptletFqcn', fqcn: fqcnMatch[0], range: absoluteRange };
            }
        }
        // Cursor is inside this scriptlet block but not on an FQCN token --
        // no need to check other scriptlet blocks.
        return undefined;
    }
    return undefined;
}
function findIncludePathAt(text, offset) {
    for (const pattern of [INCLUDE_DIRECTIVE, JSP_INCLUDE_ACTION]) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const groupRange = match.indices?.[1];
            if (groupRange && within(offset, groupRange)) {
                return { kind: 'includePath', path: match[1], range: groupRange };
            }
        }
    }
    return undefined;
}
function findCustomTagAt(text, offset) {
    CUSTOM_TAG_ELEMENT.lastIndex = 0;
    let match;
    while ((match = CUSTOM_TAG_ELEMENT.exec(text)) !== null) {
        const prefixRange = match.indices?.[1];
        const nameRange = match.indices?.[2];
        if (!prefixRange || !nameRange) {
            continue;
        }
        const fullRange = [prefixRange[0], nameRange[1]];
        if (within(offset, fullRange)) {
            return { kind: 'customTag', prefix: match[1], tagName: match[2], range: fullRange };
        }
    }
    return undefined;
}
function findClosingCustomTagAt(text, offset) {
    CUSTOM_TAG_CLOSING.lastIndex = 0;
    let match;
    while ((match = CUSTOM_TAG_CLOSING.exec(text)) !== null) {
        const prefixRange = match.indices?.[1];
        const nameRange = match.indices?.[2];
        if (!prefixRange || !nameRange) {
            continue;
        }
        const fullRange = [prefixRange[0], nameRange[1]];
        if (within(offset, fullRange)) {
            return { kind: 'customTag', prefix: match[1], tagName: match[2], range: fullRange };
        }
    }
    return undefined;
}
function findAttributeTypeAt(text, offset) {
    ATTRIBUTE_TYPE.lastIndex = 0;
    let match;
    while ((match = ATTRIBUTE_TYPE.exec(text)) !== null) {
        const groupRange = match.indices?.[1];
        if (groupRange && within(offset, groupRange)) {
            return { kind: 'attributeType', fqcn: match[1], range: groupRange };
        }
    }
    return undefined;
}
function findPageImportFqcnAt(text, offset) {
    PAGE_IMPORT.lastIndex = 0;
    let match;
    while ((match = PAGE_IMPORT.exec(text)) !== null) {
        const groupRange = match.indices?.[1];
        if (!groupRange) {
            continue;
        }
        for (const { fqcn, range } of splitFqcnList(text, groupRange)) {
            if (within(offset, range)) {
                return { kind: 'pageImportFqcn', fqcn, range };
            }
        }
    }
    return undefined;
}
/**
 * Parses a self-contained EL chain expression (e.g. "_favourite.film" or
 * "_viewing.authorised(lfn:foo(a,b)).rating") into its segments, each with its own absolute range.
 * Delegates to the real EL parser (`el/elParser.ts`) via `el/elChainAdapter.ts`'s
 * `parseStandaloneElChain` -- see the plan this rewrite followed for why: a hand-rolled character
 * scan (this function's previous implementation) can't correctly handle bracket/index access, a
 * call followed by further property access, or an expression's own operators bounding where a
 * chain actually starts/ends, all of which real usages in this codebase need. Exported so
 * `inferArgumentType` (argumentValidation.ts) can reuse the exact same parsing logic, rather than a
 * second copy of it.
 */
function parseChain(chainText, chainStart) {
    return { segments: (0, elChainAdapter_1.parseStandaloneElChain)(chainText, chainStart) };
}
function findElPropertyChainAt(text, offset, bareSpans) {
    const segments = (0, elChainAdapter_1.findElChainSegmentsAt)(text, offset, bareSpans);
    if (!segments) {
        return undefined;
    }
    return { kind: 'elPropertyChain', segments, range: segments[segments.length - 1].range };
}
/**
 * Finds every dotted EL property chain in the document (not just the one at
 * some offset) -- e.g. every `${_ppb.personProduction.authorisedViewings}`
 * -- for `ElDiagnostics` to validate hop by hop. Includes a bare
 * single-segment reference (e.g. `${_reviewCount}`) same as
 * `findElPropertyChainAt` does; a caller checking property *access*
 * specifically has nothing to validate there and should skip it.
 *
 * Also recurses into every call's own argument list -- a chain-ending
 * *method* call's (e.g. "authorisation" in `_viewing.authorised(authorisation)`)
 * exactly the same as an EL *function* call's (e.g. `user.role` in
 * `${lfn:checkCapability(user.role, ...)}`) -- so a real chain passed as an
 * argument gets the same existence/hop-by-hop validation as anywhere else in
 * the document, regardless of what it's being passed to. This is narrower
 * than validating the call itself (argument count/types against the
 * callee's declared parameters, which for a method call would need
 * overload-aware resolution this scanner doesn't attempt) -- that's a
 * separate concern layered on top elsewhere, not a precondition for this.
 *
 * Delegates to `el/elChainAdapter.ts`'s `collectElChainUsagesInDocument`, which walks the real
 * parsed EL syntax tree (every ternary branch, operator operand, call argument, lambda body, and
 * collection-literal element -- not just call arguments the way this function's previous
 * implementation did) rather than a flat, structure-blind character scan.
 *
 * `bareSpans` (default none) extends the scan to configured bare EL attributes too -- see
 * `BareElSpan`'s own doc above.
 */
function findAllElPropertyChains(text, bareSpans = elLexer_1.NO_BARE_EL_SPANS) {
    return (0, elChainAdapter_1.collectElChainUsagesInDocument)(text, bareSpans).map(({ segments }) => ({ segments }));
}
/**
 * Every `${...}`/`#{...}` block in the document that failed to parse at all (a genuine syntax
 * error, or content still mid-edit) -- e.g. `${!empty a.b &&/ c}`, where a stray `/` right after
 * `&&` leaves nothing for `Multiplication` to divide. Unlike `findAllElPropertyChains`, a block
 * that failed to parse contributes *no* chains at all (see `parseElDocument`'s own recovery) -- so
 * without this, a broken expression goes completely silent instead of being flagged.
 *
 * `bareSpans` (default none) extends the scan to configured bare EL attributes too -- see
 * `BareElSpan`'s own doc above.
 */
function findAllElSyntaxErrors(text, bareSpans = elLexer_1.NO_BARE_EL_SPANS) {
    return (0, elChainAdapter_1.collectElSyntaxErrorsInDocument)(text, bareSpans);
}
/** Finds whichever linkable token (if any) covers the given offset. `bareSpans` (default none)
 * extends the EL-backed lookups (`findElFunctionCallAt`/`findElPropertyChainAt`) to configured bare
 * EL attributes too -- see `BareElSpan`'s own doc above. */
function findTokenAt(text, offset, bareSpans = elLexer_1.NO_BARE_EL_SPANS) {
    return (findUseBeanClassAt(text, offset) ??
        findElFunctionCallAt(text, offset, bareSpans) ??
        findScriptletFqcnAt(text, offset) ??
        findPageImportFqcnAt(text, offset) ??
        findIncludePathAt(text, offset) ??
        findCustomTagAt(text, offset) ??
        findClosingCustomTagAt(text, offset) ??
        findAttributeTypeAt(text, offset) ??
        findElPropertyChainAt(text, offset, bareSpans));
}
/** Finds every `<jsp:useBean class/type="...">` declaration in the document -- see `findUseBeanClassAt`'s own comment for why this is built on `scanUseBeanTags` rather than its own scan. */
function findAllUseBeanClasses(text) {
    return scanUseBeanTags(text).declarations.map(({ fqcn, fqcnRange }) => ({ fqcn, range: fqcnRange }));
}
/** Finds every tag file `<%@attribute type="...">` declaration in the document. */
function findAllAttributeTypes(text) {
    const usages = [];
    ATTRIBUTE_TYPE.lastIndex = 0;
    let match;
    while ((match = ATTRIBUTE_TYPE.exec(text)) !== null) {
        const range = match.indices?.[1];
        if (range) {
            usages.push({ fqcn: match[1], range });
        }
    }
    return usages;
}
/** Finds every `<%@include file="...">` / `<jsp:include page="...">` in the document. */
function findAllIncludePaths(text) {
    const usages = [];
    for (const { pattern, kind } of [
        { pattern: INCLUDE_DIRECTIVE, kind: 'directive' },
        { pattern: JSP_INCLUDE_ACTION, kind: 'action' },
    ]) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const range = match.indices?.[1];
            if (range) {
                usages.push({ path: match[1], range, kind });
            }
        }
    }
    return usages;
}
/** Finds every `prefix:functionName(` EL function call in the document, with its own arguments.
 * `bareSpans` (default none) extends the scan to configured bare EL attributes too -- see
 * `BareElSpan`'s own doc above. */
function findAllElFunctionCalls(text, bareSpans = elLexer_1.NO_BARE_EL_SPANS) {
    return (0, elChainAdapter_1.collectElFunctionCallsInDocument)(text, bareSpans);
}
/** Finds every FQCN-looking token inside every scriptlet/scriptlet-expression block. */
function findAllScriptletFqcns(text) {
    const usages = [];
    SCRIPTLET_BLOCK.lastIndex = 0;
    let block;
    while ((block = SCRIPTLET_BLOCK.exec(text)) !== null) {
        const contentRange = block.indices?.[1];
        if (!contentRange) {
            continue;
        }
        const content = text.slice(contentRange[0], contentRange[1]);
        FQCN_TOKEN.lastIndex = 0;
        let fqcnMatch;
        while ((fqcnMatch = FQCN_TOKEN.exec(content)) !== null) {
            const localRange = fqcnMatch.indices?.[0];
            if (!localRange) {
                continue;
            }
            usages.push({
                fqcn: fqcnMatch[0],
                range: [contentRange[0] + localRange[0], contentRange[0] + localRange[1]],
            });
        }
    }
    return usages;
}
/** Finds every FQCN declared by a `<%@page import="...">` directive (wildcard imports excluded). */
function findAllPageImportFqcns(text) {
    const usages = [];
    PAGE_IMPORT.lastIndex = 0;
    let match;
    while ((match = PAGE_IMPORT.exec(text)) !== null) {
        const groupRange = match.indices?.[1];
        if (groupRange) {
            usages.push(...splitFqcnList(text, groupRange));
        }
    }
    return usages;
}
// The attrs group is quote-aware (alternating "a whole quoted string" with "a single non-`>`
// char") rather than the simpler `[^>]*` it used to be -- a naive `[^>]*` stops at the *first* `>`
// anywhere in the tag, including one inside a quoted attribute value (e.g. `type="java.util.Map
// <java.lang.String, web.filter.SearchFilter.SearchFilterOption>"`, `searchresults.jsp`'s own
// `searchFilterOptions`), truncating `attrs` mid-value with its closing quote never reached --
// which then makes every `USE_BEAN_*_ATTR` regex below fail to match at all (no closing `"` left
// to find), silently dropping the whole declaration (see `findUseBeanDeclarations`'s `if (id &&
// fqcn)`) rather than just failing to resolve its type. `findCustomTagUsages`'s own tag scanner
// (`scanTagAttributes`) already handles this correctly via a real character-by-character walk;
// this hand-rolled regex just hadn't caught up to the same case.
// `d` (hasIndices): both this and the two attribute regexes below need their capture groups'
// absolute positions, not just their text -- `scanUseBeanTags` composes them (`attrsRange[0] +
// fqcnLocalRange[0]`, same idiom `scanSetPropertyTags` below already uses for `propertyRange`) to
// give `findAllUseBeanClasses`/`findUseBeanClassAt` a real range to anchor a diagnostic/hover to.
const USE_BEAN_TAG = /<jsp:useBean\b((?:"[^"]*"|'[^']*'|[^>])*)\/?>/gd;
const USE_BEAN_ID_ATTR = /\bid\s*=\s*"([^"]+)"/;
const USE_BEAN_CLASS_ATTR = /\bclass\s*=\s*"([\w.]+)"/d;
// Unlike `class=` (always a concrete, instantiable class -- never legitimately generic), `type=`
// can be a full parameterized type -- `[\w.]+` doesn't include `<`/`>`/`,`/` `, so even with
// `USE_BEAN_TAG` above no longer truncating `attrs` early, this still needs to accept the whole
// generic type text. The type string itself is already stored and consumed as-is downstream (e.g.
// `EL_IMPLICIT_OBJECT_TYPES`'s own generic entries, `resolveIterationElementType`), so capturing
// the full quoted value -- same `([^"]+)` `USE_BEAN_ID_ATTR` above already uses -- is all that was
// needed; nothing downstream assumed a bare `[\w.]+` shape.
const USE_BEAN_TYPE_ATTR = /\btype\s*=\s*"([^"]+)"/d;
// Loose, deliberately permissive presence checks -- true whenever the attribute's name and `=`
// appear anywhere in `attrs` textually, regardless of whether the real extraction regexes below
// could actually pull a value out of it. Used only to tell apart "this attribute is genuinely
// absent" (not a bug -- e.g. a `<jsp:useBean id="X">` with no `class`/`type` at all really can't be
// typed) from "this attribute is right there in the source but the real extraction regex still
// came up empty" (a bug in *this scanner*, not in the JSP -- see
// `scannerParseFailureDiagnostics.ts`, which surfaces the latter as its own diagnostic).
const ID_ATTR_PRESENT = /\bid\s*=/;
const TYPE_OR_CLASS_ATTR_PRESENT = /\b(?:class|type)\s*=/;
// The one pass over `USE_BEAN_TAG`/its attribute regexes that both `findUseBeanDeclarations` and
// `findUseBeanParseFailures` build on -- rather than each independently re-scanning the same tags
// with their own copy of this extraction, which is exactly the kind of parallel-implementation
// drift this extension has had to unwind before (see `TagAttributesResolver`'s and
// `resolveChainHop`'s own history).
function scanUseBeanTags(text) {
    const declarations = [];
    const parseFailures = [];
    USE_BEAN_TAG.lastIndex = 0;
    let match;
    while ((match = USE_BEAN_TAG.exec(text)) !== null) {
        const attrs = match[1];
        const attrsRange = match.indices?.[1];
        const id = USE_BEAN_ID_ATTR.exec(attrs)?.[1];
        // `class` preferred over `type` (see this function's own doc); short-circuits the `type=` exec
        // entirely once `class=` already matched, same "class wins" outcome the old `??`-on-values form
        // had, just without the wasted second `exec` call once the first already succeeded.
        const fqcnMatch = USE_BEAN_CLASS_ATTR.exec(attrs) ?? USE_BEAN_TYPE_ATTR.exec(attrs);
        const fqcn = fqcnMatch?.[1];
        const fqcnLocalRange = fqcnMatch?.indices?.[1];
        if (id && fqcn && attrsRange && fqcnLocalRange) {
            declarations.push({
                id,
                fqcn,
                start: match.index,
                fqcnRange: [attrsRange[0] + fqcnLocalRange[0], attrsRange[0] + fqcnLocalRange[1]],
            });
        }
        else if (ID_ATTR_PRESENT.test(attrs) && TYPE_OR_CLASS_ATTR_PRESENT.test(attrs)) {
            parseFailures.push([match.index, match.index + match[0].length]);
        }
    }
    return { declarations, parseFailures };
}
/**
 * Finds every `<jsp:useBean id="..." class/type="...">` declaration in the
 * document, pairing its scoped variable `id` with the Java type it's
 * declared as. Used to trace a `<jsp:setProperty name="id" ...>` back to a
 * concrete class to validate its `property` against (see
 * `setPropertyDiagnostics.ts`) -- unlike `findAllUseBeanClasses`, which only
 * extracts the type for "go to definition" and doesn't care about `id`.
 * Prefers `class` over `type` when a (spec-invalid) declaration has both;
 * either is a safe lower bound on the runtime object's members, since
 * `<jsp:useBean>` either constructs an instance of `class` directly, or
 * throws a `ClassCastException` if an existing scoped attribute isn't
 * assignable to `type`.
 */
function findUseBeanDeclarations(text) {
    return scanUseBeanTags(text).declarations;
}
/** See `UseBeanScanResult.parseFailures`' own doc. */
function findUseBeanParseFailures(text) {
    return scanUseBeanTags(text).parseFailures;
}
// Quote-aware for the same reason `USE_BEAN_TAG` above is -- a plain `[^>]*` would truncate
// `attrs` at a literal `>` inside a quoted value (e.g. an EL comparison like `value="${x > 5}"`),
// silently losing every attribute after it.
const SET_PROPERTY_TAG = /<jsp:setProperty\b((?:"[^"]*"|'[^']*'|[^>])*)\/?>/gd;
const SET_PROPERTY_NAME_ATTR = /\bname\s*=\s*"([^"]+)"/;
const SET_PROPERTY_PROPERTY_ATTR_INDEXED = /\bproperty\s*=\s*"([^"]+)"/d;
// Same reasoning as `ID_ATTR_PRESENT`/`TYPE_OR_CLASS_ATTR_PRESENT` above.
const NAME_ATTR_PRESENT = /\bname\s*=/;
const PROPERTY_ATTR_PRESENT = /\bproperty\s*=/;
// The one pass every `findSetPropertyUsages`/`findSetPropertyParseFailures` caller builds on -- see
// `scanUseBeanTags`'s own doc for why this stays a single shared scan rather than two.
function scanSetPropertyTags(text) {
    const usages = [];
    const parseFailures = [];
    SET_PROPERTY_TAG.lastIndex = 0;
    let match;
    while ((match = SET_PROPERTY_TAG.exec(text)) !== null) {
        const attrsRange = match.indices?.[1];
        if (!attrsRange) {
            continue;
        }
        const attrs = match[1];
        const beanName = SET_PROPERTY_NAME_ATTR.exec(attrs)?.[1];
        const propertyMatch = SET_PROPERTY_PROPERTY_ATTR_INDEXED.exec(attrs);
        const propertyLocalRange = propertyMatch?.indices?.[1];
        if (beanName && propertyMatch && propertyLocalRange) {
            if (propertyMatch[1] !== '*') {
                usages.push({
                    beanName,
                    property: propertyMatch[1],
                    propertyRange: [attrsRange[0] + propertyLocalRange[0], attrsRange[0] + propertyLocalRange[1]],
                });
            }
            // `property="*"` falls through with no usage pushed, same as before -- a real, deliberate
            // skip (see this function's own doc), not a parse failure, since extraction plainly succeeded.
        }
        else if (NAME_ATTR_PRESENT.test(attrs) && PROPERTY_ATTR_PRESENT.test(attrs)) {
            parseFailures.push([match.index, match.index + match[0].length]);
        }
    }
    return { usages, parseFailures };
}
/**
 * Finds every `<jsp:setProperty name="..." property="...">` usage in the
 * document, with the range of just the `property` value (for anchoring a
 * diagnostic to it). Skips `property="*"` -- that form binds every request
 * parameter matching a settable property by name, so there's no single
 * property name here to validate.
 */
function findSetPropertyUsages(text) {
    return scanSetPropertyTags(text).usages;
}
/** See `UseBeanScanResult.parseFailures`' own doc -- same shape, for `jsp:setProperty` instead. */
function findSetPropertyParseFailures(text) {
    return scanSetPropertyTags(text).parseFailures;
}
/**
 * Classifies where, within an attribute list, a completion request's cursor sits -- shared by
 * `TagAttributeCompletionProvider` and `DirectiveAttributeCompletionProvider`, whose two copies
 * of this were identical: the cursor is "inside" an attribute's value when it's anywhere from
 * right after the opening quote to right before the closing one (inclusive on both ends, so
 * completion still fires with an empty value or right at either edge); otherwise it suggests
 * attribute names not already used elsewhere in this tag/directive (the one the cursor is
 * currently sitting inside of is excluded from that set, since it's a partial name being typed,
 * not a completed usage to avoid duplicating).
 */
function classifyAttributePosition(attributes, offset) {
    for (const attribute of attributes) {
        if (attribute.valueRange && offset >= attribute.valueRange[0] && offset <= attribute.valueRange[1]) {
            return { kind: 'value', attributeName: attribute.name };
        }
    }
    const usedNames = new Set(attributes
        .filter((attribute) => !(offset >= attribute.range[0] && offset <= attribute.range[1]))
        .map((attribute) => attribute.name));
    return { kind: 'name', usedNames };
}
/**
 * A completion item's `sortText` for an attribute-name suggestion -- required attributes first,
 * then alphabetical within each group. Shared by `TagAttributeCompletionProvider` and
 * `DirectiveAttributeCompletionProvider`, whose two copies of this same one-line convention were
 * identical.
 */
function requiredFirstSortText(name, required) {
    return `${required ? '0' : '1'}${name}`;
}
const IDENTIFIER_START = /[A-Za-z_]/;
const IDENTIFIER_CHAR = /[\w-]/;
const WHITESPACE = /\s/;
const endsAtUnquotedTagClose = (text, i) => text[i] === '>';
/**
 * Scans an attribute list (`name="value" name2="value2" ...`) starting right
 * after some opening construct, tracking quote state so a character that
 * would otherwise end the scan (by default an unquoted `>`, the end of a
 * custom tag) isn't confused with the same character inside an attribute's EL
 * value (e.g. `value="${a > b}"`). `isEnd` is checked only between
 * attributes -- i.e. never while a quoted value is being consumed -- so it's
 * only asked to recognize an unquoted occurrence in the first place; pass a
 * different one to scan a directive's `... %>` instead (see
 * `findEnclosingDirective`). Returns the index the scan stopped at (where
 * `isEnd` first matched) alongside the attributes themselves -- `end` is
 * meaningless to most callers (the directive-scanning ones), but
 * `findCustomTagUsages` needs it to tell a self-closing `<sm:set .../>` from
 * one with a body apart from re-scanning the same quote-aware territory
 * itself.
 */
function scanTagAttributes(text, from, isEnd = endsAtUnquotedTagClose) {
    const attributes = [];
    let i = from;
    while (i < text.length && !isEnd(text, i)) {
        if (IDENTIFIER_START.test(text[i])) {
            const nameStart = i;
            while (i < text.length && IDENTIFIER_CHAR.test(text[i])) {
                i++;
            }
            const name = text.slice(nameStart, i);
            const attribute = { name, range: [nameStart, i] };
            attributes.push(attribute);
            while (i < text.length && WHITESPACE.test(text[i])) {
                i++;
            }
            if (text[i] === '=') {
                i++;
                while (i < text.length && WHITESPACE.test(text[i])) {
                    i++;
                }
                const quote = text[i];
                if (quote === '"' || quote === "'") {
                    i++;
                    const valueStart = i;
                    // JSP allows escaping the delimiting quote character inside an
                    // attribute value with a backslash (e.g. a JSON literal like
                    // `value="{\"id\": \"${x}\"}"`) -- see "Quoting and Escape
                    // Conventions", Jakarta Server Pages spec section 1.6:
                    // https://jakarta.ee/specifications/pages/3.0/jakarta-server-pages-spec-3.0.pdf
                    // An escaped quote isn't the value's real end, so skip the pair
                    // rather than stopping on it.
                    while (i < text.length && text[i] !== quote) {
                        if (text[i] === '\\' && i + 1 < text.length) {
                            i += 2;
                            continue;
                        }
                        i++;
                    }
                    attribute.value = text.slice(valueStart, i);
                    attribute.valueRange = [valueStart, i];
                    i++; // consume the closing quote
                }
            }
        }
        else {
            i++;
        }
    }
    return { attributes, end: i };
}
/** Finds every custom-tag element (`<prefix:name ...>`) and its attribute names. */
function findCustomTagUsages(text) {
    const usages = [];
    CUSTOM_TAG_ELEMENT.lastIndex = 0;
    let match;
    while ((match = CUSTOM_TAG_ELEMENT.exec(text)) !== null) {
        const prefixRange = match.indices?.[1];
        const tagNameRange = match.indices?.[2];
        const wholeMatchRange = match.indices?.[0];
        if (!prefixRange || !tagNameRange || !wholeMatchRange) {
            continue;
        }
        const { attributes, end } = scanTagAttributes(text, wholeMatchRange[1]);
        // `end` sits on the terminating unquoted `>` itself (or `text.length`, for a tag that never
        // closes -- treated as not self-closing, same as any other malformed/incomplete case this
        // extension just doesn't flag). Skip back over any whitespace before it (`<sm:set ... />`)
        // to see whether a `/` immediately precedes it.
        let selfCloseCheck = end - 1;
        while (selfCloseCheck >= 0 && WHITESPACE.test(text[selfCloseCheck])) {
            selfCloseCheck--;
        }
        usages.push({
            prefix: match[1],
            tagName: match[2],
            nameRange: [prefixRange[0], tagNameRange[1]],
            attributes,
            selfClosing: text[selfCloseCheck] === '/',
        });
    }
    return usages;
}
// Quote-aware scan for an unquoted occurrence of whatever `isMarker`
// recognizes, between two offsets -- same escape-handling as
// scanTagAttributes's value scan, but only asking "has the enclosing
// construct closed yet", not extracting attributes.
function hasUnquotedMarker(text, from, to, isMarker) {
    let quote;
    for (let i = from; i < to; i++) {
        const ch = text[i];
        if (quote) {
            if (ch === '\\') {
                i++;
            }
            else if (ch === quote) {
                quote = undefined;
            }
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
        }
        else if (isMarker(text, i)) {
            return true;
        }
    }
    return false;
}
function hasUnquotedTagClose(text, from, to) {
    return hasUnquotedMarker(text, from, to, endsAtUnquotedTagClose);
}
const endsAtUnquotedDirectiveClose = (text, i) => text[i] === '%' && text[i + 1] === '>';
/**
 * Finds the custom tag whose attribute list the given offset falls inside,
 * e.g. `<sm:url route="x" |` while it's still being typed. Unlike
 * `findCustomTagUsages`, which only recognizes a tag once it's closed with an
 * unquoted `>`, this also matches one that isn't closed yet -- exactly the
 * state a completion provider sees mid-edit. Used by
 * `TagAttributeCompletionProvider` to know which tag (and which of its
 * attributes are already used) a completion request is inside.
 */
function findEnclosingCustomTag(text, offset) {
    CUSTOM_TAG_ELEMENT.lastIndex = 0;
    let match;
    let candidate;
    while ((match = CUSTOM_TAG_ELEMENT.exec(text)) !== null) {
        const wholeRange = match.indices?.[0];
        if (!wholeRange || wholeRange[1] > offset) {
            break;
        }
        candidate = { prefix: match[1], tagName: match[2], contentStart: wholeRange[1] };
    }
    if (!candidate || hasUnquotedTagClose(text, candidate.contentStart, offset)) {
        return undefined;
    }
    return {
        prefix: candidate.prefix,
        tagName: candidate.tagName,
        attributes: scanTagAttributes(text, candidate.contentStart).attributes,
    };
}
// Just the opening of a directive -- `<%@ page`, `<%@include`, `<%@tag`, etc.
// -- deliberately not requiring its closing `%>`, so this also matches one
// that's still being typed.
const DIRECTIVE_START = /<%@\s*([a-zA-Z]+)\b/gd;
/**
 * Finds the directive (`<%@page ...%>`, `<%@attribute ...%>`, etc.) the given
 * offset falls inside -- either on the directive's own name (e.g. hovering
 * "attribute" in `<%@attribute name="x" %>`) or its attribute list,
 * including one that isn't closed with `%>` yet (the state a completion
 * provider sees mid-edit, same idea as `findEnclosingCustomTag`). Used by
 * `DirectiveHoverProvider` and `DirectiveAttributeCompletionProvider`; which
 * directive kind this actually is (and whether that's even a real directive
 * name) is left to `DIRECTIVES` in `directiveAttributes.ts` to judge.
 */
function findEnclosingDirective(text, offset) {
    DIRECTIVE_START.lastIndex = 0;
    let match;
    let candidate;
    while ((match = DIRECTIVE_START.exec(text)) !== null) {
        const wholeRange = match.indices?.[0];
        const nameRange = match.indices?.[1];
        if (!wholeRange || !nameRange || wholeRange[0] > offset) {
            break;
        }
        candidate = { directiveName: match[1], nameRange, bodyStart: wholeRange[1] };
    }
    if (!candidate || hasUnquotedMarker(text, candidate.bodyStart, offset, endsAtUnquotedDirectiveClose)) {
        return undefined;
    }
    return {
        directiveName: candidate.directiveName,
        nameRange: candidate.nameRange,
        attributes: scanTagAttributes(text, candidate.bodyStart, endsAtUnquotedDirectiveClose).attributes,
    };
}
// Like CUSTOM_TAG_ELEMENT, but the tag-name portion is optional -- so this
// also matches right after just the prefix and colon, with no tag name typed
// yet at all (e.g. `<sm:`), which CUSTOM_TAG_ELEMENT's `\b`-terminated
// `[A-Za-z][\w-]*` can't (it requires at least one tag-name character).
const CUSTOM_TAG_NAME_START = /<([A-Za-z][\w-]*):([A-Za-z][\w-]*)?/gd;
/**
 * Finds a custom tag's `prefix:` opening whose (possibly still-empty) tag
 * name covers the given offset, e.g. `<sm:ur|` or `<sm:|`. Used for tag-*name*
 * completion, as opposed to `findEnclosingCustomTag`, which requires at least
 * one tag-name character to already identify which tag's *attributes* are
 * being completed.
 */
function findCustomTagNameContextAt(text, offset) {
    CUSTOM_TAG_NAME_START.lastIndex = 0;
    let match;
    while ((match = CUSTOM_TAG_NAME_START.exec(text)) !== null) {
        const wholeRange = match.indices?.[0];
        if (!wholeRange) {
            continue;
        }
        const nameRange = match.indices?.[2] ?? [wholeRange[1], wholeRange[1]];
        if (offset >= nameRange[0] && offset <= nameRange[1]) {
            return { prefix: match[1], nameRange };
        }
    }
    return undefined;
}
/**
 * Finds every *complete* directive in the document -- one that actually
 * closes with an unquoted `%>` somewhere after it, as opposed to
 * `findEnclosingDirective`, which also matches one still being typed (right
 * for a completion/hover request at a live cursor position, wrong for a
 * diagnostic pass over a whole document: a directive mid-edit elsewhere in
 * the file shouldn't get flagged for attributes it hasn't finished typing
 * yet). Used by `DirectiveAttributeDiagnostics`.
 */
function findAllDirectives(text) {
    const usages = [];
    DIRECTIVE_START.lastIndex = 0;
    let match;
    while ((match = DIRECTIVE_START.exec(text)) !== null) {
        const nameRange = match.indices?.[1];
        const bodyStart = match.indices?.[0]?.[1];
        if (nameRange === undefined || bodyStart === undefined) {
            continue;
        }
        if (!hasUnquotedMarker(text, bodyStart, text.length, endsAtUnquotedDirectiveClose)) {
            continue; // never closes -- still being typed, not a real diagnostic target.
        }
        usages.push({
            directiveName: match[1],
            nameRange,
            attributes: scanTagAttributes(text, bodyStart, endsAtUnquotedDirectiveClose).attributes,
        });
    }
    return usages;
}
/**
 * Every explicit, single-type import declared via this document's own `page`/`tag` directive(s) --
 * multiple directives (`authorize.jsp` has two separate `<%@ page import="...">` lines) and multiple
 * comma-separated entries per directive all accumulate, matching how the JSP spec treats them (its
 * `import` attribute's syntax is defined as identical to a Java `import` declaration, so multiple
 * imports are cumulative the same way multiple Java `import` statements are).
 *
 * Deliberately excludes a wildcard entry (`"a.b.*"`): unlike a single-type import, which names its
 * own FQCN directly in the directive text, confirming what a wildcard actually resolves to needs a
 * live jdtls lookup per candidate simple name -- and this file stays jdtls/vscode-free by design (see
 * `BareElSpan`'s own doc above). `variableTypes.ts`/`elDiagnostics.ts`, the two current callers, only
 * need the single-type case today; wildcard support -- were it added -- belongs entirely in whichever
 * of those actually ends up doing that jdtls lookup, not here.
 */
function findPageImports(text) {
    const imports = [];
    for (const directive of findAllDirectives(text)) {
        if (directive.directiveName !== 'page' && directive.directiveName !== 'tag') {
            continue;
        }
        const value = directive.attributes.find((attribute) => attribute.name === 'import')?.value;
        for (const entry of value?.split(',') ?? []) {
            const fqcn = entry.trim();
            if (fqcn && !fqcn.endsWith('.*')) {
                imports.push({ simpleName: fqcn.slice(fqcn.lastIndexOf('.') + 1), fqcn });
            }
        }
    }
    return imports;
}
//# sourceMappingURL=jspScan.js.map