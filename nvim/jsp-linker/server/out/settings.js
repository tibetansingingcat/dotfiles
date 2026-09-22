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
exports.EXCLUDE_SETTING = exports.EL_UNKNOWN_VARIABLE_WARNING_ENABLED_SETTING = exports.BEAN_PROPERTY_VALIDATION_ENABLED_SETTING = void 0;
exports.getExcludeGlob = getExcludeGlob;
exports.isExcluded = isExcluded;
exports.excludeAware = excludeAware;
const vscode = __importStar(require("vscode"));
// This extension's own configuration keys that more than one file needs to read or reference --
// declared once here rather than as independent literal copies in each consumer. Exactly the
// same risk class as diagnostic `.source`/collection-name duplication (see diagnostics.ts's own
// comment): a setting key typed out separately in several files can't be kept in sync by the
// compiler, only by every future edit remembering to touch all of them.
/**
 * Governs three related, jdtls-dependent, same-confidence-tier checks: `SetPropertyDiagnostics`,
 * `TagFieldDiagnostics`, and `ElDiagnostics`'s chain tier -- see each one's own doc comment for
 * why they share this one opt-out rather than each getting its own setting. Also read directly by
 * `extension.ts` to refresh all three immediately on toggle.
 */
exports.BEAN_PROPERTY_VALIDATION_ENABLED_SETTING = 'vscode-jsp-linker.beanPropertyValidation.enabled';
/**
 * Governs `ElDiagnostics`'s unknown-variable tier -- its own opt-out, a different (purely
 * syntactic, never touches jdtls) confidence tier from the setting above. Also read directly by
 * `extension.ts` to refresh it immediately on toggle.
 */
exports.EL_UNKNOWN_VARIABLE_WARNING_ENABLED_SETTING = 'vscode-jsp-linker.elUnknownVariableWarning.enabled';
/**
 * Additional exclude globs, on top of the built-in defaults below -- read by `checkAllCommand.ts`
 * for its workspace-wide scan and by `extension.ts` to gate live per-document validation, so a path
 * excluded here is skipped by both rather than just the bulk "Check All Files" run. Empty by
 * default: the extension itself doesn't assume any particular repo layout beyond the two defaults,
 * which apply to any consumer of this extension regardless of repo; a workspace's own
 * `.vscode/settings.json` configures anything further specific to its own layout (e.g. a directory
 * of non-live/reference JSPs that don't reflect the real webapp).
 */
exports.EXCLUDE_SETTING = 'vscode-jsp-linker.exclude';
// `target/**`: Maven build output, not source. `.claude/**`: a full duplicate checkout an
// Agent-tool worktree lives in, gitignored but very much on disk -- passing an explicit exclude to
// `findFiles` overrides VS Code's default .gitignore-respecting excludes entirely (they only apply
// when no exclude is given), so this has to be listed explicitly or its .jsp/.tag/.tld files get
// double-counted and checked against whatever (possibly stale) state that worktree is in.
const DEFAULT_EXCLUDE_GLOBS = ['**/target/**', '**/.claude/**'];
function getExcludeGlobs() {
    const configured = vscode.workspace
        .getConfiguration()
        .get(exports.EXCLUDE_SETTING, []);
    return [...DEFAULT_EXCLUDE_GLOBS, ...configured];
}
/**
 * Builds the brace-glob `findFiles` exclude pattern from `DEFAULT_EXCLUDE_GLOBS` plus whatever
 * `EXCLUDE_SETTING` adds -- the single place this is assembled, rather than each scan entry point
 * (currently just `checkAllCommand.ts`) hardcoding its own copy of the defaults.
 */
function getExcludeGlob() {
    return `{${getExcludeGlobs().join(',')}}`;
}
/**
 * Converts one of `getExcludeGlobs()`'s entries to a `RegExp` tested against a workspace-relative
 * path. Only supports the `**`/`*` subset those entries ever use -- no brace groups, character
 * classes, or `?` -- since `findFiles` (via `getExcludeGlob()`'s brace-joined string) already
 * handles the bulk-scan case; this exists only for `isExcluded()`, which has no `findFiles`-style
 * API to delegate to for the live per-document gate.
 */
function globToRegExp(glob) {
    // A single combined-alternation replace, not three chained ones: chaining separate `**/`, `**`,
    // then `*` replacements re-scans each earlier substitution's own output for the next pattern --
    // `**/` becomes `(?:.*/)?`, whose `*` a later `.replace(/\*/g, ...)` then matches *again*,
    // corrupting it into `(?:.[^/]*/)?`. One pass over the original string can't do that.
    const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const pattern = escaped.replace(/\*\*\/|\*\*|\*/g, (match) => {
        if (match === '**/') {
            return '(?:.*/)?';
        }
        if (match === '**') {
            return '.*';
        }
        return '[^/]*';
    });
    return new RegExp(`^${pattern}$`);
}
/**
 * Whether a document's path matches any of `getExcludeGlobs()` -- used by `extension.ts` to gate
 * live validation the same way `checkAllCommand.ts` gates its bulk scan via `getExcludeGlob()`.
 */
function isExcluded(uri) {
    const relativePath = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
    return getExcludeGlobs().some((glob) => globToRegExp(glob).test(relativePath));
}
/**
 * Wraps one `vscode.languages.register*Provider` method (definition/hover/completion/codeLens --
 * anything whose first parameter is the document being asked about) so it's a no-op for an
 * excluded document. This is the single choke point every provider registration in extension.ts
 * routes through for this concern, rather than each of this extension's provider classes carrying
 * its own `isExcluded` check -- the diagnostics side of this same concern is centralized the same
 * way, through `matchesJspSelector`/`matchesTldSelector` gating every `validate()` call site.
 */
function excludeAware(fn, whenExcluded) {
    return (document, ...rest) => isExcluded(document.uri) ? whenExcluded : fn(document, ...rest);
}
//# sourceMappingURL=settings.js.map