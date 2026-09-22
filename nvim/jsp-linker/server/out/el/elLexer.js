"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NO_BARE_EL_SPANS = exports.ElLexerError = void 0;
exports.tokenizeEl = tokenizeEl;
exports.tokenizeElExpressionBody = tokenizeElExpressionBody;
class ElLexerError extends Error {
    range;
    constructor(message, range) {
        super(message);
        this.range = range;
    }
}
exports.ElLexerError = ElLexerError;
const KEYWORD_TOKEN_TYPES = new Map([
    ['true', 'TRUE'],
    ['false', 'FALSE'],
    ['null', 'NULL'],
    ['gt', 'GT'],
    ['lt', 'LT'],
    ['ge', 'GE'],
    ['le', 'LE'],
    ['eq', 'EQ'],
    ['ne', 'NE'],
    ['not', 'NOT'],
    ['and', 'AND'],
    ['or', 'OR'],
    ['empty', 'EMPTY'],
    ['div', 'DIV'],
    ['mod', 'MOD'],
]);
// `.jjt`'s `JAVALETTER`/`JAVADIGIT` productions are ~500 lines of literal Unicode code-point
// ranges (see `docs/ELParser.jjt`) generated from `Character.isJavaIdentifierStart/Part` --
// reproducing that table verbatim buys nothing here (every real identifier in this codebase's
// JSPs is plain ASCII), so this uses JS's own Unicode identifier classes instead, which agree with
// Java's at everything but the Unicode margins. `$` and `_` are Java-legal identifier characters
// that JS's `ID_Start`/`ID_Continue` don't cover on their own, so they're added explicitly.
const IDENTIFIER_START = /[$_\p{ID_Start}]/u;
// ‌/‍ (ZWNJ/ZWJ) are valid JS identifier-part characters (used in some scripts'
// ligature rules) not covered by \p{ID_Continue} alone -- included for parity with how JS itself
// defines an identifier, though not something the .jjt's own JAVALETTER/JAVADIGIT tables call out
// (Java has no equivalent carve-out); irrelevant in practice since this codebase's identifiers are ASCII.
const IDENTIFIER_PART = /[$_\p{ID_Continue}‌‍]/u;
const DIGIT = /[0-9]/;
/**
 * `text === lastParsedText && bareSpans === lastParsedBareSpans` in `elParser.ts`'s own memo relies
 * on every "no bare spans" call sharing this exact array instance -- an inline `[]` default would
 * instead allocate a fresh, distinct array on every such call, defeating that memo (a `===` check
 * against a freshly-allocated array is never true) for what's still the overwhelming majority of
 * calls. See that memo's own comment for what it's for.
 */
exports.NO_BARE_EL_SPANS = [];
/**
 * Tokenizes `text`, treating each of `bareSpans` (if any) as its own block exactly like a real
 * `${...}` one -- a configured tag attribute whose whole value is EL without the wrapper (e.g.
 * Supermodel's `sm:if`/`sm:forEach` `test="not x.disabled"`, see `BareElSpan`'s own doc in
 * `jspScan.ts`). Rather than tokenizing each bare span as its own separate, later-merged pass (two
 * discovery mechanisms feeding the same tree-walkers), each one is spliced into this same scan at
 * its real `start`/`end` -- `lexLiteralRun` stops there exactly as it would at a real `${`/`#{`,
 * and `lexExpressionBody` tokenizes it in place against the *real* `text` (not a copied substring),
 * so every resulting token's range is already a correct absolute document offset with no shifting
 * step needed afterward. The one difference from a real block: there's no literal `${`/`}` to
 * consume, so its `START_DYNAMIC_EXPRESSION`/`RBRACE` markers are zero-width, positioned exactly at
 * `start`/`end` -- everything downstream (`Parser.parseBlockWithRecovery`, `blockEnds`-based error
 * recovery, every AST consumer) treats it identically to a real block regardless, since none of it
 * inspects a token's own text/width, only its `type`/`range`.
 */
function tokenizeEl(text, bareSpans = exports.NO_BARE_EL_SPANS) {
    const tokens = [];
    const blockEnds = new Map();
    const spans = bareSpans.length > 1 ? [...bareSpans].sort((a, b) => a.start - b.start) : bareSpans;
    let spanIndex = 0;
    let i = 0;
    while (i < text.length) {
        const nextSpanStart = spanIndex < spans.length ? spans[spanIndex].start : undefined;
        i = lexLiteralRun(text, i, tokens, nextSpanStart);
        if (i >= text.length) {
            break;
        }
        if (nextSpanStart !== undefined && i === nextSpanStart) {
            const span = spans[spanIndex++];
            const spanEnd = span.start + span.text.length; // `span.text` is exactly `text.slice(span.start, spanEnd)` -- see `BareElSpan`'s own doc
            const startIndex = tokens.length;
            tokens.push({ type: 'START_DYNAMIC_EXPRESSION', text: '', range: [span.start, span.start] });
            lexExpressionBody(text, span.start, tokens, false, spanEnd);
            tokens.push({ type: 'RBRACE', text: '', range: [spanEnd, spanEnd] });
            blockEnds.set(startIndex, tokens.length - 1);
            i = spanEnd;
            continue;
        }
        // `lexLiteralRun` only stops early at a real `${`/`#{` start, the next bare span (handled
        // above), or EOF -- reaching here means a real block start.
        const isDollar = text[i] === '$';
        const startRange = [i, i + 2];
        const startIndex = tokens.length;
        tokens.push({ type: isDollar ? 'START_DYNAMIC_EXPRESSION' : 'START_DEFERRED_EXPRESSION', text: text.slice(i, i + 2), range: startRange });
        i += 2;
        i = lexExpressionBody(text, i, tokens, true);
        const lastToken = tokens[tokens.length - 1];
        if (lastToken?.type === 'RBRACE' && lastToken.range[1] === i) {
            blockEnds.set(startIndex, tokens.length - 1);
        }
    }
    tokens.push({ type: 'EOF', text: '', range: [text.length, text.length] });
    return { tokens, blockEnds };
}
/**
 * Tokenizes a standalone, already-isolated expression string with no surrounding `${...}`/`#{...}`
 * wrapper -- e.g. a self-contained chain string (`elChainAdapter.ts`'s `parseStandaloneElChain`) or a
 * single call argument's own text (`CallArg.text`). Same per-character tokenizing as `tokenizeEl`'s inner
 * blocks (`lexExpressionBody` with `stopAtDepthZeroRBrace: false`), so a nested set/map literal
 * inside the expression still tokenizes correctly; there's simply no enclosing `}` to stop at here.
 */
function tokenizeElExpressionBody(text) {
    const tokens = [];
    lexExpressionBody(text, 0, tokens, false);
    tokens.push({ type: 'EOF', text: '', range: [text.length, text.length] });
    return tokens;
}
/**
 * `LITERAL_EXPRESSION` -- consumes plain (non-EL) text up to (not including) the next real `${`/
 * `#{` start, the next bare span's own start (`stopAt`, if any -- see `tokenizeEl`'s own comment on
 * why a bare span needs to interrupt a literal run the same way a real block start does), or to the
 * end of `text`. An escaping backslash (`\$`, `\#`) is consumed as part of the literal run and
 * specifically prevents the `$`/`#` right after it from being read as a block start, matching the
 * `.jjt`'s own `(~["$","#","\\"])* "\\" (["$","#"])?` alternative. Returns the index right after the
 * literal run (at a real block start, at `stopAt`, or at `text.length`).
 */
function lexLiteralRun(text, start, tokens, stopAt) {
    let i = start;
    while (i < text.length && i !== stopAt) {
        const ch = text[i];
        // A backslash at `stopAt - 1` still stops right at `stopAt` rather than consuming one char
        // past it as part of a (real or bare-span-adjacent) escape pair -- `stopAt` is a bare span's
        // own start, real document content the escape has no business swallowing.
        if (ch === '\\' && i + 1 < text.length && i + 1 !== stopAt) {
            i += 2;
            continue;
        }
        if ((ch === '$' || ch === '#') && text[i + 1] === '{') {
            break;
        }
        i++;
    }
    if (i > start) {
        tokens.push({ type: 'LITERAL_EXPRESSION', text: text.slice(start, i), range: [start, i] });
    }
    return i;
}
/**
 * Tokenizes one `${...}`/`#{...}` block's body, starting right after its opening `${`/`#{` (i.e.
 * `bodyStart` is the first character of the expression itself). Tracks brace depth exactly like
 * the `.jjt`'s own state-stack: a nested `{` (`START_SET_OR_MAP`, entering a set/map literal)
 * increments it, and each `}` either closes that nested literal (depth > 0, emitted as its own
 * `RBRACE` token for `SetData`/`MapData` to consume) or closes the whole block (depth === 0, also
 * emitted as `RBRACE`, but this function then returns when `stopAtDepthZeroRBrace` is set). Returns
 * the index right after that closing `}` (i.e. back in literal-text territory), or `text.length` if
 * the block never closes. `stopAtDepthZeroRBrace` is `false` for `tokenizeElExpressionBody`'s
 * standalone-expression case, where there's no enclosing block to close at all -- a depth-0 `}`
 * there is simply a syntax error the parser will reject on its own, not a block boundary. `end`
 * (default `text.length`) bounds a bare span's own body the same way -- there's no closing `}` to
 * stop at either, but unlike a standalone expression's own text, this runs directly against the
 * real document `text`, which keeps going well past the span itself.
 */
function lexExpressionBody(text, bodyStart, tokens, stopAtDepthZeroRBrace, end = text.length) {
    let i = bodyStart;
    let braceDepth = 0;
    while (i < end) {
        const ch = text[i];
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
            i++;
            continue;
        }
        if (ch === '{') {
            tokens.push({ type: 'START_SET_OR_MAP', text: '{', range: [i, i + 1] });
            braceDepth++;
            i++;
            continue;
        }
        if (ch === '}') {
            tokens.push({ type: 'RBRACE', text: '}', range: [i, i + 1] });
            i++;
            if (braceDepth === 0) {
                if (stopAtDepthZeroRBrace) {
                    return i;
                }
                continue;
            }
            braceDepth--;
            continue;
        }
        const two = text.slice(i, i + 2);
        const twoCharToken = TWO_CHAR_OPERATORS.get(two);
        if (twoCharToken) {
            tokens.push({ type: twoCharToken, text: two, range: [i, i + 2] });
            i += 2;
            continue;
        }
        if (ch === '"' || ch === "'") {
            const { token, end } = lexStringLiteral(text, i);
            tokens.push(token);
            i = end;
            continue;
        }
        if (DIGIT.test(ch) || (ch === '.' && DIGIT.test(text[i + 1] ?? ''))) {
            const { token, end } = lexNumber(text, i);
            tokens.push(token);
            i = end;
            continue;
        }
        if (IDENTIFIER_START.test(ch)) {
            const { token, end } = lexIdentifierOrKeyword(text, i);
            tokens.push(token);
            i = end;
            continue;
        }
        const oneCharToken = ONE_CHAR_OPERATORS.get(ch);
        if (oneCharToken) {
            tokens.push({ type: oneCharToken, text: ch, range: [i, i + 1] });
            i++;
            continue;
        }
        throw new ElLexerError(`Unexpected character ${JSON.stringify(ch)} in EL expression`, [i, i + 1]);
    }
    return i;
}
const TWO_CHAR_OPERATORS = new Map([
    ['==', 'EQ'],
    ['!=', 'NE'],
    ['<=', 'LE'],
    ['>=', 'GE'],
    ['&&', 'AND'],
    ['||', 'OR'],
    ['+=', 'CONCAT'],
    ['->', 'ARROW'],
]);
const ONE_CHAR_OPERATORS = new Map([
    ['.', 'DOT'],
    ['(', 'LPAREN'],
    [')', 'RPAREN'],
    ['[', 'LBRACK'],
    [']', 'RBRACK'],
    [':', 'COLON'],
    [';', 'SEMICOLON'],
    [',', 'COMMA'],
    ['>', 'GT'],
    ['<', 'LT'],
    ['!', 'NOT'],
    ['*', 'MULT'],
    ['+', 'PLUS'],
    ['-', 'MINUS'],
    ['?', 'QUESTIONMARK'],
    ['/', 'DIV'],
    ['%', 'MOD'],
    ['=', 'ASSIGN'],
]);
/**
 * `STRING_LITERAL` -- either quote style, with the same backslash-escaping rule as
 * `jspScan.ts`'s `maskElStringLiterals`/`scanTagAttributes` (a backslash immediately before the
 * delimiting quote, another quote character, or another backslash doesn't end the literal early).
 * An unterminated literal (no closing quote before `text` ends) consumes to the end of `text`
 * rather than throwing -- mirrors this codebase's existing "still being typed" tolerance elsewhere.
 */
function lexStringLiteral(text, start) {
    const quote = text[start];
    let i = start + 1;
    while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\' && i + 1 < text.length) {
            i += 2;
            continue;
        }
        i++;
    }
    const end = Math.min(i + 1, text.length); // include the closing quote, if any
    return { token: { type: 'STRING', text: text.slice(start, end), range: [start, end] }, end };
}
/**
 * `INTEGER_LITERAL` / `FLOATING_POINT_LITERAL` -- maximal munch decides which: a run of digits
 * stays `INTEGER` unless followed by a `.` (any number of digits after it, including zero -- `"1."`
 * is a valid float per the `.jjt`) or an exponent, either of which makes the whole thing `FLOAT`.
 * A leading `.` (no digits before it) is only reached here when a digit follows (checked by the
 * caller), matching the grammar's `"." (digit)+ (EXPONENT)?` alternative.
 */
function lexNumber(text, start) {
    let i = start;
    let isFloat = false;
    if (text[i] === '.') {
        isFloat = true;
        i++;
        while (DIGIT.test(text[i] ?? '')) {
            i++;
        }
    }
    else {
        while (DIGIT.test(text[i] ?? '')) {
            i++;
        }
        if (text[i] === '.') {
            isFloat = true;
            i++;
            while (DIGIT.test(text[i] ?? '')) {
                i++;
            }
        }
    }
    if ((text[i] === 'e' || text[i] === 'E') && looksLikeExponent(text, i)) {
        isFloat = true;
        i++;
        if (text[i] === '+' || text[i] === '-') {
            i++;
        }
        while (DIGIT.test(text[i] ?? '')) {
            i++;
        }
    }
    return { token: { type: isFloat ? 'FLOAT' : 'INTEGER', text: text.slice(start, i), range: [start, i] }, end: i };
}
/** `EXPONENT: ["e","E"] (["+","-"])? (digit)+` -- checked before committing so a bare trailing
 * `e`/`E` with no digits after it (not a valid exponent) isn't swallowed into the number. */
function looksLikeExponent(text, eIndex) {
    let j = eIndex + 1;
    if (text[j] === '+' || text[j] === '-') {
        j++;
    }
    return DIGIT.test(text[j] ?? '');
}
/**
 * `IDENTIFIER` -- consumes the maximal identifier-shaped run first (so e.g. `"empty2"` becomes one
 * `IDENTIFIER`, never `EMPTY` + `IDENTIFIER("2")`: longest match already wins by construction), then
 * checks the whole consumed text against the reserved-word table (`eq`, `and`, `empty`, `true`,
 * etc.) -- matching how the `.jjt` resolves the same ambiguity (a literal-string token declared
 * before `<IDENTIFIER>` wins a same-length tie).
 */
function lexIdentifierOrKeyword(text, start) {
    let i = start + 1;
    while (i < text.length && IDENTIFIER_PART.test(text[i])) {
        i++;
    }
    const word = text.slice(start, i);
    const keywordType = KEYWORD_TOKEN_TYPES.get(word);
    return { token: { type: keywordType ?? 'IDENTIFIER', text: word, range: [start, i] }, end: i };
}
//# sourceMappingURL=elLexer.js.map