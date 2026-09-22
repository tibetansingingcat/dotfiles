"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ElParseError = void 0;
exports.parseElDocument = parseElDocument;
exports.parseElExpression = parseElExpression;
const elLexer_1 = require("./elLexer");
class ElParseError extends Error {
    range;
    constructor(message, range) {
        super(message);
        this.range = range;
    }
}
exports.ElParseError = ElParseError;
function mergeRange(a, b) {
    return [a[0], b[1]];
}
/**
 * Recursive-descent parser following the vendored `docs/ELParser.jjt`'s own production chain and
 * precedence order exactly (see `docs/README.md` for provenance) -- one method per named
 * production, cited by name in each method's doc comment. JavaCC's `LOOKAHEAD(n)` bounded-token
 * lookahead is replaced with explicit "peek ahead, and only commit by actually advancing the
 * cursor once the shape is confirmed" checks (`tryParseLambdaParams`, `looksLikeFunctionCall`,
 * `looksLikeMapData`) -- equivalent in effect, just not bounded to a fixed token count the way
 * JavaCC's own generated lookahead is.
 */
class Parser {
    tokens;
    blockEnds;
    pos = 0;
    constructor(tokens, blockEnds = new Map()) {
        this.tokens = tokens;
        this.blockEnds = blockEnds;
    }
    peek(offset = 0) {
        return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
    }
    at(type) {
        return this.peek().type === type;
    }
    advance() {
        const token = this.tokens[this.pos];
        if (this.pos < this.tokens.length - 1) {
            this.pos++;
        }
        return token;
    }
    expect(type) {
        if (!this.at(type)) {
            throw new ElParseError(`Expected ${type} but found ${this.peek().type} (${JSON.stringify(this.peek().text)})`, this.peek().range);
        }
        return this.advance();
    }
    expectEof() {
        this.expect('EOF');
    }
    /**
     * `CompositeExpression: (DeferredExpression() | DynamicExpression() | LiteralExpression())* <EOF>`
     * -- recovers from one block that fails to parse (see `elAst.ts`'s `ErrorExpressionNode` and
     * `TokenizedDocument.blockEnds`'s own comments on why): the rest of the document's blocks must
     * not go dark because of one broken/still-being-typed one.
     */
    parseCompositeExpression() {
        const start = this.peek().range[0];
        const parts = [];
        while (!this.at('EOF')) {
            if (this.at('LITERAL_EXPRESSION')) {
                const token = this.advance();
                parts.push({ kind: 'LiteralExpression', text: token.text, range: token.range });
            }
            else if (this.at('START_DYNAMIC_EXPRESSION') || this.at('START_DEFERRED_EXPRESSION')) {
                parts.push(this.parseBlockWithRecovery());
            }
            else {
                throw new ElParseError(`Unexpected token ${this.peek().type}`, this.peek().range);
            }
        }
        const end = parts.length ? parts[parts.length - 1].range[1] : start;
        return { kind: 'CompositeExpression', parts, range: [start, end] };
    }
    parseBlockWithRecovery() {
        const startIndex = this.pos;
        const startToken = this.peek();
        const isDeferred = startToken.type === 'START_DEFERRED_EXPRESSION';
        const blockEnd = this.blockEnds.get(startIndex);
        try {
            this.advance(); // START_DYNAMIC_EXPRESSION / START_DEFERRED_EXPRESSION
            const expression = this.parseExpression();
            const endToken = this.expect('RBRACE');
            return {
                kind: isDeferred ? 'DeferredExpression' : 'DynamicExpression',
                expression,
                range: mergeRange(startToken.range, endToken.range),
            };
        }
        catch (error) {
            const recoverToIndex = blockEnd ?? this.tokens.length - 1; // fall back to EOF
            const recoverToToken = this.tokens[recoverToIndex];
            const range = mergeRange(startToken.range, recoverToToken.range);
            this.pos = Math.min(recoverToIndex + 1, this.tokens.length - 1);
            const message = error instanceof Error ? error.message : String(error);
            return { kind: 'ErrorExpression', text: '', message, range };
        }
    }
    /** `Expression: Semicolon()` */
    parseExpression() {
        return this.parseSemicolon();
    }
    /** `Semicolon: Assignment() ( <SEMICOLON> Assignment() #Semicolon(2) )*` */
    parseSemicolon() {
        const first = this.parseAssignment();
        const parts = [first];
        while (this.at('SEMICOLON')) {
            this.advance();
            parts.push(this.parseAssignment());
        }
        if (parts.length === 1) {
            return first;
        }
        return { kind: 'Semicolon', parts, range: mergeRange(parts[0].range, parts[parts.length - 1].range) };
    }
    /**
     * `Assignment: LOOKAHEAD(4) LambdaExpression() | Ternary() ( LOOKAHEAD(2) <ASSIGN> Assignment() #Assign(2) )*`
     */
    parseAssignment() {
        const lambda = this.tryParseLambdaExpression();
        if (lambda) {
            return lambda;
        }
        let left = this.parseTernary();
        while (this.at('ASSIGN')) {
            this.advance();
            const value = this.parseAssignment();
            left = { kind: 'Assign', target: left, value, range: mergeRange(left.range, value.range) };
        }
        return left;
    }
    /**
     * `LambdaExpression: LambdaParameters() <ARROW> ( LOOKAHEAD(3) LambdaExpression() | Ternary() )` --
     * only commits (advancing the cursor) once `tryParseLambdaParams` confirms a params list is
     * immediately followed by `->`; otherwise returns `null` having consumed nothing, so the caller
     * falls through to `Ternary()` as the grammar's own `LOOKAHEAD` would.
     */
    tryParseLambdaExpression() {
        const paramsResult = this.tryParseLambdaParams(this.pos);
        if (!paramsResult || this.tokens[paramsResult.end]?.type !== 'ARROW') {
            return null;
        }
        const start = this.peek().range[0];
        this.pos = paramsResult.end;
        this.advance(); // ARROW
        const body = this.tryParseLambdaExpression() ?? this.parseTernary();
        return { kind: 'LambdaExpression', params: paramsResult.params, body, range: mergeRange([start, start], body.range) };
    }
    /**
     * `LambdaParameters: Identifier() | <LPAREN> ( Identifier() ( <COMMA> Identifier() )* )? <RPAREN>`
     * -- pure lookahead, does not touch `this.pos`; returns the parameter names and the token index
     * right after the parameter list (where the caller then checks for `->`) or `null` if `pos`
     * doesn't start a syntactically valid parameter list at all.
     */
    tryParseLambdaParams(pos) {
        if (this.tokens[pos]?.type === 'IDENTIFIER') {
            return { params: [this.tokens[pos].text], end: pos + 1 };
        }
        if (this.tokens[pos]?.type !== 'LPAREN') {
            return null;
        }
        let p = pos + 1;
        if (this.tokens[p]?.type === 'RPAREN') {
            return { params: [], end: p + 1 };
        }
        const params = [];
        while (true) {
            if (this.tokens[p]?.type !== 'IDENTIFIER') {
                return null;
            }
            params.push(this.tokens[p].text);
            p++;
            if (this.tokens[p]?.type === 'COMMA') {
                p++;
                continue;
            }
            if (this.tokens[p]?.type === 'RPAREN') {
                return { params, end: p + 1 };
            }
            return null;
        }
    }
    /**
     * `Ternary: Or() ( (QM QM Ternary() #NullCoalescing(2)) | (QM COLON Ternary() #Elvis(2)) |
     * (QM Ternary() COLON Ternary() #Choice(3)) )*` -- implemented as a single check, not a loop:
     * each alternative's own recursive `Ternary()` call for its right-hand slot(s) already consumes
     * everything ternary-shaped that follows, so the grammar's `*` repetition has nothing left to
     * match again in well-formed input (right-associativity falls out of the recursion itself).
     */
    parseTernary() {
        const left = this.parseOr();
        if (!this.at('QUESTIONMARK')) {
            return left;
        }
        if (this.peek(1).type === 'QUESTIONMARK') {
            this.advance();
            this.advance();
            const right = this.parseTernary();
            const node = { kind: 'NullCoalescing', left, right, range: mergeRange(left.range, right.range) };
            return node;
        }
        if (this.peek(1).type === 'COLON') {
            this.advance();
            this.advance();
            const right = this.parseTernary();
            const node = { kind: 'Elvis', left, right, range: mergeRange(left.range, right.range) };
            return node;
        }
        this.advance(); // QUESTIONMARK
        const whenTrue = this.parseTernary();
        this.expect('COLON');
        const whenFalse = this.parseTernary();
        const node = { kind: 'Choice', test: left, whenTrue, whenFalse, range: mergeRange(left.range, whenFalse.range) };
        return node;
    }
    /** `Or: And() [((OR0|OR1) And())+ #Or(jjtree.nodeArity() + 1)]` -- flattened n-ary, not nested pairs. */
    parseOr() {
        return this.parseNAryBinary('OR', 'Or', () => this.parseAnd());
    }
    /** `And: Equality() [((AND0|AND1) Equality())+ #And(jjtree.nodeArity() + 1)]` -- flattened n-ary. */
    parseAnd() {
        return this.parseNAryBinary('AND', 'And', () => this.parseEquality());
    }
    parseNAryBinary(tokenType, op, parseOperand) {
        const first = parseOperand();
        const operands = [first];
        while (this.at(tokenType)) {
            this.advance();
            operands.push(parseOperand());
        }
        if (operands.length === 1) {
            return first;
        }
        const node = { kind: 'Binary', op, operands, range: mergeRange(first.range, operands[operands.length - 1].range) };
        return node;
    }
    /** `Equality: Compare() ( ((EQ0|EQ1) Compare() #Equal(2)) | ((NE0|NE1) Compare() #NotEqual(2)) )*` */
    parseEquality() {
        return this.parseLeftAssociativeBinary(() => this.parseCompare(), [
            ['EQ', 'Equal'],
            ['NE', 'NotEqual'],
        ]);
    }
    /**
     * `Compare: Concatenation() ( ((LT0|LT1) ... #LessThan(2)) | ((GT0|GT1) ... #GreaterThan(2)) |
     * ((LE0|LE1) ... #LessThanEqual(2)) | ((GE0|GE1) ... #GreaterThanEqual(2)) )*`
     */
    parseCompare() {
        return this.parseLeftAssociativeBinary(() => this.parseConcatenation(), [
            ['LT', 'LessThan'],
            ['GT', 'GreaterThan'],
            ['LE', 'LessThanEqual'],
            ['GE', 'GreaterThanEqual'],
        ]);
    }
    /** `Concatenation: Math() ( <CONCAT> Math() #Concatenation(2) )*` */
    parseConcatenation() {
        return this.parseLeftAssociativeBinary(() => this.parseMath(), [['CONCAT', 'Concatenation']]);
    }
    /** `Math: Multiplication() ( (<PLUS> ... #Plus(2)) | (<MINUS> ... #Minus(2)) )*` */
    parseMath() {
        return this.parseLeftAssociativeBinary(() => this.parseMultiplication(), [
            ['PLUS', 'Plus'],
            ['MINUS', 'Minus'],
        ]);
    }
    /** `Multiplication: Unary() ( (<MULT> ... #Mult(2)) | ((DIV0|DIV1) ... #Div(2)) | ((MOD0|MOD1) ... #Mod(2)) )*` */
    parseMultiplication() {
        return this.parseLeftAssociativeBinary(() => this.parseUnary(), [
            ['MULT', 'Mult'],
            ['DIV', 'Div'],
            ['MOD', 'Mod'],
        ]);
    }
    parseLeftAssociativeBinary(parseOperand, ops) {
        let left = parseOperand();
        outer: while (true) {
            for (const [tokenType, op] of ops) {
                if (this.at(tokenType)) {
                    this.advance();
                    const right = parseOperand();
                    left = { kind: 'Binary', op, operands: [left, right], range: mergeRange(left.range, right.range) };
                    continue outer;
                }
            }
            return left;
        }
    }
    /**
     * `Unary: <MINUS> Unary() #Negative | LOOKAHEAD(2) (NOT0|NOT1) <EMPTY> Unary() #NotEmpty |
     * (NOT0|NOT1) Unary() #Not | <EMPTY> Unary() #Empty | Value()`
     */
    parseUnary() {
        if (this.at('MINUS')) {
            const start = this.advance();
            const operand = this.parseUnary();
            return { kind: 'Unary', op: 'Negative', operand, range: mergeRange(start.range, operand.range) };
        }
        if (this.at('NOT')) {
            const start = this.advance();
            if (this.at('EMPTY')) {
                this.advance();
                const operand = this.parseUnary();
                return { kind: 'Unary', op: 'NotEmpty', operand, range: mergeRange(start.range, operand.range) };
            }
            const operand = this.parseUnary();
            return { kind: 'Unary', op: 'Not', operand, range: mergeRange(start.range, operand.range) };
        }
        if (this.at('EMPTY')) {
            const start = this.advance();
            const operand = this.parseUnary();
            return { kind: 'Unary', op: 'Empty', operand, range: mergeRange(start.range, operand.range) };
        }
        return this.parseValue();
    }
    /**
     * `Value: (ValuePrefix() (ValueSuffix())*) #Value(>1)` -- the `>1` guard means a bare prefix with
     * zero suffixes never becomes a `ValueNode`; its own node is returned directly.
     */
    parseValue() {
        const prefix = this.parseValuePrefix();
        const suffixes = [];
        while (this.at('DOT') || this.at('LBRACK')) {
            suffixes.push(this.parseValueSuffix());
        }
        if (suffixes.length === 0) {
            return prefix;
        }
        const lastSuffix = suffixes[suffixes.length - 1];
        const end = lastSuffix.call?.range[1] ?? lastSuffix.suffix.range[1];
        const node = { kind: 'Value', prefix: prefix, suffixes, range: [prefix.range[0], end] };
        return node;
    }
    /** `ValueSuffix: ( DotSuffix() | BracketSuffix() ) ( MethodParameters() )?` */
    parseValueSuffix() {
        let suffix;
        if (this.at('DOT')) {
            const dotToken = this.advance();
            // The `.jjt`'s `DotSuffix` requires a plain `<IDENTIFIER>` here -- EL's own lexer doesn't
            // reserve Java keywords (only its own operator words), so e.g. `.int` parses fine at this
            // level; Tomcat's `TestELParser.testJavaKeyWordSuffix` expects that specific case to fail,
            // but only later, at Java-bean property *resolution* -- a semantic check this parser doesn't
            // perform, not a syntax one.
            const nameToken = this.expect('IDENTIFIER');
            suffix = { kind: 'DotSuffix', name: nameToken.text, range: mergeRange(dotToken.range, nameToken.range) };
        }
        else {
            const openToken = this.expect('LBRACK');
            const index = this.parseExpression();
            const closeToken = this.expect('RBRACK');
            suffix = { kind: 'BracketSuffix', index, range: mergeRange(openToken.range, closeToken.range) };
        }
        let call;
        if (this.at('LPAREN')) {
            call = this.parseMethodParameters();
        }
        return { suffix, call };
    }
    /** `MethodParameters: <LPAREN> ( Expression() ( <COMMA> Expression() )* )? <RPAREN>` */
    parseMethodParameters() {
        const openToken = this.expect('LPAREN');
        const args = [];
        if (!this.at('RPAREN')) {
            args.push(this.parseExpression());
            while (this.at('COMMA')) {
                this.advance();
                args.push(this.parseExpression());
            }
        }
        const closeToken = this.expect('RPAREN');
        return { args, range: mergeRange(openToken.range, closeToken.range) };
    }
    /** `ValuePrefix: Literal() | NonLiteral()` */
    parseValuePrefix() {
        if (this.at('TRUE') || this.at('FALSE') || this.at('NULL') || this.at('INTEGER') || this.at('FLOAT') || this.at('STRING')) {
            return this.parseLiteral();
        }
        return this.parseNonLiteral();
    }
    /** `Literal: Boolean() | FloatingPoint() | Integer() | String() | Null()` -- one shared node shape. */
    parseLiteral() {
        const token = this.advance();
        const literalKindByType = {
            TRUE: 'boolean',
            FALSE: 'boolean',
            NULL: 'null',
            INTEGER: 'integer',
            FLOAT: 'float',
            STRING: 'string',
        };
        const literalKind = literalKindByType[token.type];
        if (!literalKind) {
            throw new ElParseError(`Expected a literal but found ${token.type}`, token.range);
        }
        return { kind: 'Literal', literalKind, raw: token.text, range: token.range };
    }
    /**
     * `NonLiteral: LOOKAHEAD(5) LambdaExpressionOrInvocation() | <LPAREN> Expression() <RPAREN> |
     * LOOKAHEAD((<IDENTIFIER> <COLON>)? <IDENTIFIER> <LPAREN>) Function() | Identifier() |
     * LOOKAHEAD(5) SetData() | ListData() | MapData()`
     */
    parseNonLiteral() {
        if (this.at('LPAREN')) {
            // `LambdaExpressionOrInvocation`'s own `<LPAREN>` here is a fixed, unconditionally-consumed
            // wrapper -- distinct from `LambdaParameters`' own optional `<LPAREN> (...) <RPAREN>` form,
            // which only starts at the *next* token. Probing at `this.pos` itself (the wrapper's `(`)
            // would treat it as if it were the params list's own opening paren instead.
            const lambdaParams = this.tryParseLambdaParams(this.pos + 1);
            if (lambdaParams && this.tokens[lambdaParams.end]?.type === 'ARROW') {
                return this.parseLambdaExpressionOrInvocation();
            }
            return this.parseGroupedExpression();
        }
        if (this.looksLikeFunctionCall(this.pos)) {
            return this.parseFunction();
        }
        if (this.at('IDENTIFIER')) {
            const token = this.advance();
            const node = { kind: 'Identifier', name: token.text, range: token.range };
            return node;
        }
        if (this.at('LBRACK')) {
            return this.parseListData();
        }
        if (this.at('START_SET_OR_MAP')) {
            return this.looksLikeMapData(this.pos) ? this.parseMapData() : this.parseSetData();
        }
        throw new ElParseError(`Expected a value but found ${this.peek().type}`, this.peek().range);
    }
    /** `<LPAREN> Expression() <RPAREN>` -- no `#Name` annotation in the `.jjt`, so no wrapper node;
     * the inner expression's own node is returned directly (see `elAst.ts`'s own comment on this). */
    parseGroupedExpression() {
        this.expect('LPAREN');
        const inner = this.parseExpression();
        this.expect('RPAREN');
        return inner;
    }
    /**
     * `LambdaExpressionOrInvocation: <LPAREN> LambdaParameters() <ARROW> ( LOOKAHEAD(3)
     * LambdaExpression() | Ternary() ) <RPAREN> ( MethodParameters() )*` -- the parenthesized,
     * optionally-immediately-invoked form; only reached once `parseNonLiteral` has already confirmed
     * (via `tryParseLambdaParams`) that a parameter list followed by `->` sits behind this `(`.
     */
    parseLambdaExpressionOrInvocation() {
        const openToken = this.expect('LPAREN');
        const params = this.parseLambdaParams();
        this.expect('ARROW');
        const body = this.tryParseLambdaExpression() ?? this.parseTernary();
        const closeToken = this.expect('RPAREN');
        const invokedWith = [];
        let end = closeToken.range[1];
        while (this.at('LPAREN')) {
            const call = this.parseMethodParameters();
            invokedWith.push(call.args);
            end = call.range[1];
        }
        return {
            kind: 'LambdaExpression',
            params,
            body,
            invokedWith: invokedWith.length ? invokedWith : undefined,
            range: [openToken.range[0], end],
        };
    }
    /** `LambdaParameters` -- actually consuming the tokens (as opposed to `tryParseLambdaParams`'s
     * pure lookahead), used once the caller has already committed to parsing a lambda. */
    parseLambdaParams() {
        if (this.at('IDENTIFIER')) {
            return [this.advance().text];
        }
        this.expect('LPAREN');
        const params = [];
        if (this.at('RPAREN')) {
            this.advance();
            return params;
        }
        while (true) {
            params.push(this.expect('IDENTIFIER').text);
            if (this.at('COMMA')) {
                this.advance();
                continue;
            }
            this.expect('RPAREN');
            return params;
        }
    }
    /** `(<IDENTIFIER> <COLON>)? <IDENTIFIER> <LPAREN>` -- pure lookahead, does not touch `this.pos`. */
    looksLikeFunctionCall(pos) {
        if (this.tokens[pos]?.type !== 'IDENTIFIER') {
            return false;
        }
        if (this.tokens[pos + 1]?.type === 'COLON' && this.tokens[pos + 2]?.type === 'IDENTIFIER' && this.tokens[pos + 3]?.type === 'LPAREN') {
            return true;
        }
        return this.tokens[pos + 1]?.type === 'LPAREN';
    }
    /** `Function: t0=<IDENTIFIER> ( <COLON> t1=<IDENTIFIER> )? ( MethodParameters() )+` */
    parseFunction() {
        const firstToken = this.advance(); // IDENTIFIER, already confirmed by looksLikeFunctionCall
        let prefix;
        let nameToken = firstToken;
        if (this.at('COLON')) {
            this.advance();
            nameToken = this.expect('IDENTIFIER');
            prefix = firstToken.text;
        }
        const nameRange = mergeRange(firstToken.range, nameToken.range);
        const argLists = [];
        let end = nameToken.range[1];
        while (this.at('LPAREN')) {
            const call = this.parseMethodParameters();
            argLists.push(call.args);
            end = call.range[1];
        }
        return { kind: 'Function', prefix, name: nameToken.text, nameRange, argLists, range: [firstToken.range[0], end] };
    }
    /** `ListData: <LBRACK> ( Expression() ( <COMMA> Expression() )* )? <RBRACK>` */
    parseListData() {
        const openToken = this.expect('LBRACK');
        const elements = [];
        if (!this.at('RBRACK')) {
            elements.push(this.parseExpression());
            while (this.at('COMMA')) {
                this.advance();
                elements.push(this.parseExpression());
            }
        }
        const closeToken = this.expect('RBRACK');
        return { kind: 'ListData', elements, range: mergeRange(openToken.range, closeToken.range) };
    }
    /** `SetData: <START_SET_OR_MAP> ( Expression() ( <COMMA> Expression() )* )? <RBRACE>` -- an empty
     * `{}` always parses as an empty `SetData`, per the `.jjt`'s own comment on this ambiguity. */
    parseSetData() {
        const openToken = this.expect('START_SET_OR_MAP');
        const elements = [];
        if (!this.at('RBRACE')) {
            elements.push(this.parseExpression());
            while (this.at('COMMA')) {
                this.advance();
                elements.push(this.parseExpression());
            }
        }
        const closeToken = this.expect('RBRACE');
        return { kind: 'SetData', elements, range: mergeRange(openToken.range, closeToken.range) };
    }
    /** `MapData`/`MapEntry`: `<START_SET_OR_MAP> ( MapEntry() ( <COMMA> MapEntry() )* )? <RBRACE>`,
     * `MapEntry: Expression() <COLON> Expression()` */
    parseMapData() {
        const openToken = this.expect('START_SET_OR_MAP');
        const entries = [];
        if (!this.at('RBRACE')) {
            entries.push(this.parseMapEntry());
            while (this.at('COMMA')) {
                this.advance();
                entries.push(this.parseMapEntry());
            }
        }
        const closeToken = this.expect('RBRACE');
        return { kind: 'MapData', entries, range: mergeRange(openToken.range, closeToken.range) };
    }
    parseMapEntry() {
        const key = this.parseExpression();
        this.expect('COLON');
        const value = this.parseExpression();
        return { key, value };
    }
    /**
     * Disambiguates `SetData` vs `MapData` once a `{` has been seen (both start with
     * `START_SET_OR_MAP`) -- mirrors the `.jjt`'s own `LOOKAHEAD(5) SetData() | ListData() |
     * MapData()` heuristic, just unbounded rather than fixed at 5 tokens: scans the first element
     * only (matching or failing to match `Expression COLON`, at depth 0 relative to this `{`, is
     * enough -- every entry in one `{...}` is a `MapEntry` or none are). A `?`/`:` pair belonging to
     * a ternary/Elvis inside that first element is tracked (`pendingTernaries`) so it isn't mistaken
     * for a map-entry separator; `??`/`?:` are treated as complete two-token operators needing no
     * separate matching `:`. Not exhaustively correct for arbitrarily nested ternaries-inside-set-
     * literals (no real usage of set/map/list EL literals exists in this codebase at all -- see the
     * plan's "Scope" section), just good enough not to misfire on the common shapes.
     */
    looksLikeMapData(pos) {
        let depth = 0;
        let pendingTernaries = 0;
        let p = pos + 1;
        while (this.tokens[p] && this.tokens[p].type !== 'EOF') {
            const type = this.tokens[p].type;
            if (depth === 0) {
                if (type === 'RBRACE' || type === 'COMMA') {
                    return false;
                }
                if (type === 'COLON') {
                    if (pendingTernaries > 0) {
                        pendingTernaries--;
                        p++;
                        continue;
                    }
                    return true;
                }
                if (type === 'QUESTIONMARK') {
                    const next = this.tokens[p + 1]?.type;
                    if (next === 'QUESTIONMARK' || next === 'COLON') {
                        p += 2;
                        continue;
                    }
                    pendingTernaries++;
                    p++;
                    continue;
                }
            }
            if (type === 'LPAREN' || type === 'LBRACK' || type === 'START_SET_OR_MAP') {
                depth++;
            }
            else if (type === 'RPAREN' || type === 'RBRACK' || type === 'RBRACE') {
                depth--;
            }
            p++;
        }
        return false;
    }
}
// A single-entry memo, not a real cache -- `el/elChainAdapter.ts`'s chain/function-call collectors
// (and `jspScan.ts`'s `findTokenAt`, which calls two of those in a row on every hover/"go to
// definition" request) all re-parse the *same* document text repeatedly in quick succession; this
// turns that specific, common pattern back into one real parse rather than two-plus, without
// building out a real multi-document cache this single-file scanner has no other need for. Keyed on
// `bareSpans` too now (by reference, not deep-equality -- cheap, and every real caller computes its
// spans once and passes the same array to a short run of sibling calls, exactly the pattern this
// memo already exists for) so a bare-spans-aware call can't return a stale document parsed without
// them, or vice versa; `tokenizeEl`'s own `NO_BARE_EL_SPANS` constant is what keeps the ordinary
// (no bare spans) case -- still the overwhelming majority of calls -- hitting this memo exactly as
// it always did, rather than every omitted-argument call missing on a freshly-allocated `[]`.
let lastParsedText;
let lastParsedBareSpans;
let lastParsedDocument;
/**
 * Parses a whole document/text span for its `${...}`/`#{...}` blocks, plus any configured bare EL
 * attribute spans (see `BareElSpan`'s own doc in `jspScan.ts`) -- replaces `EL_BLOCK`'s regex (see
 * `jspScan.ts`) as the entry point for finding EL blocks anywhere in arbitrary JSP source text.
 * Never throws: one block (real or bare) that fails to parse becomes an `ErrorExpressionNode` in
 * `parts` rather than taking down every other block in the document (see `parseBlockWithRecovery`'s
 * own comment).
 */
function parseElDocument(text, bareSpans = elLexer_1.NO_BARE_EL_SPANS) {
    if (text === lastParsedText && bareSpans === lastParsedBareSpans && lastParsedDocument) {
        return lastParsedDocument;
    }
    const { tokens, blockEnds } = (0, elLexer_1.tokenizeEl)(text, bareSpans);
    const document = new Parser(tokens, blockEnds).parseCompositeExpression();
    lastParsedText = text;
    lastParsedBareSpans = bareSpans;
    lastParsedDocument = document;
    return document;
}
/** Parses a standalone, already-isolated expression string with no `${...}`/`#{...}` wrapper --
 * e.g. a self-contained chain string or a single call argument's own text. */
function parseElExpression(text) {
    const parser = new Parser((0, elLexer_1.tokenizeElExpressionBody)(text));
    const node = parser.parseExpression();
    parser.expectEof();
    return node;
}
//# sourceMappingURL=elParser.js.map