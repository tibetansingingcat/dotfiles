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
exports.VariableTypeResolver = exports.EL_IMPLICIT_OBJECT_TYPES = exports.VariableTypeTimeline = void 0;
exports.getBindingTagConfigs = getBindingTagConfigs;
exports.findTagVariableBindingUsages = findTagVariableBindingUsages;
exports.findConfiguredBareElSpans = findConfiguredBareElSpans;
const vscode = __importStar(require("vscode"));
const elParser_1 = require("./el/elParser");
const elTypeInference_1 = require("./el/elTypeInference");
const javaSymbols_1 = require("./javaSymbols");
const variableTypeTimeline_1 = require("./variableTypeTimeline");
var variableTypeTimeline_2 = require("./variableTypeTimeline");
Object.defineProperty(exports, "VariableTypeTimeline", { enumerable: true, get: function () { return variableTypeTimeline_2.VariableTypeTimeline; } });
const jspScan_1 = require("./jspScan");
const tagAttributes_1 = require("./tagAttributes");
const SETTING = "vscode-jsp-linker.elBindingTags";
function getBindingTagConfigs() {
    return vscode.workspace
        .getConfiguration()
        .get(SETTING, []);
}
/**
 * The 11 JSP EL implicit objects and their fixed, spec-defined types -- unlike `elBindingTags`,
 * there's nothing workspace-specific to configure here, same reasoning as the static `DIRECTIVES`
 * table in `directiveAttributes.ts`. This is also `elDiagnostics.ts`'s single source of truth for
 * which bare names count as an implicit object (its own `EL_IMPLICIT_OBJECTS` Set is derived from
 * this map's keys) -- previously that list was hand-duplicated there with no type information at
 * all, since nothing resolved these to a real type before now.
 *
 * `param`/`header`/`initParam` are `Map<String,String>`; `paramValues`/`headerValues` are
 * `Map<String,String[]>` instead, since (unlike their singular counterparts) a request parameter or
 * header name can be repeated; `cookie` is `Map<String,Cookie>`; the four `*Scope` maps are
 * `Map<String,Object>`, since a scope attribute can hold any type. `pageContext` is the one
 * non-`Map` implicit object -- it resolves like any other bean, through its own real getters
 * (`getSession()`, `getRequest()`, ...), so it needs no special handling beyond being seeded here.
 */
exports.EL_IMPLICIT_OBJECT_TYPES = new Map([
    ["pageContext", "jakarta.servlet.jsp.PageContext"],
    ["pageScope", "java.util.Map<java.lang.String,java.lang.Object>"],
    ["requestScope", "java.util.Map<java.lang.String,java.lang.Object>"],
    ["sessionScope", "java.util.Map<java.lang.String,java.lang.Object>"],
    ["applicationScope", "java.util.Map<java.lang.String,java.lang.Object>"],
    ["param", "java.util.Map<java.lang.String,java.lang.String>"],
    ["paramValues", "java.util.Map<java.lang.String,java.lang.String[]>"],
    ["header", "java.util.Map<java.lang.String,java.lang.String>"],
    ["headerValues", "java.util.Map<java.lang.String,java.lang.String[]>"],
    ["initParam", "java.util.Map<java.lang.String,java.lang.String>"],
    ["cookie", "java.util.Map<java.lang.String,jakarta.servlet.http.Cookie>"],
]);
/**
 * Parses an attribute value that's *only* one `${...}`/`#{...}` EL block (e.g. `"${0}"`,
 * `"${_onePerRow ? 500 : 150}"`, `"${_favourite.film}"`), returning that block's own `ElNode` --
 * `undefined` for anything else: a value with no `${}`/`#{}` at all (a plain literal JSP attribute,
 * not EL), or one that's only *partly* EL (e.g. `"prefix-${x}"`, several parts). `<sm:set
 * value="...">`'s runtime semantics only care whether `value` was specified at all (see
 * `SetTagBase.findValue`), but for typing purposes this extension only attempts a usage that's
 * nothing but a single EL expression -- see `inferElExpressionType` (el/elTypeInference.ts) for what
 * it can resolve from that expression.
 */
function parseSingleElBlock(value) {
    const doc = (0, elParser_1.parseElDocument)(value);
    if (doc.parts.length !== 1) {
        return undefined;
    }
    const part = doc.parts[0];
    return part.kind === "DynamicExpression" || part.kind === "DeferredExpression"
        ? part.expression
        : undefined;
}
function findAttribute(usage, name) {
    return usage.attributes.find((attribute) => attribute.name === name);
}
function attributeValue(usage, name) {
    return findAttribute(usage, name)?.value;
}
// Narrows a `'field'`/`'alias'` usage down to the ones that actually bind a variable -- see those
// two kinds' own doc on why `var` is optional there in the first place. `VariableTypeResolver` only
// cares about usages that type *something*; a var-less usage (e.g. `<sm:when name="X">`) exists
// purely for `TagFieldDiagnostics` to validate `source`/`field` against, not to feed a type back
// into this file's own resolution.
function hasVar(usage) {
    return usage.var !== undefined;
}
/**
 * Finds every configured tag's variable-binding usage in the document, in
 * source order (later ones can depend on a variable an earlier one just
 * declared). Seven ways a usage can resolve, checked in this order:
 * a configured `type` (`kind: 'literal'` -- see `BindingTagConfig.type`'s own
 * doc, a fixed type with no lookup needed, so it's checked first and short-
 * circuits the rest); a configured `classAttribute`, resolved as `kind: 'literal'` again from that
 * usage's own attribute value (see `BindingTagConfig.classAttribute`'s own doc) rather than from
 * config; `value` as a resolvable EL expression (`kind: 'expression'` -- anything
 * `inferElExpressionType` can type, not just a bare chain, see that function's own doc), or, when
 * `value` is present but isn't EL at all, a configured `literalValueType` (`kind: 'literal'` again --
 * see that field's own doc); a resolvable `source`
 * (the configured attribute, or `defaultSource` when `field` is present but
 * that attribute isn't -- see `BindingTagConfig`) together with a *literal*
 * `field` (`kind: 'field'`, a reflective property lookup -- a `field` whose
 * value is itself a dynamic EL expression, e.g. `field="${fieldName}"`,
 * doesn't count as literal here, see the check below); failing that, a configured
 * `alternateSources` entry whose own attribute is present on this usage (`kind: 'field'` again,
 * just with the property name fixed by config instead of read from the usage -- see
 * `BindingTagConfig.alternateSources`'s own doc); a resolvable
 * `source` alone, with no `field` attribute at all (`kind: 'alias'` --
 * `var`'s type is just `source`'s own type, e.g. `<sm:set var="X"
 * name="Y"/>`); or, when neither a `source` nor a `field` attribute is
 * present *at all* (not merely unresolvable -- see `BindingTagConfig.bodyType`'s
 * own doc for why that distinction matters) and the usage actually opens a body rather than
 * self-closing (`usage.selfClosing`, also gated per that same doc), a configured `bodyType`
 * (`kind: 'literal'` again, e.g. `<sm:set var="X">...</sm:set>` with no
 * `name`/`field`/`value`, which falls back to the tag's body text at
 * runtime). Anything else -- most commonly a `field` attribute present but
 * not resolvable to a literal property name, a self-closing usage with no other resolvable
 * attribute, or a `source`/`field` gap this
 * tag hasn't configured a `bodyType` for -- is still recorded, as `kind:
 * 'unresolved'`, rather than left out entirely, so a rebinding this extension can't type still clears
 * any stale type an earlier, unrelated declaration of the same variable name
 * left behind -- see `TagVariableBindingUsage`'s `'unresolved'` case.
 *
 * Also emits one `kind: 'literal'` usage per entry in the config's `also`
 * (see that field's own doc) whose `var` attribute is present on this usage
 * -- each such variable is always a fixed type, so it needs none of the
 * above resolution, just the same "present or skipped" treatment `var`
 * itself gets.
 */
function findTagVariableBindingUsages(text, tagConfigs) {
    if (tagConfigs.length === 0) {
        return [];
    }
    const configByTag = new Map(tagConfigs.map((config) => [config.tag, config]));
    const usages = [];
    for (const usage of (0, jspScan_1.findCustomTagUsages)(text)) {
        const config = configByTag.get(`${usage.prefix}:${usage.tagName}`);
        if (!config) {
            continue;
        }
        const offset = usage.nameRange[0];
        for (const also of config.also ?? []) {
            const alsoVarName = attributeValue(usage, also.var);
            if (alsoVarName) {
                usages.push({
                    var: alsoVarName,
                    kind: "literal",
                    type: also.type,
                    iterates: false,
                    offset,
                });
            }
        }
        // A tag can be configured with no `var` at all -- e.g. Supermodel's `sm:out`/`sm:if`/`sm:when`,
        // which read a `source`/`field` but never bind a new page variable to it (see
        // `TagVariableBindingUsage`'s `'field'`/`'alias'` cases' own doc). Only bail out here when the
        // tag *does* declare a `var` attribute but this particular usage didn't supply it -- there's
        // nothing to record for a rebind that never happened. When the tag has no `var` configured,
        // fall through with `varName` left `undefined` into the `source`/`field` resolution below --
        // every other resolution kind (`type`/`classAttribute`/`value`/`bodyType`) only makes sense for
        // a variable that's actually being bound, so those all stay gated on `varName` being present.
        const varName = config.var ? attributeValue(usage, config.var) : undefined;
        if (config.var && !varName) {
            continue;
        }
        const iterates = config.iterates === true;
        const iterationUnwrap = config.iterationUnwrap;
        if (varName) {
            if (config.type) {
                usages.push({
                    var: varName,
                    kind: "literal",
                    type: config.type,
                    iterates,
                    iterationUnwrap,
                    offset,
                });
                continue;
            }
            // A `classAttribute` whose own value is missing, or is itself EL (e.g. `classCodes="${x}"`,
            // no statically-known class), falls through to whatever else this tag is configured with --
            // in practice nothing, for a class-lookup tag like `sm:ancestor`, so it lands on 'unresolved'
            // at the bottom, same "don't guess" treatment `field`'s own EL-exclusion gets above.
            const rawClassAttribute = config.classAttribute
                ? attributeValue(usage, config.classAttribute)
                : undefined;
            const classCode = rawClassAttribute && !rawClassAttribute.includes("${")
                ? rawClassAttribute.split(/[,\s]+/).filter(Boolean)[0]
                : undefined;
            if (classCode) {
                usages.push({
                    var: varName,
                    kind: "literal",
                    type: classCode,
                    iterates,
                    iterationUnwrap,
                    offset,
                });
                continue;
            }
            const valueAttribute = config.value
                ? findAttribute(usage, config.value)
                : undefined;
            const rawValue = valueAttribute?.value;
            if (rawValue !== undefined) {
                const node = parseSingleElBlock(rawValue);
                if (node) {
                    usages.push({
                        var: varName,
                        kind: "expression",
                        node,
                        sourceText: rawValue,
                        valueRange: valueAttribute.valueRange,
                        iterates,
                        iterationUnwrap,
                        offset,
                    });
                }
                else if (config.literalValueType) {
                    usages.push({
                        var: varName,
                        kind: "literal",
                        type: config.literalValueType,
                        iterates,
                        iterationUnwrap,
                        offset,
                    });
                }
                else {
                    usages.push({ var: varName, kind: "unresolved", offset });
                }
                continue;
            }
        }
        const fieldAttribute = config.field
            ? findAttribute(usage, config.field)
            : undefined;
        // A `field` attribute's value is meant to be a literal, non-EL Java
        // property name (see `BindingTagConfig.field`'s own doc), resolved
        // reflectively by the tag at runtime. A handful of real usages instead
        // put a dynamic EL expression there (e.g. `field="${fieldName}"`,
        // evaluated to a runtime string by the JSP engine itself before the tag
        // ever sees it) -- there's no way to know statically which property that
        // resolves to, so this is deliberately excluded from `field` below
        // (falls through to 'unresolved') rather than guessing wrong two
        // different ways: attempting a getter lookup against the raw EL text
        // itself (a bogus lookup -- and, once `TagFieldDiagnostics` exists, a
        // false-positive diagnostic on a file that has no actual bug), or
        // silently falling back to `source`'s own type as if `field` hadn't been
        // given at all (wrong the moment the resolved property differs from
        // `source` itself, e.g. `<sm:image field="${field}">`).
        const field = fieldAttribute?.value !== undefined &&
            !fieldAttribute.value.includes("${")
            ? fieldAttribute.value
            : undefined;
        // Captured alongside `source` itself (not just its string value) so a var-less usage -- see
        // `TagVariableBindingUsage`'s `'field'`/`'alias'` cases -- still has a token range to anchor a
        // `TagFieldDiagnostics` diagnostic to. `undefined` when `source` came from `defaultSource`'s
        // literal fallback instead of a real attribute -- same "no token to squiggle" case
        // `alternateSources`' own `fieldRange`-less `'field'` usage below has for its *field name*
        // specifically (its own `source` token is captured separately just below, not omitted the
        // same way).
        const sourceAttribute = config.source
            ? findAttribute(usage, config.source)
            : undefined;
        const source = sourceAttribute?.value ??
            (fieldAttribute !== undefined ? config.defaultSource : undefined);
        const sourceRange = sourceAttribute?.valueRange;
        // Checked ahead of `bodyType`/`unresolved` but only actually matches when none of `field`'s
        // own attribute (above) is present either -- an `alternateSources` attribute and the tag's
        // ordinary `source`/`field` pair are mutually exclusive ways of specifying the same thing
        // (see that field's own doc), so a usage isn't expected to supply both.
        // Keeps the whole matched attribute (`findAttribute`, like `sourceAttribute` above), not just
        // its string value -- `alt.attribute`'s own `valueRange` (e.g. `paginator="_viewingPaginator"`'s
        // own value token) is a real token in the document, same as `source`'s ordinary attribute is,
        // even though `field` itself (fixed by `alt.field`, e.g. "page") never has one of its own. This
        // used to only keep the string value, which meant a failure resolving this shorthand's source
        // (an unknown class, or one with no `getPage()`) had no token anywhere to anchor a diagnostic to
        // -- see `TagFieldDiagnostics`'s own `fieldRange ?? sourceRange`.
        const alternateSource = source && field
            ? undefined
            : config.alternateSources
                ?.map((alt) => ({
                alt,
                sourceAttribute: findAttribute(usage, alt.attribute),
            }))
                .find((entry) => entry.sourceAttribute?.value !== undefined);
        // Only presence matters -- see `BindingTagConfig.index`'s own doc for why an EL value here
        // (e.g. `index="${_status.index}"`) unwraps the same as a literal one.
        const indexed = config.index
            ? findAttribute(usage, config.index) !== undefined
            : false;
        if (source && field) {
            usages.push({
                var: varName,
                kind: "field",
                source,
                field,
                fieldRange: fieldAttribute.valueRange,
                sourceRange,
                iterates,
                indexed,
                iterationUnwrap,
                offset,
            });
        }
        else if (alternateSource) {
            usages.push({
                var: varName,
                kind: "field",
                source: alternateSource.sourceAttribute.value,
                field: alternateSource.alt.field,
                sourceRange: alternateSource.sourceAttribute.valueRange,
                iterates,
                indexed,
                iterationUnwrap,
                offset,
            });
        }
        else if (source && fieldAttribute === undefined) {
            usages.push({
                var: varName,
                kind: "alias",
                source,
                sourceRange,
                iterates,
                indexed,
                iterationUnwrap,
                offset,
            });
        }
        else if (varName &&
            !source &&
            fieldAttribute === undefined &&
            config.bodyType &&
            !usage.selfClosing) {
            usages.push({
                var: varName,
                kind: "literal",
                type: config.bodyType,
                iterates,
                iterationUnwrap,
                offset,
            });
        }
        else if (varName) {
            usages.push({ var: varName, kind: "unresolved", offset });
        }
    }
    return usages;
}
// A value already fully wrapped in `${...}`/`#{...}` is already found by the ordinary `${...}`
// block scan every EL-backed function in `jspScan.ts` already does -- included again here as a
// `BareElSpan` would just double-report every diagnostic on it.
const FULLY_WRAPPED_EL = /^[$#]\{[\s\S]*\}$/;
/**
 * Every configured tag's `bareElAttributes` value in the document (see
 * `BindingTagConfig.bareElAttributes`'s own doc), as a `BareElSpan` -- one entry per attribute the
 * tag itself evaluates as EL directly, without the usual `${...}`/`#{...}` wrapper (e.g.
 * Supermodel's `sm:forEach`/`sm:if` `test="not x.disabled"`). Pass the result to any of
 * `jspScan.ts`'s document-wide EL scanners (`findAllElPropertyChains`/`findAllElSyntaxErrors`/
 * `findAllElFunctionCalls`/`findTokenAt`) to fold these into the exact same chain/function-
 * call/syntax-error/hover coverage a `${...}`-wrapped equivalent already gets -- see `BareElSpan`'s
 * own doc in `jspScan.ts` for why that's one shared pipeline rather than a second, narrower one
 * bolted on beside it (which is what this function used to be *itself*, back when it only found
 * syntax errors by wrapping each value in a synthetic `${...}` and re-parsing that copy).
 */
function findConfiguredBareElSpans(text, tagConfigs) {
    const configsByTag = new Map(tagConfigs
        .filter((config) => config.bareElAttributes?.length)
        .map((config) => [config.tag, config]));
    if (configsByTag.size === 0) {
        return [];
    }
    const spans = [];
    for (const usage of (0, jspScan_1.findCustomTagUsages)(text)) {
        const config = configsByTag.get(`${usage.prefix}:${usage.tagName}`);
        if (!config) {
            continue;
        }
        for (const attributeName of config.bareElAttributes) {
            const attribute = findAttribute(usage, attributeName);
            if (!attribute?.value ||
                !attribute.valueRange ||
                FULLY_WRAPPED_EL.test(attribute.value.trim())) {
                continue;
            }
            spans.push({ text: attribute.value, start: attribute.valueRange[0] });
        }
    }
    return spans;
}
class VariableTypeResolver {
    tldIndex;
    cache = new Map();
    constructor(tldIndex) {
        this.tldIndex = tldIndex;
    }
    async resolveTypes(document, text) {
        return (await this.resolve(document, text)).types;
    }
    /** See `UnresolvedUsage`'s own doc -- for `TagFieldDiagnostics` to flag. Shares `resolveTypes`'
     * own cached computation rather than redoing it -- same reasoning as
     * `findUseBeanParseFailures`/`findSetPropertyParseFailures` sharing their scan with
     * `findUseBeanDeclarations`/`findSetPropertyUsages` in jspScan.ts. */
    async resolveUnresolvedUsages(document, text) {
        return (await this.resolve(document, text)).unresolvedUsages;
    }
    resolve(document, text) {
        const key = document.uri.toString();
        const cached = this.cache.get(key);
        if (cached && cached.version === document.version) {
            return cached.result;
        }
        const result = this.computeTypes(text, document.uri);
        this.cache.set(key, { version: document.version, result });
        return result;
    }
    async computeTypes(text, documentUri) {
        // Closes over this document's own text/uri so `resolveUsageType`'s `'expression'` case can
        // resolve an EL function call (e.g. `<sm:set value="${lfn:foo(x)}">`) the same way
        // `resolveElFunctionTarget` (tokenResolution.ts) does for hover/"go to definition" -- without
        // `elTypeInference.ts` itself needing to import `TldIndex`/`vscode.Uri`.
        const resolveFunction = (prefix, functionName) => this.tldIndex.resolveFunction(text, documentUri, prefix, functionName);
        const events = [
            ...(0, jspScan_1.findUseBeanDeclarations)(text).map((declaration) => ({
                offset: declaration.start,
                kind: "useBean",
                id: declaration.id,
                fqcn: declaration.fqcn,
            })),
            ...findTagVariableBindingUsages(text, getBindingTagConfigs())
                .filter(hasVar)
                .map((usage) => ({
                offset: usage.offset,
                kind: "tagUsage",
                usage,
            })),
        ].sort((a, b) => a.offset - b.offset);
        // The fixed JSP implicit objects (`EL_IMPLICIT_OBJECT_TYPES`), this document's own page-level
        // `<%@ page import="...">`/`<%@ tag import="...">` declarations (`findPageImports`), and a
        // `.tag` file's own `<%@attribute type="...">` declarations (no-op for a plain `.jsp`, which
        // can't contain that directive) are all in scope for the whole file the same way a method
        // parameter is, so they're seeded before any in-body event rather than modelled as one -- a
        // later `useBean`/tag-binding event for the same name still rebinds it, same precedence as
        // every other variable here. Imports are spread in first (weakest -- real EL resolves an
        // imported class name via `ImportELResolver`, which never wins against a real scoped
        // attribute/bean of the same name), then implicit objects, then attribute declarations, so a
        // (theoretical, and unlikely) attribute that reused one of those 11 names -- e.g.
        // `<%@attribute name="param">` -- would win, same "the more specific declaration wins" rule as
        // everywhere else here. `findPageImports` only ever returns an explicit single-type import
        // (`import com.letterboxd.auth.AuthScope`, not `import com.letterboxd.auth.*`) -- see its own
        // doc for why a wildcard import isn't resolved here (or anywhere yet).
        const types = new Map([
            ...(0, jspScan_1.findPageImports)(text).map((imported) => [imported.simpleName, imported.fqcn]),
            ...exports.EL_IMPLICIT_OBJECT_TYPES,
            ...(0, tagAttributes_1.parseTagAttributes)(text).declaredTypes,
        ]);
        // Seeded at offset `-1` -- these are in scope for the whole file (see the comment above), so they
        // must already be "in effect" for a query at any real (>= 0) offset, before any in-body event.
        const history = new Map();
        for (const [name, type] of types) {
            history.set(name, [{ offset: -1, type }]);
        }
        const unresolvedUsages = [];
        for (const event of events) {
            if (event.kind === "useBean") {
                types.set(event.id, event.fqcn);
                (0, variableTypeTimeline_1.recordHistory)(history, event.id, event.offset, event.fqcn);
                continue;
            }
            const usage = event.usage;
            if (usage.kind === "unresolved") {
                // This tag usage rebinds `var`, but not to anything resolvable --
                // drop whatever an earlier declaration of the same variable name
                // (a `useBean`, or another tag usage) left in the map rather than
                // let it leak forward as a stale, now-wrong type (see the
                // 'unresolved' case's own comment). Deliberately never reported as an
                // `UnresolvedUsage`, unlike the two failure points below -- this kind means "nothing here
                // to even attempt" (no source/field/value/bodyType at all, or a dynamic `field="${...}"`),
                // not "attempted and failed", so flagging it would misreport a real, common, legitimate
                // shape as if it were a bug.
                types.delete(usage.var);
                (0, variableTypeTimeline_1.recordHistory)(history, usage.var, usage.offset, undefined);
                continue;
            }
            const resolved = await this.resolveUsageType(types, usage, resolveFunction);
            if (!resolved) {
                // This usage's own source/expression never resolved to begin with. 'field'/'alias' already
                // have their own check for exactly this in `TagFieldDiagnostics` (`types.at(usage.source,
                // usage.offset)`, predating `UnresolvedUsage`), so only 'expression' -- which has no separate `source` for
                // anything else to check -- needs tracking here. `valueRange` is only absent for a config
                // with no literal value-attribute token to anchor to, same "no token to squiggle" case
                // `sourceRange`/`fieldRange` already have.
                types.delete(usage.var);
                (0, variableTypeTimeline_1.recordHistory)(history, usage.var, usage.offset, undefined);
                if (usage.kind === "expression" && usage.valueRange) {
                    unresolvedUsages.push({
                        kind: "expression",
                        range: usage.valueRange,
                        sourceText: usage.sourceText,
                    });
                }
                continue;
            }
            // `indexed` (only ever set on 'field'/'alias' -- see `TagVariableBindingUsage`'s own doc) drives
            // the exact same unwrap `iterates` does: an `index`-attribute usage resolves a collection down
            // to its element type no differently than a forEach-like `iterates: true` tag would.
            const indexed = (usage.kind === "field" || usage.kind === "alias") && usage.indexed;
            const unwraps = usage.iterates || indexed;
            const iterationSource = unwraps
                ? await this.applyIterationUnwrap(resolved, usage.iterationUnwrap)
                : resolved;
            const finalType = unwraps
                ? await (0, javaSymbols_1.resolveIterationElementType)(iterationSource)
                : resolved;
            if (finalType) {
                types.set(usage.var, finalType);
                (0, variableTypeTimeline_1.recordHistory)(history, usage.var, usage.offset, finalType);
            }
            else {
                // `resolved` came back fine, but `iterates` was requested and `resolveIterationElementType`
                // still couldn't pin down a concrete element type for it -- either its real hierarchy never
                // reaches `Iterable`/`Map` at all, or it does but the element type it finds there is an
                // unbound generic type variable rather than a real class (see `resolveIterationElementType`'s
                // own doc, and `UnresolvedUsage`'s, for why the latter still abstains rather than guessing).
                // Applies to every kind
                // that carries `iterates`, not just 'expression' -- unlike the `!resolved` branch above,
                // 'field'/'alias' have no existing coverage for *this* failure at all. 'literal' has no
                // document range to anchor to (its type is fixed in config, not read from any token here),
                // same "no token, no diagnostic" rule as everywhere else, so it's silently excluded too.
                types.delete(usage.var);
                (0, variableTypeTimeline_1.recordHistory)(history, usage.var, usage.offset, undefined);
                const range = usage.kind === "expression"
                    ? usage.valueRange
                    : usage.kind === "literal"
                        ? undefined
                        : usage.sourceRange;
                if (range) {
                    unresolvedUsages.push({
                        kind: "iteration",
                        range,
                        resolvedType: iterationSource,
                        indexed,
                    });
                }
            }
        }
        return { types: new variableTypeTimeline_1.VariableTypeTimeline(history), unresolvedUsages };
    }
    async resolveUsageType(types, usage, resolveFunction) {
        if (usage.kind === "literal") {
            return usage.type;
        }
        if (usage.kind === "expression") {
            return (0, elTypeInference_1.inferElExpressionType)(usage.node, usage.sourceText, types, resolveFunction);
        }
        const sourceType = types.get(usage.source);
        if (!sourceType) {
            return undefined;
        }
        if (usage.kind === "alias") {
            return sourceType;
        }
        // A configured tag's `field` attribute (e.g. Supermodel's own
        // sm:set/sm:forEach `field="..."`) is always a single, non-dotted
        // property name resolved by reflection at runtime -- never a method
        // call -- so this always uses getter-convention resolution, unlike a
        // chain segment (`resolveSegment`), which can be either.
        const lookup = await (0, javaSymbols_1.resolveMemberReturnType)(sourceType, (0, javaSymbols_1.getterCandidateNames)(usage.field));
        return lookup.status === "found" ? lookup.type : undefined;
    }
    /**
     * Applies this usage's own configured `BindingTagConfig.iterationUnwrap` rules (see that field's
     * own doc) before `resolveIterationElementType` walks `resolved`'s type hierarchy for `Iterable`/
     * `Map` -- e.g. a `CommentPaginator` handed to a bare `<sm:forEach name="_paginator" var="_comment">`
     * (no `field`/`paginator` attribute) is *itself* `Iterable<List<TComment>>` (a Paginator's real base
     * class also happens to implement iterating its own *pages*), which would otherwise resolve `_comment`
     * to a whole page (`List<TComment>`) instead of one comment -- exactly backwards from what Supermodel's
     * real `ForEachTagBase` actually does (it always reads `.getPage()` for a Paginator first, see
     * `iterationUnwrap`'s own doc). Returns `resolved` unchanged when no rule is configured, or when
     * `resolved` isn't assignable to any configured rule's `type` -- same "don't guess, fall through to
     * the ordinary walk" posture as everywhere else in this file. Only ever swaps in the unwrapped field's
     * own type when that field actually resolves; an unknown/missing field falls through to the ordinary
     * walk against `resolved` itself rather than silently losing the iteration entirely.
     */
    async applyIterationUnwrap(resolved, rules) {
        if (!rules) {
            return resolved;
        }
        for (const rule of rules) {
            if ((await (0, javaSymbols_1.isAssignableTo)(resolved, rule.type)) === true) {
                const lookup = await (0, javaSymbols_1.resolveMemberReturnType)(resolved, (0, javaSymbols_1.getterCandidateNames)(rule.field));
                return lookup.status === "found" ? lookup.type : resolved;
            }
        }
        return resolved;
    }
}
exports.VariableTypeResolver = VariableTypeResolver;
//# sourceMappingURL=variableTypes.js.map