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
exports.ElDiagnostics = exports.SYNTAX_SOURCE = exports.UNKNOWN_SOURCE = exports.CHAIN_SOURCE = void 0;
exports.collectElNames = collectElNames;
const vscode = __importStar(require("vscode"));
const variableTypes_1 = require("./variableTypes");
const diagnostics_1 = require("./diagnostics");
const argumentValidation_1 = require("./argumentValidation");
const elScan_1 = require("./elScan");
const jspScan_1 = require("./jspScan");
const javaSymbols_1 = require("./javaSymbols");
const settings_1 = require("./settings");
// Same opt-out as SetPropertyDiagnostics/TagFieldDiagnostics -- see the
// setting's own comment in settings.ts and its package.json description.
// All three are the same tier of check (jdtls-dependent, can under-cover but
// shouldn't false-positive) over the same underlying idea (does this
// property actually exist on this type?), so sharing one setting avoids
// three near-identical toggles.
const CHAIN_ENABLED_SETTING = settings_1.BEAN_PROPERTY_VALIDATION_ENABLED_SETTING;
// This tier is a weaker signal by design (see the class doc below) -- purely
// syntactic, doesn't touch jdtls at all -- so it gets its own opt-out rather
// than sharing CHAIN_ENABLED_SETTING.
const UNKNOWN_ENABLED_SETTING = settings_1.EL_UNKNOWN_VARIABLE_WARNING_ENABLED_SETTING;
// The one place each tier's diagnostic collection name is spelled out --
// reused below for both the collection itself and every diagnostic's
// `.source`, and exported so checkAllCommand.ts's DIAGNOSTIC_SOURCES can
// reference them too (see TldDiagnostics's own comment for why keeping these
// tied to one constant, rather than several independent literals, matters).
exports.CHAIN_SOURCE = 'jsp-el-chain';
exports.UNKNOWN_SOURCE = 'jsp-el-unknown-variable';
// A syntax error is a plain fact about the expression, not a heuristic the way the two tiers
// above are -- there's no "under-covers rather than false-positives" judgment call to make an
// opt-out meaningful for, so this is unconditional (same reasoning as LinkDiagnostics's own
// broken-link check) rather than gated by either of CHAIN_ENABLED_SETTING/UNKNOWN_ENABLED_SETTING.
exports.SYNTAX_SOURCE = 'jsp-el-syntax';
// Every one of these is a real EL binding (so it belongs in `known`, below,
// for the unknown-variable tier) with a fixed, spec-defined type (see
// `EL_IMPLICIT_OBJECT_TYPES`, this module's single source of truth for both
// the name list and each one's type) -- but it deliberately does NOT go into
// `declared`, which is what the chain tier's "known but untyped" Hint checks.
// That's still correct now that these resolve to real types: `declared` means
// "a real, user-authored declaration whose type this extension could, in
// principle, fail to resolve" -- these can't ever be in that state (their
// type is a fixed constant, not something that depends on jdtls/useBean/tag
// config), so the Hint would never have anything actionable to say about one
// regardless.
const EL_IMPLICIT_OBJECTS = new Set(variableTypes_1.EL_IMPLICIT_OBJECT_TYPES.keys());
// Historically (before jspScan.ts parsed real EL grammar) a reserved word used bare as an
// operator/literal -- e.g. "eq" in `${_count eq 1}` -- couldn't be told apart from a real
// identifier, so it'd parse as its own bare one-segment "chain" that needed filtering out here to
// avoid a false "unknown variable" Warning. `el/elLexer.ts`'s real tokenizer now resolves this
// ambiguity itself (a reserved word lexes as its own operator token, never as `IDENTIFIER`), so
// `findAllElPropertyChains` structurally can't emit a chain for one of these anymore -- this set
// is now a harmless defensive backstop rather than the correctness boundary it used to be. Kept in
// `known`-not-`declared` for the same reason as EL_IMPLICIT_OBJECTS above regardless: nothing here
// is a bug the unknown-variable tier should flag, and there's no type to ever resolve either way.
const EL_RESERVED_WORDS = new Set(['and', 'or', 'not', 'eq', 'ne', 'lt', 'gt', 'le', 'ge', 'true', 'false', 'null', 'instanceof', 'div', 'mod', 'empty']);
function isTagFile(document) {
    return document.fileName.endsWith('.tag');
}
function collectElNames(document, text) {
    const declared = new Set();
    for (const declaration of (0, jspScan_1.findUseBeanDeclarations)(text)) {
        declared.add(declaration.id);
    }
    for (const usage of (0, variableTypes_1.findTagVariableBindingUsages)(text, (0, variableTypes_1.getBindingTagConfigs)())) {
        // A `'field'`/`'alias'` usage's `var` is optional -- e.g. `<sm:when name="X">`, which reads a
        // page-context object but binds no new variable to it (see `TagVariableBindingUsage`'s own doc).
        // Nothing to declare in that case.
        if (usage.var) {
            declared.add(usage.var);
        }
    }
    for (const usage of (0, jspScan_1.findCustomTagUsages)(text)) {
        const varStatus = usage.attributes.find((attribute) => attribute.name === 'varStatus')?.value;
        if (varStatus) {
            declared.add(varStatus);
        }
    }
    if (isTagFile(document)) {
        for (const directive of (0, jspScan_1.findAllDirectives)(text)) {
            if (directive.directiveName !== 'attribute') {
                continue;
            }
            const name = directive.attributes.find((attribute) => attribute.name === 'name')?.value;
            if (name) {
                declared.add(name);
            }
        }
    }
    const importedNames = (0, jspScan_1.findPageImports)(text).map((imported) => imported.simpleName);
    const known = new Set([...EL_IMPLICIT_OBJECTS, ...EL_RESERVED_WORDS, ...declared, ...importedNames]);
    return { declared, known };
}
/**
 * Validates every EL property-chain access (`${x.y.z}`) in a JSP/tag
 * document, in two independently-configurable tiers along the same
 * resolution ladder -- both ultimately asking "how far can this chain's
 * *base* variable be resolved?", just reporting at different confidence
 * levels:
 *
 * - **Declared at all?** (`jsp-el-unknown-variable`, Warning, its own
 *   `elUnknownVariableWarning.enabled` setting) -- is the base variable
 *   `known` (see `ElNames`/`collectElNames`: a real declaration, an implicit
 *   object, a page-level import, or a reserved word -- anything that isn't a
 *   bug)? Purely syntactic, never touches jdtls, and is a weaker signal than
 *   the tier below: an unknown base might be a real
 *   bug (a typo, an out-of-scope variable), or it might legitimately read a
 *   request/session attribute set by Java code this scanner has no way to
 *   see (Supermodel's implicit `name="object"` convention is the most common
 *   example -- see the README's "Known limitations"). Both look identical
 *   from JSP source alone, hence Warning rather than Error, and its own
 *   opt-out rather than sharing the tier below's setting.
 * - **Resolves hop by hop?** (`jsp-el-chain`, Hint/Error,
 *   `beanPropertyValidation.enabled`, shared with `SetPropertyDiagnostics`)
 *   -- once the base has a known Java type (via `VariableTypeResolver`),
 *   walks each further segment (a bare property access resolved by JavaBean
 *   convention, `.name(...)` resolved as a method call by its literal name),
 *   flagging the first hop with no matching getter/method. Stops at the
 *   first hop it can't resolve *either way*: a missing hop is flagged and
 *   the rest of the chain is left unchecked (unreachable once this hop fails
 *   at runtime too); a hop jdtls simply can't answer yet (still indexing, or
 *   its return type couldn't be parsed off its source) is silently skipped,
 *   same "skip rather than guess" rule as everywhere else in this extension.
 *   Never checks *inside* a call's own argument list -- that would need the
 *   called method's parameter types to check the argument against, which
 *   this extension doesn't attempt. A base variable that's `declared` (see
 *   `ElNames` above -- note this is the narrower of the two sets, not
 *   `known`) but whose type can't be resolved (most commonly Supermodel's
 *   implicit `name="object"`) gets a Hint instead of silence, so "not
 *   validated" reads differently from "validated, and fine." Implicit
 *   objects and reserved words are deliberately excluded from that Hint --
 *   they can never be typed at all, so hinting on those would just be
 *   permanent noise rather than surfacing a coverage gap that could be
 *   closed. An undeclared base already gets its own, louder Warning from the
 *   tier above, so this stays silent for that case rather than double up.
 *
 * These were originally two separate classes, each independently scanning
 * the document for the same EL chains and reasoning about the same base
 * variable -- literally the same question ("is this chain's base declared,
 * typed, walkable?") asked at two confidence tiers, and each already had to
 * defer to the other by name in its own doc comment to avoid double-
 * reporting the same root cause. Now a single `walkChain` walk per chain
 * (document scan, name classification via `ElNames`, and the base-variable
 * lookup all happen once) that reports into both tiers as it goes, deriving
 * each diagnostic's severity/collection from the resolver step's own
 * confidence rather than its position in the chain; only the severity/opt-out
 * split itself -- a real product decision about how much noise each tier's
 * users tolerate -- stays separate, as two independently-toggled
 * `DiagnosticCollection`s.
 */
class ElDiagnostics {
    variableTypes;
    tldIndex;
    chainCollection = vscode.languages.createDiagnosticCollection(exports.CHAIN_SOURCE);
    unknownCollection = vscode.languages.createDiagnosticCollection(exports.UNKNOWN_SOURCE);
    syntaxCollection = vscode.languages.createDiagnosticCollection(exports.SYNTAX_SOURCE);
    constructor(variableTypes, tldIndex) {
        this.variableTypes = variableTypes;
        this.tldIndex = tldIndex;
    }
    dispose() {
        this.chainCollection.dispose();
        this.unknownCollection.dispose();
        this.syntaxCollection.dispose();
    }
    async validate(document) {
        const config = vscode.workspace.getConfiguration();
        const chainEnabled = config.get(CHAIN_ENABLED_SETTING, true);
        const unknownEnabled = config.get(UNKNOWN_ENABLED_SETTING, true);
        if (!chainEnabled) {
            this.chainCollection.set(document.uri, []);
        }
        if (!unknownEnabled) {
            this.unknownCollection.set(document.uri, []);
        }
        const text = (0, jspScan_1.maskJspComments)(document.getText());
        // Unconditional (no CHAIN_ENABLED_SETTING/UNKNOWN_ENABLED_SETTING gate, see SYNTAX_SOURCE's own
        // comment) -- a block that fails to parse at all contributes *no* chains to either tier below
        // (see parseElDocument's own recovery), so without this it goes completely silent instead of
        // being flagged.
        this.syntaxCollection.set(document.uri, (0, elScan_1.findAllElSyntaxErrors)(text).map(({ range, message }) => (0, diagnostics_1.createDiagnostic)(document, range, `EL expression has a syntax error: ${message}.`, vscode.DiagnosticSeverity.Error, exports.SYNTAX_SOURCE)));
        if (!chainEnabled && !unknownEnabled) {
            return;
        }
        const chains = (0, elScan_1.findAllElPropertyChains)(text);
        const { declared, known } = collectElNames(document, text);
        const types = chainEnabled ? await this.variableTypes.resolveTypes(document, text) : undefined;
        // Same closure shape `VariableTypeResolver.resolveUsageType` (variableTypes.ts) already builds
        // over its own `tldIndex` -- only needed once a Java type is in play at all (every consumer
        // below is itself gated on `types`), so built alongside it rather than unconditionally.
        const resolveFunction = types
            ? (prefix, functionName) => this.tldIndex.resolveFunction(text, document.uri, prefix, functionName)
            : undefined;
        const unknownDiagnostics = [];
        const chainDiagnostics = [];
        for (const usage of chains) {
            const result = await walkChain(document, usage, types, declared, known, resolveFunction);
            if (result.unknownDiagnostic) {
                unknownDiagnostics.push(result.unknownDiagnostic);
            }
            chainDiagnostics.push(...result.chainDiagnostics);
        }
        if (types) {
            chainDiagnostics.push(...(await this.validateElFunctionCalls(document, text, types, resolveFunction)));
        }
        if (unknownEnabled) {
            this.unknownCollection.set(document.uri, unknownDiagnostics);
        }
        if (chainEnabled) {
            this.chainCollection.set(document.uri, chainDiagnostics);
        }
    }
    /**
     * Validates every EL function call's argument count/types against its TLD `<function-signature>`
     * -- same `jsp-el-chain` collection/tier as `walkChain` (see the class doc's "resolves hop by
     * hop?" tier), just a different resolution path (a TLD's declared signature, rather than a Java
     * type's members) for a different part of an EL chain (what's passed *into* a call, rather than
     * the call's own return type). A call whose function name doesn't resolve at all is
     * `LinkDiagnostics`'s concern (`jsp-broken-links`, unconditional), not this one -- this only
     * validates a call once `tldIndex.resolveFunction` already found it, same "existence is a
     * different, weaker-severity question" split the two collections already keep elsewhere.
     */
    async validateElFunctionCalls(document, text, types, resolveFunction) {
        const diagnostics = [];
        for (const usage of (0, elScan_1.findAllElFunctionCalls)(text)) {
            if (!usage.args) {
                continue;
            }
            const elFunction = await this.tldIndex.resolveFunction(text, document.uri, usage.prefix, usage.functionName);
            if (!elFunction) {
                continue;
            }
            diagnostics.push(...(await (0, argumentValidation_1.validateCallArguments)(document, `"${usage.prefix}:${usage.functionName}"`, usage.range, usage.args, elFunction.paramTypes, types.asOf(usage.range[0]), exports.CHAIN_SOURCE, resolveFunction)));
        }
        return diagnostics;
    }
}
exports.ElDiagnostics = ElDiagnostics;
/**
 * Walks one EL chain's base identifier and, if a Java type was resolved for it, its further
 * hops -- both tiers of `ElDiagnostics`' validation for this one chain, as a single walk rather
 * than two independent passes: the base's `known`-membership check and each hop's getter/method
 * lookup are "the same operation, resolve this identifier against the current context" (see the
 * class doc above), just with a different resolver and confidence per step. Severity/collection
 * fall out of that confidence, not position: a plain `known`-miss on the base is always a weak
 * signal (Warning, `jsp-el-unknown-variable` -- a Set-miss can never rule out an invisible,
 * Java-set page/request attribute); once a Java type is known for the base (or a later hop),
 * jdtls's answer about that type's real members is authoritative (Error, `jsp-el-chain`, via the
 * shared `missingMemberDiagnostic` helper). `types` is `undefined` when the chain tier is
 * disabled, skipping the hop walk entirely (still checks the base against `known`).
 */
async function walkChain(document, usage, types, declared, known, resolveFunction) {
    const base = usage.segments[0];
    const result = { chainDiagnostics: [] };
    // No `usage.segments.length >= 2` restriction here (there used to be one):
    // `EL_PROPERTY_CHAIN` can't tell a real bare identifier apart from an EL
    // reserved word/operator used as its own accidental one-segment "chain"
    // (e.g. "eq" in `${_count eq 1}`) -- but `known` already guards against
    // exactly that (`EL_RESERVED_WORDS` is in it specifically for this,
    // independently of chain length -- see that const's own comment). Without
    // this, a bare undeclared identifier used as a call argument (e.g.
    // "authorisation" in `${object.authorised(authorisation)}`, now reachable
    // here via `collectChainsIn`'s recursion into call arguments) silently
    // never got flagged.
    //
    // `base.literalType !== undefined` skips this entirely for a literal-rooted chain (e.g. the
    // `'/type/'` in `${'/type/'.concat(x)}`) -- its "name" is really its raw source text, which was
    // never declared anywhere and shouldn't be checked as if it were a variable reference. A
    // `null`-literal base (the one literal kind with no `literalType` of its own) still passes this
    // check regardless, since `null` is already in `EL_RESERVED_WORDS` -> `known`.
    if (!base.literalType && !known.has(base.name)) {
        result.unknownDiagnostic = (0, diagnostics_1.createDiagnostic)(document, base.range, `"${base.name}" isn't declared anywhere in this file (no jsp:useBean, configured tag binding, varStatus, or tag-file attribute). ` +
            `This may be a typo or an out-of-scope variable, or it may read a request/session attribute this extension can't see set by Java code.`, vscode.DiagnosticSeverity.Warning, exports.UNKNOWN_SOURCE);
    }
    if (!types) {
        return result;
    }
    // Fixed once, at this chain's own base position -- `_viewings.numViewings` earlier in a document
    // than some *later*, unrelated `_viewings` rebind must still see the type in effect *here*, not
    // the document's final state (see `VariableTypeTimeline`'s own doc).
    const knownTypes = types.asOf(base.range[0]);
    const baseType = base.literalType ?? knownTypes.get(base.name);
    if (!baseType) {
        // Base variable's type isn't known -- nothing to check against. Say so
        // (as a Hint) when it's at least a real declared variable (see
        // `ElNames` above -- this deliberately excludes implicit objects and
        // reserved words, which can never be typed and would make this fire on
        // every use of them instead of flagging an actual coverage gap), so
        // "not validated" doesn't look the same as "validated, and fine"; an
        // undeclared base already gets its own Warning above, so stay silent
        // here rather than raise it twice.
        if (declared.has(base.name)) {
            result.chainDiagnostics.push((0, diagnostics_1.createDiagnostic)(document, base.range, `Type of "${base.name}" couldn't be resolved, so property accesses on it aren't validated.`, vscode.DiagnosticSeverity.Hint, exports.CHAIN_SOURCE));
        }
        return result;
    }
    let currentType = baseType;
    for (let i = 1; i < usage.segments.length; i++) {
        const segment = usage.segments[i];
        const lookup = await (0, javaSymbols_1.resolveChainHop)(currentType, segment, knownTypes, resolveFunction);
        if (lookup.status === 'unknown') {
            // Previously silent: `currentType` resolved fine, but this hop's own member lookup couldn't
            // complete (its class isn't indexed yet, a computed bracket index, a chain segment
            // `inferArgumentType` couldn't type, ...) -- see `unknownMemberDiagnostic`'s own doc for why an
            // actual absence of validation shouldn't read the same as "checked, and fine". Still `break`s
            // afterward: `currentType` genuinely isn't known past this point, so there's nothing sound to
            // keep validating for the rest of the chain.
            result.chainDiagnostics.push((0, javaSymbols_1.unknownMemberDiagnostic)(document, segment.range, currentType, lookup, (fqcn) => `${fqcn} has ${describeSegment(segment)}`, exports.CHAIN_SOURCE));
            break;
        }
        if (lookup.status === 'missing') {
            const diagnostic = (0, javaSymbols_1.missingMemberDiagnostic)(document, segment.range, currentType, lookup, (fqcn) => `${fqcn} has no ${describeSegment(segment)}.`, exports.CHAIN_SOURCE);
            result.chainDiagnostics.push(diagnostic);
            break;
        }
        // A method call whose overload `resolveChainHop` couldn't confidently settle on -- see its own
        // comment on `overloadWarning` -- gets surfaced here as a Warning (a heuristic, not jdtls ground
        // truth) rather than silently trusting the best-effort guess it still returned so chain
        // evaluation could continue.
        if (lookup.overloadWarning) {
            result.chainDiagnostics.push((0, diagnostics_1.createDiagnostic)(document, segment.range, lookup.overloadWarning, vscode.DiagnosticSeverity.Warning, exports.CHAIN_SOURCE));
        }
        currentType = lookup.type;
    }
    return result;
}
function describeSegment(segment) {
    return segment.callArgs !== undefined
        ? `method "${segment.name}(${segment.callArgs.map((arg) => arg.text).join(', ')})"`
        : `property "${segment.name}"`;
}
//# sourceMappingURL=elDiagnostics.js.map