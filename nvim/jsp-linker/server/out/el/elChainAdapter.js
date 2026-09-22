"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isChainRootPrefix = isChainRootPrefix;
exports.collectElChainUsagesInDocument = collectElChainUsagesInDocument;
exports.findElChainSegmentsAt = findElChainSegmentsAt;
exports.parseStandaloneElChain = parseStandaloneElChain;
exports.collectElFunctionCallsInDocument = collectElFunctionCallsInDocument;
exports.findElFunctionCallAt = findElFunctionCallAt;
exports.collectElSyntaxErrorsInDocument = collectElSyntaxErrorsInDocument;
const elAst_1 = require("./elAst");
const elLexer_1 = require("./elLexer");
const elParser_1 = require("./elParser");
/**
 * Bridges the real EL parser (`elParser.ts`) to `jspScan.ts`'s existing `ElChainSegment[]`
 * contract -- see the plan's "How chain-discovery itself changes" section. `scanChain`'s old flat
 * character scan found a chain by running from every identifier-start position and recursing only
 * into a call's own arguments; this walks the *actual parsed tree*, visiting every position a
 * sub-expression can occur (ternary branches, binary/unary operands, call arguments, lambda
 * bodies, collection-literal elements) -- so e.g. `_amazonvideoAvails[0].url` becomes one correct
 * chain instead of `scanChain`'s two disconnected ones (see the plan's own worked example of that
 * false positive). `ElChainSegment`/`CallArg`'s shapes are unchanged except for the new optional
 * `index` field (bracket/index access) -- every existing consumer (`elDiagnostics.ts`,
 * `tokenResolution.ts`, `variableTypes.ts`, `argumentValidation.ts`) keeps its exact signature.
 */
function offsetWithin(offset, [start, end]) {
    return offset >= start && offset < end;
}
function rangeSpan([start, end]) {
    return end - start;
}
function mergeRange(a, b) {
    return [a[0], b[1]];
}
/**
 * Whether a `Value`/chain-expression prefix can root a real chain -- a variable reference
 * (`Identifier`) or a literal (`Literal`, e.g. `'/type/'.concat(x)`); anything else (a call's own
 * result, a collection literal, a lambda) has no base to resolve a chain from. The single place
 * this decision is made -- `visitForChains`, `parseStandaloneElChain`, and `buildSegments`'s own
 * cast below all check this same predicate, and `elTypeInference.ts`'s short-circuit guard imports
 * it too, rather than each independently re-listing the same two node kinds (see this codebase's
 * own `createDiagnostic` doc in `diagnostics.ts` for the exact bug class -- a copy of one condition
 * silently drifting from the others -- this is written once to avoid).
 */
function isChainRootPrefix(kind) {
    return kind === 'Identifier' || kind === 'Literal';
}
/** Strips an EL string literal's quotes and un-escapes it -- mirrors `elLexer.ts`'s own escaping
 * rule (a backslash before the delimiting quote, another quote, or another backslash). Used only
 * for a bracket-index segment's `index.text` (the actual map key a string-literal index names). */
function unquoteElString(raw) {
    const quote = raw[0];
    const inner = raw.endsWith(quote) && raw.length > 1 ? raw.slice(1, -1) : raw.slice(1);
    let result = '';
    for (let i = 0; i < inner.length; i++) {
        if (inner[i] === '\\' && i + 1 < inner.length) {
            result += inner[i + 1];
            i++;
        }
        else {
            result += inner[i];
        }
    }
    return result;
}
function toCallArgs(args, sourceText) {
    return args.map((arg) => ({ text: sourceText.slice(arg.range[0], arg.range[1]), range: arg.range }));
}
/**
 * Converts one `ValueNode` (already confirmed via `isChainRootPrefix` to have an `Identifier` or
 * `Literal` prefix -- i.e. a real variable- or literal-rooted chain, not a function call/collection
 * literal) into `ElChainSegment[]`. The base segment (index 0) carries `literalType` for a
 * `Literal` prefix instead of a lookup-able `name` -- see `ElChainSegment`'s own doc in
 * `jspScan.ts` for why every consumer needs to check that rather than treating it like any other
 * name.
 */
function buildSegments(node, sourceText) {
    const prefix = node.prefix;
    const base = prefix.kind === 'Literal' ? { name: prefix.raw, range: prefix.range, literalType: (0, elAst_1.literalNodeType)(prefix) } : { name: prefix.name, range: prefix.range };
    const segments = [base];
    for (const suffix of node.suffixes) {
        const callArgs = suffix.call ? toCallArgs(suffix.call.args, sourceText) : undefined;
        if (suffix.suffix.kind === 'DotSuffix') {
            segments.push({ name: suffix.suffix.name, range: suffix.suffix.range, callArgs });
            continue;
        }
        // BracketSuffix -- a display `name` (for diagnostic messages) plus, separately, the actual
        // resolvable key/index in `index` (see `ElChainSegment`'s own doc comment on why these are
        // kept distinct rather than overloading `name`).
        const indexNode = suffix.suffix.index;
        const literalKind = indexNode.kind === 'Literal' && (indexNode.literalKind === 'string' || indexNode.literalKind === 'integer') ? indexNode.literalKind : undefined;
        const indexText = literalKind === 'string' ? unquoteElString(indexNode.raw) : sourceText.slice(indexNode.range[0], indexNode.range[1]);
        segments.push({
            name: `[${sourceText.slice(indexNode.range[0], indexNode.range[1])}]`,
            range: suffix.suffix.range,
            callArgs,
            index: { text: indexText, range: indexNode.range, literalKind: literalKind === 'integer' ? 'int' : literalKind },
        });
    }
    return segments;
}
/**
 * Walks `node` and every position a sub-expression can occur beneath it, appending one
 * `ElChainUsage` for each `Value` node rooted in a real `Identifier` (a variable-rooted chain) and
 * each bare `Identifier` used directly as a value (a one-segment chain, e.g. `${_reviewCount}`) --
 * `sourceText` is the whole span `node`'s own ranges are absolute offsets into (so
 * `CallArg`/`index.text` extraction can slice it directly, no separate re-parsing needed the way
 * `collectChainsIn`'s old recursion into raw `CallArg.text` was).
 */
function visitForChains(node, sourceText, usages) {
    switch (node.kind) {
        case 'Identifier':
            usages.push({ segments: [{ name: node.name, range: node.range }], range: node.range });
            return;
        case 'Literal':
        case 'LiteralExpression':
        case 'ErrorExpression':
            return;
        case 'Value':
            if (isChainRootPrefix(node.prefix.kind)) {
                usages.push({ segments: buildSegments(node, sourceText), range: node.range });
            }
            else {
                visitForChains(node.prefix, sourceText, usages);
            }
            for (const suffix of node.suffixes) {
                if (suffix.suffix.kind === 'BracketSuffix') {
                    visitForChains(suffix.suffix.index, sourceText, usages);
                }
                if (suffix.call) {
                    for (const arg of suffix.call.args) {
                        visitForChains(arg, sourceText, usages);
                    }
                }
            }
            return;
        case 'Function':
            for (const argList of node.argLists) {
                for (const arg of argList) {
                    visitForChains(arg, sourceText, usages);
                }
            }
            return;
        case 'ListData':
        case 'SetData':
            for (const element of node.elements) {
                visitForChains(element, sourceText, usages);
            }
            return;
        case 'MapData':
            for (const entry of node.entries) {
                visitForChains(entry.key, sourceText, usages);
                visitForChains(entry.value, sourceText, usages);
            }
            return;
        case 'Unary':
            visitForChains(node.operand, sourceText, usages);
            return;
        case 'Binary':
            for (const operand of node.operands) {
                visitForChains(operand, sourceText, usages);
            }
            return;
        case 'Choice':
            visitForChains(node.test, sourceText, usages);
            visitForChains(node.whenTrue, sourceText, usages);
            visitForChains(node.whenFalse, sourceText, usages);
            return;
        case 'Elvis':
        case 'NullCoalescing':
            visitForChains(node.left, sourceText, usages);
            visitForChains(node.right, sourceText, usages);
            return;
        case 'Assign':
            visitForChains(node.target, sourceText, usages);
            visitForChains(node.value, sourceText, usages);
            return;
        case 'Semicolon':
            for (const part of node.parts) {
                visitForChains(part, sourceText, usages);
            }
            return;
        case 'LambdaExpression':
            // The lambda's own bound parameter(s) aren't tracked as locally-scoped/typed here -- a
            // usage of one inside `body` is walked (and, downstream, diagnosed) exactly like any other
            // unresolvable bare identifier. Deliberately deferred, same as lambda parameter *type*
            // inference itself -- see the plan's "Scope for this pass vs. deferred" section.
            visitForChains(node.body, sourceText, usages);
            if (node.invokedWith) {
                for (const argList of node.invokedWith) {
                    for (const arg of argList) {
                        visitForChains(arg, sourceText, usages);
                    }
                }
            }
            return;
        default:
            return;
    }
}
/** Every EL chain usage in `text` (an entire document or any smaller span), plus any configured
 * `bareSpans` (see `BareElSpan`'s own doc in `jspScan.ts`) -- replaces `collectChainsIn`'s flat
 * scan. A malformed/still-being-typed block elsewhere in `text` doesn't prevent chains in other
 * blocks from being found (see `parseElDocument`'s own recovery); the same now holds for a bare
 * span, since `parseElDocument` walks it as just another block, not a second pass of its own. */
function collectElChainUsagesInDocument(text, bareSpans = elLexer_1.NO_BARE_EL_SPANS) {
    const doc = (0, elParser_1.parseElDocument)(text, bareSpans);
    const usages = [];
    for (const part of doc.parts) {
        if (part.kind === 'DynamicExpression' || part.kind === 'DeferredExpression') {
            visitForChains(part.expression, text, usages);
        }
    }
    return usages;
}
/**
 * The chain usage covering `offset` (if any), truncated to just its segments up to and including
 * whichever one `offset` itself falls on -- matches `findElPropertyChainAt`'s existing contract
 * (later segments are dropped; resolving them needs the hovered segment's own type, not known yet).
 * Picks the *innermost* of several nested matches (e.g. hovering an identifier used as a call
 * argument inside a larger chain) by smallest enclosing range, rather than needing the special
 * recursive "check each call arg's own range" fallback `findChainAt` used before real AST nesting
 * was available.
 */
function findElChainSegmentsAt(text, offset, bareSpans = elLexer_1.NO_BARE_EL_SPANS) {
    const usages = collectElChainUsagesInDocument(text, bareSpans);
    let best;
    for (const usage of usages) {
        if (!offsetWithin(offset, usage.range)) {
            continue;
        }
        if (!best || rangeSpan(usage.range) < rangeSpan(best.range)) {
            best = usage;
        }
    }
    if (!best) {
        return undefined;
    }
    const hoveredIndex = best.segments.findIndex((segment) => offsetWithin(offset, segment.range));
    if (hoveredIndex === -1) {
        return undefined; // offset landed on '.', '(', ')', '[', ']' between segments -- nothing to resolve
    }
    return best.segments.slice(0, hoveredIndex + 1);
}
/** Parses a self-contained chain expression (e.g. `"_favourite.film"`, or a literal-rooted call like
 * `"'/type/'.concat(x)"`) into its segments, each with its own absolute range -- `chainStart` is
 * where `chainText` itself begins in the real document. Replaces `parseChain`; used by
 * `elTypeInference.ts`'s `inferElExpressionType` (in turn used by `variableTypes.ts`) and
 * `argumentValidation.ts`'s `inferArgumentType`. Returns `[]` for anything that doesn't parse as a
 * plain chain (a bare literal with no suffixes, a function call, an operator expression, etc.) --
 * there's no chain here to resolve. */
function parseStandaloneElChain(chainText, chainStart) {
    let node;
    try {
        node = (0, elParser_1.parseElExpression)(chainText);
    }
    catch {
        return [];
    }
    let segments;
    if (node.kind === 'Identifier') {
        segments = [{ name: node.name, range: node.range }];
    }
    else if (node.kind === 'Value' && isChainRootPrefix(node.prefix.kind)) {
        segments = buildSegments(node, chainText);
    }
    else {
        return [];
    }
    return shiftSegments(segments, chainStart);
}
function shiftRange([start, end], delta) {
    return [start + delta, end + delta];
}
function shiftSegments(segments, delta) {
    return segments.map((segment) => ({
        ...segment,
        range: shiftRange(segment.range, delta),
        callArgs: segment.callArgs?.map((arg) => ({ ...arg, range: shiftRange(arg.range, delta) })),
        index: segment.index && { ...segment.index, range: shiftRange(segment.index.range, delta) },
    }));
}
/**
 * Walks the same way `visitForChains` does, but collects `Function` nodes that have a `prefix`
 * (an EL function call, e.g. `fn:escapeXml(...)`) instead of chains -- a bare, unprefixed call
 * (`someFn(x)`) isn't a taglib function, so it's not collected here (matches
 * `findAllElFunctionCalls`'s existing regex, which requires the `prefix:` colon). Also recurses
 * into a prefixed call's own arguments -- a nested prefixed call as an argument (e.g.
 * `lfn:foo(lfn:bar(x))`) is its own usage too, same "argument content is just more EL to scan"
 * treatment `visitForChains` gives call arguments.
 */
function visitForFunctionCalls(node, sourceText, usages) {
    switch (node.kind) {
        case 'Literal':
        case 'Identifier':
        case 'LiteralExpression':
        case 'ErrorExpression':
            return;
        case 'Function': {
            const allArgs = node.argLists.flat();
            if (node.prefix !== undefined) {
                usages.push({ prefix: node.prefix, functionName: node.name, range: node.nameRange, args: toCallArgs(allArgs, sourceText) });
            }
            for (const arg of allArgs) {
                visitForFunctionCalls(arg, sourceText, usages);
            }
            return;
        }
        case 'Value':
            visitForFunctionCalls(node.prefix, sourceText, usages);
            for (const suffix of node.suffixes) {
                if (suffix.suffix.kind === 'BracketSuffix') {
                    visitForFunctionCalls(suffix.suffix.index, sourceText, usages);
                }
                if (suffix.call) {
                    for (const arg of suffix.call.args) {
                        visitForFunctionCalls(arg, sourceText, usages);
                    }
                }
            }
            return;
        case 'ListData':
        case 'SetData':
            for (const element of node.elements) {
                visitForFunctionCalls(element, sourceText, usages);
            }
            return;
        case 'MapData':
            for (const entry of node.entries) {
                visitForFunctionCalls(entry.key, sourceText, usages);
                visitForFunctionCalls(entry.value, sourceText, usages);
            }
            return;
        case 'Unary':
            visitForFunctionCalls(node.operand, sourceText, usages);
            return;
        case 'Binary':
            for (const operand of node.operands) {
                visitForFunctionCalls(operand, sourceText, usages);
            }
            return;
        case 'Choice':
            visitForFunctionCalls(node.test, sourceText, usages);
            visitForFunctionCalls(node.whenTrue, sourceText, usages);
            visitForFunctionCalls(node.whenFalse, sourceText, usages);
            return;
        case 'Elvis':
        case 'NullCoalescing':
            visitForFunctionCalls(node.left, sourceText, usages);
            visitForFunctionCalls(node.right, sourceText, usages);
            return;
        case 'Assign':
            visitForFunctionCalls(node.target, sourceText, usages);
            visitForFunctionCalls(node.value, sourceText, usages);
            return;
        case 'Semicolon':
            for (const part of node.parts) {
                visitForFunctionCalls(part, sourceText, usages);
            }
            return;
        case 'LambdaExpression':
            visitForFunctionCalls(node.body, sourceText, usages);
            if (node.invokedWith) {
                for (const argList of node.invokedWith) {
                    for (const arg of argList) {
                        visitForFunctionCalls(arg, sourceText, usages);
                    }
                }
            }
            return;
        default:
            return;
    }
}
function collectElFunctionCallsInDocument(text, bareSpans = elLexer_1.NO_BARE_EL_SPANS) {
    const doc = (0, elParser_1.parseElDocument)(text, bareSpans);
    const usages = [];
    for (const part of doc.parts) {
        if (part.kind === 'DynamicExpression' || part.kind === 'DeferredExpression') {
            visitForFunctionCalls(part.expression, text, usages);
        }
    }
    return usages;
}
function findElFunctionCallAt(text, offset, bareSpans = elLexer_1.NO_BARE_EL_SPANS) {
    for (const usage of collectElFunctionCallsInDocument(text, bareSpans)) {
        if (offsetWithin(offset, usage.range)) {
            return { prefix: usage.prefix, functionName: usage.functionName, range: usage.range };
        }
    }
    return undefined;
}
// -- EL syntax errors -------------------------------------------------------------------------
/**
 * Every `${...}`/`#{...}` block in `text` (plus any configured `bareSpans`) that failed to parse --
 * one entry per `ErrorExpressionNode` in `parseElDocument`'s result (see that function's own
 * comment on why one broken block doesn't take down any other -- a bare span that fails recovers
 * the same way, since it's just another block to `parseElDocument`). Unlike chain/function-call
 * resolution, this needs no tree-walk: a parse failure anywhere within a block always fails the
 * *whole* block (there's no partial/nested recovery), so every `ErrorExpressionNode` is already a
 * direct, top-level part of the parsed document.
 */
function collectElSyntaxErrorsInDocument(text, bareSpans = elLexer_1.NO_BARE_EL_SPANS) {
    const doc = (0, elParser_1.parseElDocument)(text, bareSpans);
    const errors = [];
    for (const part of doc.parts) {
        if (part.kind === 'ErrorExpression') {
            errors.push({ range: part.range, message: part.message });
        }
    }
    return errors;
}
//# sourceMappingURL=elChainAdapter.js.map