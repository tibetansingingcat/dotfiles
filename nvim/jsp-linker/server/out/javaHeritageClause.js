"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractHeritageTypeArguments = extractHeritageTypeArguments;
exports.extractDeclaredTypeParameters = extractDeclaredTypeParameters;
exports.extractMethodTypeParameters = extractMethodTypeParameters;
const tldParsing_1 = require("./tldParsing");
/**
 * Extracts the concrete type-argument list one already-identified supertype is instantiated with in
 * a class/interface's own `extends`/`implements` clause -- e.g. given the source text right after
 * `class PersonPaginator` (`" extends AbstractCQBPaginator<Person, Person, Person> implements
 * ICQBPaginator<Person, Person, Person>, ILetterboxdPaginatorWithPopularity { ... }"`) and
 * `supertypeSimpleName: "AbstractCQBPaginator"`, returns each of the three `Person` texts paired with
 * its own real offset in that source.
 *
 * This exists because jdtls's own type-hierarchy protocol has no field for it at all -- confirmed by
 * decompiling the server's actual `TypeHierarchyItem` DTO (`name`/`detail`/`kind`/`deprecated`/`uri`/
 * `range`/`selectionRange`/`parents`/`children`/`data`, nothing else), and `DocumentSymbol.detail` is
 * empty for a Java class/interface symbol too -- so there is no jdtls call left to delegate this to.
 * Reading it off the declaring type's own source text is the only remaining option.
 *
 * Deliberately NOT a general Java heritage-clause parser -- it doesn't need to understand `sealed`
 * subtyping rules, resolve imports, or validate anything. It only needs to (1) find where the
 * `extends`/`implements`/`permits` clauses begin and end, ignoring any `extends`/`implements`/`{`
 * that appears somewhere it doesn't actually start a real clause (inside the type's own
 * `<...>` type-parameter list -- e.g. `class Foo<T extends Bar<T>>` -- inside an annotation's own
 * `(...)` arguments, inside a string/char literal, or inside a comment), and (2) split whichever
 * clause the target name is in in respecting the same nested-generic-`<...>`-depth rule
 * `splitParamTypes` (tldParsing.ts) already implements for a TLD's own comma-separated signature
 * list -- reused here rather than a second copy of that exact algorithm. Each split piece's own offset
 * is recovered the same non-parsing way (`indexOf` against an advancing cursor, safe since pieces are
 * already known, in order, and non-overlapping) rather than having `splitParamTypes` itself track
 * positions -- that function is shared with TLD signature splitting, which never needed one, so it
 * would be a needless second (position-aware) contract for the one caller here that does.
 *
 * `undefined` -- abstain, don't guess -- when the clause boundaries can't even be found (no depth-0
 * `{` at all, meaning `sourceAfterTypeName` isn't shaped the way this function expects), or when
 * `supertypeSimpleName` doesn't match exactly one heritage entry (zero matches, or more than one --
 * which shouldn't happen in valid Java, but "can't happen" is exactly when guessing wrong is riskiest).
 * An empty array (`[]`) is a real, different answer: the supertype *was* found, written as a raw type
 * with no `<...>` at all (e.g. `extends Foo`, legal but generic-erasing Java) -- there is nothing to
 * substitute, and that's the correct, sound conclusion, not a failure to determine one.
 */
function extractHeritageTypeArguments(sourceAfterTypeName, supertypeSimpleName) {
    const boundaries = findHeritageBoundaries(sourceAfterTypeName);
    if (!boundaries) {
        return undefined;
    }
    const { extendsAt, implementsAt, permitsAt, bodyStart } = boundaries;
    const entries = [];
    if (extendsAt !== undefined) {
        const clauseStart = extendsAt + 'extends'.length;
        const clauseEnd = implementsAt ?? permitsAt ?? bodyStart;
        collectHeritageEntries(sourceAfterTypeName.slice(clauseStart, clauseEnd), clauseStart, entries);
    }
    if (implementsAt !== undefined) {
        const clauseStart = implementsAt + 'implements'.length;
        const clauseEnd = permitsAt ?? bodyStart;
        collectHeritageEntries(sourceAfterTypeName.slice(clauseStart, clauseEnd), clauseStart, entries);
    }
    const matches = entries.filter((entry) => entry.simpleName === supertypeSimpleName);
    return matches.length === 1 ? matches[0].typeArgs ?? [] : undefined;
}
// Splits `text` the way `splitParamTypes` already does, then recovers each returned piece's own
// offset within `text` by searching for it with an advancing cursor -- safe because `splitParamTypes`'
// pieces are already known to appear in this order, trimmed, and non-overlapping, so this is just
// relocating already-correct output, not a second copy of its depth-aware comma-splitting itself.
function splitWithOffsets(text, baseOffset) {
    const result = [];
    let cursor = 0;
    for (const piece of (0, tldParsing_1.splitParamTypes)(text)) {
        const offset = text.indexOf(piece, cursor);
        cursor = offset + piece.length;
        result.push({ text: piece, offset: baseOffset + offset });
    }
    return result;
}
function collectHeritageEntries(clauseText, clauseOffset, into) {
    for (const { text: piece, offset: pieceOffset } of splitWithOffsets(clauseText, clauseOffset)) {
        const parsed = parseHeritageEntry(piece, pieceOffset);
        if (parsed) {
            into.push(parsed);
        }
    }
}
/**
 * Extracts a type's own declared type-parameter names -- e.g. given the source text right after
 * `class Paginator` (`"<T> { ... }"`) returns `["T"]`; given `class ICQBPaginator` (`"<T, ENTITY, Q>
 * extends Paginator<T>, ILetterboxdPaginator { ... }"`) returns `["T", "ENTITY", "Q"]`.
 *
 * This is the *declaring* side of a substitution -- paired with `extractHeritageTypeArguments`'s
 * *instantiating* side -- and exists for the same reason: jdtls's own type-hierarchy protocol has no
 * field for it at all (see that function's own doc). The other source this codebase could reach for
 * instead, `DocumentSymbol.name` (e.g. `"Entry<K, V>"`), hasn't itself been live-disproven the way
 * `supertype.name` was, but hasn't been verified either -- and this codebase already got burned once
 * trusting an unverified jdtls-adjacent field, so there's no good reason to leave this one
 * asymmetric risk in place, especially given real nested-static-generic shapes like
 * `ISingleProductionFilterablePaginator.ProductionAliases<Production>` (this codebase's own) exist,
 * where `DocumentSymbol.name` is far less obviously trustworthy than a bare `Entry<K, V>`.
 *
 * Reuses `findHeritageBoundaries`'s own scan (`ownTypeParamsEnd`) rather than a second copy of it --
 * a type's own declared parameters can themselves contain a bound with a nested `<...>` (e.g.
 * `AnythingListPaginator<TList extends AnythingList<?, ?>>`), the exact same depth-aware skipping
 * `extractHeritageTypeArguments` already needs for a heritage clause's own arguments. Splits the
 * parameter list the same way (`splitParamTypes`) and keeps, from each entry, only the leading
 * identifier -- a parameter's own bound (` extends Foo` or `extends Foo & Bar`, multiple bounds
 * joined by `&`) is never part of its name.
 *
 * `undefined` -- abstain -- when `findHeritageBoundaries` itself can't find where the type's own
 * body starts (`sourceAfterTypeName` isn't shaped like this function expects). An empty array (`[]`)
 * is a real, different answer: the type declares no parameters at all (a non-generic, raw type) --
 * nothing to substitute, not a failure to determine something.
 */
function extractDeclaredTypeParameters(sourceAfterTypeName) {
    const boundaries = findHeritageBoundaries(sourceAfterTypeName);
    if (!boundaries) {
        return undefined;
    }
    if (boundaries.ownTypeParamsEnd === undefined) {
        return [];
    }
    const paramsText = sourceAfterTypeName.slice(1, boundaries.ownTypeParamsEnd - 1);
    // `splitWithOffsets` (not the plain `splitParamTypes` every other user of that function is happy
    // with) -- unlike a heritage argument's *text*, which a caller only ever needs qualified as a whole
    // (`resolveHopSubstitution`), a declared parameter's *bound* needs its own real position too, so a
    // caller applying JLS 4.6 raw-type erasure can qualify it the same way (`qualifyBareIdentifiersIn`)
    // instead of leaving it as a bare, un-package-qualified name -- offset `1` skips the params list's
    // own leading `<`, same as `collectHeritageEntries` does for a heritage clause's own `<...>`.
    return splitWithOffsets(paramsText, 1).map(({ text, offset }) => extractParam(text, offset));
}
const PARAM_NAME = /^([A-Za-z_$][A-Za-z0-9_$]*)/;
const EXTENDS_PREFIX = /^extends\s+/;
const OBJECT_BOUND = 'java.lang.Object';
/**
 * One declared type parameter's own name and bound, e.g. `"T extends Comparable<T> & Serializable"`
 * -> `{name: "T", bound: "Comparable<T>", boundOffset: <real offset>}` (only the *first* of several
 * `&`-joined bounds -- the one JLS erasure actually uses), `"TComment extends AbstractComment"` ->
 * `{name: "TComment", bound: "AbstractComment", ...}`, bare `"T"` -> `{name: "T", bound:
 * "java.lang.Object", boundOffset: undefined}`. `entryOffset` is `entry`'s own real offset in the
 * `sourceAfterTypeName` originally given to `extractDeclaredTypeParameters` (from
 * `extractDeclaredTypeParameters`'s own `splitWithOffsets` call); the bound's own offset within it is
 * recovered the same non-parsing way `splitWithOffsets` itself already does for a heritage argument
 * (a plain `indexOf`, safe here because `firstBound` is already known to be a real, verbatim substring
 * of `entry`, not reconstructed text) rather than threading a position through every intermediate
 * `trim`/`slice` above. Falls back to treating the whole entry as the name (with the default `Object`
 * bound) if it somehow doesn't start with an identifier at all, which shouldn't happen for
 * well-formed Java reaching this point -- same "don't guess, but don't throw either" posture as
 * `parseHeritageEntry`'s own fallback-free match.
 */
function extractParam(entry, entryOffset) {
    const trimmed = entry.trim();
    const match = PARAM_NAME.exec(trimmed);
    const name = match ? match[1] : trimmed;
    const rest = trimmed.slice(name.length).trim();
    if (!EXTENDS_PREFIX.test(rest)) {
        return { name, bound: OBJECT_BOUND, boundOffset: undefined };
    }
    const firstBound = rest.replace(EXTENDS_PREFIX, '').split('&')[0].trim();
    if (!firstBound) {
        return { name, bound: OBJECT_BOUND, boundOffset: undefined };
    }
    const boundOffset = entryOffset + entry.indexOf(firstBound, entry.indexOf(name) + name.length);
    return { name, bound: firstBound, boundOffset };
}
// `d` flag for indexed capture groups (`match.indices`) -- same technique `tldParsing.ts`'s own
// `TAG_CLASS_INDEXED`/`FUNCTION_CLASS_INDEXED` already use -- so group 2's own span within `entry` is
// available directly, with no separate re-scan needed to locate where the type-argument list starts.
const HERITAGE_ENTRY = /^([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*)\s*(<[\s\S]*>)?\s*$/d;
/**
 * Parses one top-level (already comma-split) heritage-clause entry, e.g.
 * `"AbstractCQBPaginator<Person, Person, Person>"` or a package-qualified/raw reference like
 * `"com.example.Bar"`, given `entryOffset` -- that entry's own offset in the `sourceAfterTypeName`
 * originally given to `extractHeritageTypeArguments` (from `collectHeritageEntries`'s own
 * `splitWithOffsets` call) -- so each of its own type arguments can carry a real offset too, not just
 * text (see `HeritageTypeArgument`'s own doc for why). `undefined` -- not a `HeritageEntry` at all,
 * abstain -- when `entry` doesn't even start with a legal identifier, which shouldn't happen for
 * well-formed Java reaching this point but is exactly the kind of "shouldn't happen" this file treats
 * as "don't guess" rather than "assume anyway", same rule as everywhere else in this extension.
 */
function parseHeritageEntry(entry, entryOffset) {
    const match = HERITAGE_ENTRY.exec(entry);
    if (!match) {
        return undefined;
    }
    const qualifiedName = match[1];
    const simpleName = qualifiedName.slice(qualifiedName.lastIndexOf('.') + 1);
    const typeArgsText = match[2];
    if (!typeArgsText) {
        return { simpleName, typeArgs: undefined };
    }
    const typeArgsStart = match.indices[2][0];
    // +1 skips the type-argument list's own leading `<`, landing on its inner content's first character.
    const typeArgs = splitWithOffsets(typeArgsText.slice(1, -1), entryOffset + typeArgsStart + 1);
    return { simpleName, typeArgs };
}
const IDENTIFIER_CHAR = /[A-Za-z0-9_$]/;
function isIdentifierChar(ch) {
    return ch !== undefined && IDENTIFIER_CHAR.test(ch);
}
const HERITAGE_KEYWORDS = ['extends', 'implements', 'permits'];
function matchKeywordAt(text, i) {
    for (const keyword of HERITAGE_KEYWORDS) {
        if (text.startsWith(keyword, i) && !isIdentifierChar(text[i - 1]) && !isIdentifierChar(text[i + keyword.length])) {
            return keyword;
        }
    }
    return undefined;
}
/**
 * If `text[i]` starts a string/char literal, a `"""`-delimited text block, or a line/block comment,
 * returns the index right after it ends -- `undefined` if `text[i]` isn't the start of any of those,
 * meaning the caller should handle `text[i]` itself. The one shared "these are invisible to real code
 * structure" primitive every character-by-character scan in this file needs -- previously duplicated,
 * verbatim, between `findHeritageBoundaries`'s own loop and (before this) nowhere else; kept as its own
 * function now specifically so `findLeadingTypeParameterListEnd` (below) doesn't need a second copy to
 * support `extractMethodTypeParameters`'s own scan.
 */
function skipStringOrComment(text, i) {
    // Must be checked before the single/double-quote case below -- `"""` starts with `"` too, and a
    // triple-quoted text block can itself legally contain unescaped `"` runs shorter than three, which
    // the single-quote handler's own escape-aware scan isn't looking for.
    if (text.startsWith('"""', i)) {
        const end = text.indexOf('"""', i + 3);
        return end === -1 ? text.length : end + 3;
    }
    const ch = text[i];
    if (ch === '"' || ch === "'") {
        const quote = ch;
        let j = i + 1;
        while (j < text.length && text[j] !== quote) {
            j += text[j] === '\\' ? 2 : 1;
        }
        return j + 1;
    }
    if (ch === '/' && text[i + 1] === '/') {
        const newline = text.indexOf('\n', i);
        return newline === -1 ? text.length : newline + 1;
    }
    if (ch === '/' && text[i + 1] === '*') {
        const end = text.indexOf('*/', i + 2);
        return end === -1 ? text.length : end + 2;
    }
    return undefined;
}
/**
 * If `text` starts with a `<...>` type-parameter list (`text[0] === '<'`), returns the index right
 * after its own closing `>` -- `undefined` otherwise. Shared by `findHeritageBoundaries` (a type's own
 * leading list, e.g. `class Foo<T extends Comparable<T>> extends ...`) and `extractMethodTypeParameters`
 * (a generic method's own leading list, e.g. `<P extends X> P getFoo()`) -- both need the exact same
 * depth-aware skip (a nested `<...>` inside a bound; an annotated type parameter's own `(...)`/string/
 * comment, e.g. `<@Ann("<<<") P>`) to find where their own list actually ends, as opposed to where the
 * first lexically-nested `>` happens to be.
 */
function findLeadingTypeParameterListEnd(text) {
    if (text[0] !== '<') {
        return undefined;
    }
    let angleDepth = 0;
    let parenDepth = 0;
    let i = 0;
    while (i < text.length) {
        const skip = skipStringOrComment(text, i);
        if (skip !== undefined) {
            i = skip;
            continue;
        }
        const ch = text[i];
        if (parenDepth === 0 && ch === '<') {
            angleDepth++;
            i++;
            continue;
        }
        if (parenDepth === 0 && ch === '>' && angleDepth > 0) {
            angleDepth--;
            i++;
            if (angleDepth === 0) {
                return i;
            }
            continue;
        }
        if (angleDepth === 0 && ch === '(') {
            parenDepth++;
            i++;
            continue;
        }
        if (angleDepth === 0 && ch === ')' && parenDepth > 0) {
            parenDepth--;
            i++;
            continue;
        }
        i++;
    }
    return undefined;
}
/**
 * Single forward scan of `text` (a type declaration's own source, starting immediately after its own
 * name) that finds the depth-0 positions of its `extends`/`implements`/`permits` clauses and its
 * body's opening `{`, treating three things as "invisible" to depth/keyword detection so a false
 * match inside any of them can't happen:
 *  - A `<...>` span (the type's own type-parameter list, e.g. `<T extends Comparable<T>>` -- note the
 *    real heritage `extends` only ever appears *after* this whole span closes, so gating keyword
 *    matches on `angleDepth === 0` is what keeps that bound's own "extends" from being mistaken for
 *    the type's real superclass clause) and any nested `<...>` inside one of the heritage clauses
 *    themselves (e.g. `implements Comparable<? extends Foo>`). The leading one, if any, is consumed
 *    up front by `findLeadingTypeParameterListEnd` rather than tracked inline here -- this loop starts
 *    scanning right after it, with a fresh depth of 0, so it never needs to distinguish "the very first
 *    `<...>`" from any later one the way a single combined pass would.
 *  - A `(...)` span (an annotation's own arguments, e.g. `@SuppressWarnings("x")` -- gated on
 *    `parenDepth === 0` the same way, and gating angle-bracket tracking on `parenDepth === 0` too, so
 *    a stray `<`/`>` inside a (highly unusual, but legal) annotation constant expression can't misalign
 *    the depth count either).
 *  - A string/char literal, a `"""`-delimited text block, or a line/block comment (`skipStringOrComment`),
 *    so any of the three keywords or a `{` appearing inside one (a doc comment, an annotation's string
 *    or text-block value) is never mistaken for a real one.
 *
 * Returns `undefined` if the scan never finds a depth-0 `{` at all -- `text` isn't shaped like a real
 * type declaration's own source (or the input is malformed some other way this function doesn't
 * recognize), so nothing else it found along the way is trustworthy either.
 */
function findHeritageBoundaries(text) {
    const ownTypeParamsEnd = findLeadingTypeParameterListEnd(text);
    let angleDepth = 0;
    let parenDepth = 0;
    let extendsAt;
    let implementsAt;
    let permitsAt;
    let i = ownTypeParamsEnd ?? 0;
    while (i < text.length) {
        const skip = skipStringOrComment(text, i);
        if (skip !== undefined) {
            i = skip;
            continue;
        }
        const ch = text[i];
        if (angleDepth === 0 && parenDepth === 0 && ch === '{') {
            return { extendsAt, implementsAt, permitsAt, bodyStart: i, ownTypeParamsEnd };
        }
        if (parenDepth === 0 && ch === '<') {
            angleDepth++;
            i++;
            continue;
        }
        if (parenDepth === 0 && ch === '>' && angleDepth > 0) {
            angleDepth--;
            i++;
            continue;
        }
        if (angleDepth === 0 && ch === '(') {
            parenDepth++;
            i++;
            continue;
        }
        if (angleDepth === 0 && ch === ')' && parenDepth > 0) {
            parenDepth--;
            i++;
            continue;
        }
        if (angleDepth === 0 && parenDepth === 0) {
            const keyword = matchKeywordAt(text, i);
            if (keyword) {
                if (keyword === 'extends' && extendsAt === undefined) {
                    extendsAt = i;
                }
                else if (keyword === 'implements' && implementsAt === undefined) {
                    implementsAt = i;
                }
                else if (keyword === 'permits' && permitsAt === undefined) {
                    permitsAt = i;
                }
                i += keyword.length;
                continue;
            }
        }
        i++;
    }
    return undefined;
}
/**
 * A generic method's (or constructor's) own leading type-parameter list, e.g. `<P extends
 * IFilterableFilmPaginator<T> & IPaginatorUnfilteredProgress> P getFoo()` -> `[{name: "P", bound:
 * "IFilterableFilmPaginator<T>", ...}]` (JLS 4.6 erasure, same rule as `extractDeclaredTypeParameters`:
 * only the first of several `&`-joined bounds) -- the *method*-scoped counterpart to that function's
 * *type*-scoped one, reusing the exact same `extractParam`/bound-parsing it does rather than a second
 * copy, since a method-level type parameter's own name+bound is written in exactly the same shape a
 * class-level one is. This is the other (and, per JLS's own grammar, only other) place a type variable
 * can be declared at all -- a class/interface/record/enum's own leading list is the one
 * `extractDeclaredTypeParameters` already covers.
 *
 * `signaturePrefix` is the raw text preceding a member's own return type in source (the same span
 * `extractMemberReturnType`, javaSymbols.ts, already isolates there) -- e.g. `"<P extends ... > "`, or
 * `"public static <P extends ...> "` when preceded by modifiers/annotations, or simply `""`/whitespace
 * for an ordinary, non-generic method. Finds the type-parameter list by searching for a top-level `<`
 * whose own matching `>` (via `findLeadingTypeParameterListEnd`) reaches exactly the end of
 * `signaturePrefix` (trimmed of trailing whitespace) -- true only for the method's own list, since
 * nothing else in a method's modifiers/annotations is `<...>`-shaped and required to end there. Returns
 * `[]` -- not a generic method, nothing to substitute -- whenever no such list is found.
 */
function extractMethodTypeParameters(signaturePrefix) {
    const trimmedEnd = signaturePrefix.replace(/\s+$/, '');
    if (!trimmedEnd.endsWith('>')) {
        return [];
    }
    for (let start = trimmedEnd.indexOf('<'); start !== -1; start = trimmedEnd.indexOf('<', start + 1)) {
        const end = findLeadingTypeParameterListEnd(trimmedEnd.slice(start));
        if (end === undefined || start + end !== trimmedEnd.length) {
            continue;
        }
        const paramsText = trimmedEnd.slice(start + 1, start + end - 1);
        return splitWithOffsets(paramsText, start + 1).map(({ text, offset }) => extractParam(text, offset));
    }
    return [];
}
//# sourceMappingURL=javaHeritageClause.js.map