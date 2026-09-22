"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inferElExpressionType = inferElExpressionType;
const javaSymbols_1 = require("../javaSymbols");
const elChainAdapter_1 = require("./elChainAdapter");
const elAst_1 = require("./elAst");
/**
 * Infers the Java type a real EL expression (any `ElNode`, not just a bare variable chain) resolves
 * to -- `variableTypes.ts`'s `resolveUsageType` uses this for a configured tag's `value="..."`
 * attribute (see `BindingTagConfig.value`'s own doc), so e.g. `<sm:set var="_count" value="${0}" />`
 * or `<sm:set var="_onePerRow" value="${object.type eq 'EPISODE'}" />` get a real inferred type
 * instead of falling straight to `kind: 'unresolved'` the moment `value` isn't a bare chain.
 * `undefined` whenever this can't confidently resolve one -- abstain, don't guess, same philosophy
 * `javaSymbols.ts`/`variableTypes.ts` already follow throughout.
 *
 * The rules below are checked against Tomcat's own EL runtime source
 * (`org.apache.el.parser.Ast*`/`org.apache.el.lang.ELArithmetic`) -- the actual implementation
 * `tomcat-jasper-el` compiles into (see `docs/README.md`'s own provenance note on `ELParser.jjt`),
 * not the abstract spec text -- rather than assumed. That's deliberately as far as this goes,
 * though: arithmetic (`Plus`/`Minus`/`Mult`/`Div`/`Mod`) and `Concatenation` (`+=`) both turned out
 * to need replicating a genuine multi-way *runtime* coercion cascade to type precisely --
 * `ELArithmetic`'s BigDecimal/Double/BigInteger/Long dispatch for the former, `AstConcatenation`'s
 * Map/Set/List-merge special case for the latter (it isn't pure string concatenation: if the left
 * operand is a `Map`/`Set`/`List`, it merges the right operand into it and returns the left
 * operand's own type unchanged, only falling back to a stringified concatenation otherwise). That's
 * simulating another engine's evaluator inside this extension, not stating a fixed fact about a
 * construct -- qualitatively different from everything else below, which only ever depends on the
 * *shape* of the expression, never on replaying how a value would be computed. So those operators
 * are left unresolved rather than ported in (`+=` also has zero usages anywhere in this repo's real
 * JSPs today).
 */
async function inferElExpressionType(node, sourceText, knownTypes, resolveFunction) {
    switch (node.kind) {
        // `AstBoolean`/`AstString`/`AstNull` and (barring an overflow so extreme it's not realistic in a
        // JSP attribute) `AstInteger`/`AstFloatingPoint` all have a fixed type determined purely by their
        // own syntax -- see `AstInteger.getInteger()`/`AstFloatingPoint.getFloatingPoint()`'s own
        // BigInteger/BigDecimal overflow fallbacks for the (unmodelled) exception.
        case 'Literal':
            return (0, elAst_1.literalNodeType)(node);
        // A variable- or literal-rooted chain (bare `${_reviewCount}`, a real `.`/`[]` chain, or a
        // call directly on a literal like `'/type/'.concat(x)`) -- reuses the exact same jdtls-backed
        // resolution every other chain in this extension gets, rather than a second copy of it.
        // Re-parses `node`'s own source span through `parseStandaloneElChain` instead of walking the
        // already-parsed node directly, matching how every other caller of that function
        // (`inferArgumentType`, the old `parseElChain`) already works from a raw text span. A `Value`
        // whose prefix isn't a valid chain root (`isChainRootPrefix` -- e.g. a call's own result) has
        // no chain to resolve -- `parseStandaloneElChain` already returns `[]` for that, same boundary
        // this respects.
        case 'Identifier':
        case 'Value': {
            if (node.kind === 'Value' && !(0, elChainAdapter_1.isChainRootPrefix)(node.prefix.kind)) {
                return undefined;
            }
            const segments = (0, elChainAdapter_1.parseStandaloneElChain)(sourceText.slice(node.range[0], node.range[1]), node.range[0]);
            return segments.length ? (0, javaSymbols_1.resolveChainType)(knownTypes, segments) : undefined;
        }
        // `AstNot`/`AstEmpty` always return `Boolean` regardless of the operand -- no need to resolve it
        // at all. `AstNegative` instead switches on the operand's own concrete class and negates in
        // place (`Integer` stays `Integer`, `BigDecimal` stays `BigDecimal`, ...) -- a real pass-through,
        // not a promotion -- so the operand's own resolved type wins unchanged, when it's a recognized
        // numeric type. (More precise than `AstNegative.getType()`'s own conservative hard-coded
        // `Number.class` -- a narrower known type is more useful for downstream chaining here.)
        case 'Unary': {
            if (node.op !== 'Negative') {
                return 'java.lang.Boolean';
            }
            const operandType = await inferElExpressionType(node.operand, sourceText, knownTypes, resolveFunction);
            return operandType && javaSymbols_1.NUMERIC_TYPES.has(operandType) ? operandType : undefined;
        }
        // `Or`/`And`/`Equal`/`NotEqual`/`LessThan`/`GreaterThan`/`LessThanEqual`/`GreaterThanEqual` are
        // each a `BooleanNode` in the real grammar (`AstOr`/`AstAnd`/`AstEqual`/...) -- always `Boolean`,
        // regardless of either operand's type, so this alone covers `${object.type eq 'EPISODE'}` with
        // no chain resolution needed at all. `Plus`/`Minus`/`Mult`/`Div`/`Mod`/`Concatenation` are
        // deliberately not attempted -- see this function's own doc comment.
        case 'Binary':
            switch (node.op) {
                case 'Or':
                case 'And':
                case 'Equal':
                case 'NotEqual':
                case 'LessThan':
                case 'GreaterThan':
                case 'LessThanEqual':
                case 'GreaterThanEqual':
                    return 'java.lang.Boolean';
                default:
                    return undefined;
            }
        // `a ? b : c` / `a ?: b` / `a ?? b` each evaluate and return exactly one of their two
        // value-producing branches at runtime -- unlike arithmetic, there's no promotion *between* them
        // -- so see `branchCommonType`'s own doc for what a confident static answer here actually means.
        case 'Choice':
            return branchCommonType(node.whenTrue, node.whenFalse, sourceText, knownTypes, resolveFunction);
        case 'Elvis':
        case 'NullCoalescing':
            return branchCommonType(node.left, node.right, sourceText, knownTypes, resolveFunction);
        // An EL function call (`prefix:name(...)`) -- resolved to its backing Java method's return type
        // via `resolveElFunctionCallType` (javaSymbols.ts), the exact same resolution "go to
        // definition"/hover already give one (`resolveElFunctionTarget`, tokenResolution.ts) and
        // `inferArgumentType` (javaSymbols.ts) now gives a nested call used as another call's own
        // argument. No overload disambiguation by argument type, same shortcut `resolveMember` already
        // takes for the same call. A bare (no-`prefix`) call and any call with no `resolveFunction`
        // supplied both abstain -- there's nothing to resolve a prefix-less name against here.
        case 'Function':
            return !resolveFunction || !node.prefix ? undefined : (0, javaSymbols_1.resolveElFunctionCallType)(node.prefix, node.name, resolveFunction);
        // `ListData`/`SetData`/`MapData`, `LambdaExpression`, `Assign`, `Semicolon`, `ErrorExpression`,
        // `LiteralExpression` -- not attempted anywhere in this extension, same boundary
        // `inferArgumentType` (javaSymbols.ts) already draws for these.
        default:
            return undefined;
    }
    return undefined;
}
function isNullLiteral(node) {
    return node.kind === 'Literal' && node.literalKind === 'null';
}
// `int`/`Integer`, `long`/`Long`, ... are the same real type spelled two ways -- without this, a
// ternary whose branches are e.g. a primitive-typed getter on one side and its boxed form on the
// other would wrongly read as a genuine mismatch. Reuses `javaSymbols.ts`'s existing
// `PRIMITIVE_WRAPPERS` (the same map `checkArgumentCompatibility` normalizes through) rather than a
// second copy of that primitive/boxed mapping.
function normalizePrimitive(type) {
    return javaSymbols_1.PRIMITIVE_WRAPPERS.get(type) ?? type;
}
/**
 * The common type of two branches that are never actually combined at runtime -- only ever one of
 * them is evaluated and returned (see `inferElExpressionType`'s `Choice`/`Elvis`/`NullCoalescing`
 * cases). A confident static answer only exists in two shapes: both branches resolve to the same
 * type (`normalizePrimitive`-equal), or one branch is a literal `null` -- which can never be
 * *evidence* the other branch's own type is wrong, unlike a genuine mismatch, so the whole
 * expression defers entirely to the other branch's type (covers `${_onePerRow ? null : 225}` →
 * `java.lang.Long`). Two branches that resolve to two different real types -- even two different
 * numeric ones -- abstain (`undefined`) rather than widening: unlike `+`/`-`/`*`, EL never coerces
 * between a ternary's branches, so guessing a common numeric type here would describe a coercion
 * that doesn't actually happen.
 */
async function branchCommonType(a, b, sourceText, knownTypes, resolveFunction) {
    if (isNullLiteral(a) && isNullLiteral(b)) {
        return undefined;
    }
    if (isNullLiteral(a)) {
        return inferElExpressionType(b, sourceText, knownTypes, resolveFunction);
    }
    if (isNullLiteral(b)) {
        return inferElExpressionType(a, sourceText, knownTypes, resolveFunction);
    }
    const [aType, bType] = await Promise.all([
        inferElExpressionType(a, sourceText, knownTypes, resolveFunction),
        inferElExpressionType(b, sourceText, knownTypes, resolveFunction),
    ]);
    if (!aType || !bType) {
        return undefined;
    }
    return normalizePrimitive(aType) === normalizePrimitive(bType) ? aType : undefined;
}
//# sourceMappingURL=elTypeInference.js.map