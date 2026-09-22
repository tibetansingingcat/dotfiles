"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VariableTypeTimeline = void 0;
exports.recordHistory = recordHistory;
/**
 * A JSP variable's "type" isn't one fact about its name for the whole document -- it's a plain,
 * mutable page-scoped slot, exactly like at runtime: `<sm:set var="_viewings" .../>` really does
 * overwrite whatever `_viewings` meant before, for every use of that name *after* this point, not
 * for the whole file. A single flat `Map<string,string>` (this extension's previous shape) can't
 * represent that -- it holds exactly one type per name, so two independent, unrelated
 * `<sm:set var="_viewings" .../>`s in the same document (an ordinary pattern in real JSPs, not an
 * edge case -- e.g. one file's own `_viewings`, rebound once from an unrelated bean property and
 * again, unrelatedly, from a paginator's `page` field) collapse into whichever rebind happened to be
 * processed last, and every earlier use of that name anywhere in the document -- hover, "go to
 * definition", every diagnostic -- got validated against that wrong, later type instead of the one
 * actually in effect at its own position. This keeps each name's own history of `(offset, type)`
 * events in source order instead, so `at`/`asOf` answer "what was this name bound to as of this
 * specific point in the document", not "what does it end up as by the end of it".
 */
class VariableTypeTimeline {
    history;
    constructor(history) {
        this.history = history;
    }
    /**
     * The type bound to `name` by the last event at or before `offset` -- `undefined` if `name` was
     * never bound by that point, or was explicitly rebound to something unresolved by then (a real,
     * later "no", not "never asked" -- see `recordHistory`'s own doc on why a rebind-to-unresolved must
     * still override an earlier binding rather than let it leak forward). Events for one name are
     * always in ascending-offset order (`variableTypes.ts` appends them in the same source-order walk
     * it already does), so a plain forward scan is enough -- these lists are always small (one entry
     * per rebind of that one name across the whole document), never worth a binary search over.
     */
    at(name, offset) {
        const events = this.history.get(name);
        if (!events) {
            return undefined;
        }
        let result;
        for (const event of events) {
            if (event.offset > offset) {
                break;
            }
            result = event.type;
        }
        return result;
    }
    /**
     * A `KnownVariableTypes` view fixed at one document position -- for `resolveChainType`/
     * `resolveChainHop`/`resolveChainSegment`/`inferArgumentType` and friends (`javaSymbols.ts`), which
     * only ever want a plain `.get(name)` with no notion of position of their own. The caller here
     * (which does know where the chain/tag-usage/hover actually sits -- a chain's own base segment, a
     * tag usage's own offset, the hovered token's own offset) fixes that position once, rather than
     * threading an offset through every one of those functions' own signatures.
     */
    asOf(offset) {
        return { get: (name) => this.at(name, offset) };
    }
}
exports.VariableTypeTimeline = VariableTypeTimeline;
/**
 * Appends one `(offset, type)` event to `name`'s own history in `history`, creating that name's
 * entry if this is its first. `type: undefined` records a real rebind-to-unresolved (a tag usage that
 * rebound `name` but to nothing this extension could resolve) -- distinct from `name` never having
 * appeared in `history` at all -- so `VariableTypeTimeline.at` correctly stops treating an *earlier*
 * binding as still in effect the moment a later event, resolved or not, supersedes it.
 */
function recordHistory(history, name, offset, type) {
    const events = history.get(name);
    if (events) {
        events.push({ offset, type });
    }
    else {
        history.set(name, [{ offset, type }]);
    }
}
//# sourceMappingURL=variableTypeTimeline.js.map