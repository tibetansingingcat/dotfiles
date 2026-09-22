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
exports.javaExtensionGateway = exports.JDTLS_CONSERVATIVE_CONCURRENCY = exports.WORKSPACE_SYMBOL_COMMAND = void 0;
exports.moduleRootFromUri = moduleRootFromUri;
const vscode = __importStar(require("vscode"));
/**
 * jdtls's own `vscode.executeWorkspaceSymbolProvider` handler
 * (`WorkspaceSymbolHandler.search` -> `SearchEngine.searchAllTypeNames`) runs on a shared
 * ForkJoinPool with a fixed worker-thread limit. Enough of these in flight at once -- routine when
 * several open documents each resolve several class references concurrently, with nothing
 * coordinating between them -- exhausts it: jdtls's own log shows
 * `RejectedExecutionException: Thread limit exceeded replacing blocked worker` thrown from inside
 * that search, for ordinary/valid classes (`java.lang.Boolean`, `java.lang.String`, project types
 * alike) in bursts of ~90-99 within a single second. The failed search comes back empty, which
 * `resolveClass` (javaSymbols.ts) can't tell apart from the class genuinely not existing -- hence
 * warnings flickering for classes that are obviously fine. `JavaExtensionGateway.execute` below
 * throttles calls to exactly this command; every other jdtls command this extension makes isn't
 * implicated by that log and is deliberately left unthrottled.
 */
exports.WORKSPACE_SYMBOL_COMMAND = 'vscode.executeWorkspaceSymbolProvider';
/**
 * Normalizes a jdtls-supplied project-root URI (from `onDidClasspathUpdate`, `onDidProjectsImport`,
 * or `java.project.getAll`, the three places a `vscode.Uri`/URI string naming a project root
 * crosses from jdtls into this extension) to the same trailing-slash-free shape
 * `moduleRootOf`/`webAppRootOf` (webAppPaths.ts) compute from a file path by string-slicing.
 * jdtls's own project-root URIs come back *with* a trailing slash (e.g. ".../web/"); nothing
 * stripped it before this existed, so `getKnownProjectRoots`'s cached Set never actually matched
 * `getRuntimeClasspathJars`'s slash-free lookup key for *any* module -- not a "hasn't settled yet"
 * timing gap (the two-step diagnosis this file's own history briefly chased), just two shapes of
 * the same path that could never compare equal, confirmed by logging both sides for `web`'s own
 * project root and finding the mismatch directly. One shared conversion point here, rather than
 * `onClasspathUpdate`/`onProjectsImported` below and `classpathResources.ts`'s
 * `getKnownProjectRoots` each doing their own `.fsPath` read and hoping the other side's shape
 * happened to match.
 */
function moduleRootFromUri(uri) {
    return uri.fsPath.replace(/[/\\]+$/, '');
}
/**
 * How many of the commands above (and checkAllCommand.ts's own file-processing batches, which hit
 * the exact same jdtls bottleneck one caller further out) run concurrently. One shared, named
 * constant rather than each caller picking its own "seems reasonable" number for what is, in both
 * cases, the same underlying "don't saturate jdtls" concern.
 */
exports.JDTLS_CONSERVATIVE_CONCURRENCY = 8;
// A real jdtls-health problem shouldn't announce itself only once per restart of the extension --
// but it also shouldn't pop a warning for every one of a burst of dozens of failures a second.
const FAILURE_WARNING_THRESHOLD = 5;
const FAILURE_WARNING_COOLDOWN_MS = 5 * 60 * 1000;
/**
 * The single point every call this extension makes into the Java language server (redhat.java /
 * jdtls) goes through -- both its readiness state (moved here from javaSymbols.ts, where it used to
 * live as free functions/module state alongside everything else) and the actual
 * `vscode.commands.executeCommand` calls themselves (moved here from their 12 previous call sites
 * scattered across javaSymbols.ts and classpathResources.ts).
 *
 * Centralizing the calls, not just the readiness state, is what makes two things possible that
 * couldn't be done consistently before: throttling `WORKSPACE_SYMBOL_COMMAND` specifically (see its
 * own comment) without every caller needing to know that's necessary, and guaranteeing every jdtls
 * call failure -- a thrown error, not just an empty/`undefined` result -- degrades to this file's
 * `undefined`/abstain contract exactly once, here, rather than depending on each of `resolveClass`'s
 * several direct callers remembering their own try/catch (only `resolveClasses`, plural, used to).
 * A failure is never silently dropped: it's always logged to `output` with enough context to
 * diagnose (command, args, timestamp, the error itself), and a run of several in a row -- a real
 * sign jdtls itself is unhealthy, not one bad request -- surfaces once as a visible warning instead
 * of as N flickering diagnostics with no explanation anywhere.
 */
class JavaExtensionGateway {
    ready = false;
    output;
    // One throttle state per distinct jdtls-touching operation -- `runThrottled` caps each
    // independently at `JDTLS_CONSERVATIVE_CONCURRENCY`, same reasoning `checkAllCommand.ts`'s own
    // independent counter already documents for that same constant: this is the one bottleneck, but
    // each kind of call gets its own queue rather than competing with the others for the same slots.
    workspaceSymbolThrottle = { active: 0, queue: [] };
    documentOpenThrottle = { active: 0, queue: [] };
    consecutiveFailures = 0;
    lastFailureWarningAt = 0;
    /** Called once, at the start of `activate()`, before anything else can report a failure. */
    setOutputChannel(output) {
        this.output = output;
    }
    isExtensionActive() {
        return vscode.extensions.getExtension('redhat.java') !== undefined;
    }
    /**
     * Whether jdtls has finished its initial project import/build. Before this,
     * `vscode.executeWorkspaceSymbolProvider` can spuriously come back empty for classes that
     * genuinely exist -- project types, library types, and JDK types alike -- because the workspace
     * symbol index it searches hasn't been built yet. `resolveClass`'s "not found" only means
     * "doesn't exist" once this is true; before that it just means "can't tell yet". This is a
     * one-shot latch (never flips back to `false`) covering only that initial startup window -- a
     * later, mid-session jdtls hiccup is what `execute`'s own failure handling below is for.
     */
    isReady() {
        return this.ready;
    }
    /**
     * Calls `onReady` once jdtls signals (via the Java extension's own `serverReady()` promise) that
     * its initial indexing has finished, so any class-reference diagnostics reported while it was
     * still starting can be re-validated. A no-op if the extension isn't active or its API doesn't
     * expose `serverReady` (an older/incompatible version).
     */
    trackReadiness(onReady) {
        const api = vscode.extensions.getExtension('redhat.java')?.exports;
        if (!api?.serverReady) {
            return;
        }
        api.serverReady().then(() => {
            this.ready = true;
            onReady();
        });
    }
    /**
     * Calls `onUpdate` with a project's root filesystem path whenever jdtls fires
     * `onDidClasspathUpdate` for it -- e.g. after a `pom.xml` dependency change gets reimported.
     * Unlike the initial-readiness case above, this can fire repeatedly over a session, so callers
     * should treat each firing as "this module's classpath may have changed" rather than a one-time
     * signal. A no-op if the extension isn't active or its API doesn't expose the event.
     */
    onClasspathUpdate(onUpdate) {
        const api = vscode.extensions.getExtension('redhat.java')?.exports;
        api?.onDidClasspathUpdate?.((uri) => onUpdate(moduleRootFromUri(uri)));
    }
    /**
     * Calls `onImport` with each project root's filesystem path whenever jdtls fires
     * `onDidProjectsImport` for it -- a genuine server-side signal (`EventType.projectsImported`) sent
     * when a project's import (re)finishes, e.g. a workspace reload or a `pom.xml` structural change,
     * distinct from `onClasspathUpdate` above (a dependency-only change within an already-imported
     * project). Same shape and same "can fire repeatedly, treat each firing as new information"
     * contract as `onClasspathUpdate`. A no-op if the extension isn't active or its API doesn't
     * expose the event (an older/incompatible version).
     */
    onProjectsImported(onImport) {
        const api = vscode.extensions.getExtension('redhat.java')?.exports;
        api?.onDidProjectsImport?.((uris) => uris.forEach((uri) => onImport(moduleRootFromUri(uri))));
    }
    /**
     * Runs one jdtls command. Every caller gets the same contract: a thrown error, an empty result,
     * or (for `WORKSPACE_SYMBOL_COMMAND`) a queued wait for a free slot are all handled here, never
     * left for the caller to reinvent. A failure returns `undefined` -- this file's own "abstain
     * rather than guess wrong" rule -- after logging it; it never throws.
     */
    async execute(command, ...args) {
        try {
            const result = await (command === exports.WORKSPACE_SYMBOL_COMMAND
                ? this.runThrottled(this.workspaceSymbolThrottle, () => vscode.commands.executeCommand(command, ...args))
                : vscode.commands.executeCommand(command, ...args));
            this.consecutiveFailures = 0;
            return result;
        }
        catch (error) {
            this.reportFailure(command, args, error);
            return undefined;
        }
    }
    /**
     * Opens `uri` as a real `vscode.TextDocument` -- needed before `vscode.executeDocumentSymbolProvider`
     * can return anything for it. A never-opened document has no model for jdtls to symbolize yet;
     * for a `jdt://` target specifically (a decompiled JDK/library class, no project source of its
     * own), redhat.java's own content provider also has to materialize/decompile it first, which is
     * real, non-trivial work. Throttled the same way `WORKSPACE_SYMBOL_COMMAND` already is -- a burst
     * of first-time opens across many distinct classes at once (routine during "Check All Files") hits
     * the exact same jdtls bottleneck `JDTLS_CONSERVATIVE_CONCURRENCY`'s own doc describes.
     *
     * Deliberately uncached: `vscode.workspace.openTextDocument` already returns early for a URI
     * that's still open, and that's the one source of truth for whether a document is actually live --
     * a document's lifecycle is owned by the editor, not by this extension, and it can be evicted at
     * any point with no signal back here. A cache of our own that remembered "already opened" forever
     * would drift out of sync with that eviction and silently stop retrying, indistinguishable from a
     * confident "not found" -- exactly the class of silent failure this file's own `execute` contract
     * exists to avoid.
     */
    async openDocument(uri) {
        try {
            return await this.runThrottled(this.documentOpenThrottle, () => vscode.workspace.openTextDocument(uri));
        }
        catch (error) {
            this.reportFailure('vscode.workspace.openTextDocument', [uri.toString()], error);
            return undefined;
        }
    }
    async runThrottled(state, fn) {
        if (state.active >= exports.JDTLS_CONSERVATIVE_CONCURRENCY) {
            await new Promise((resolve) => state.queue.push(resolve));
        }
        state.active++;
        try {
            return await fn();
        }
        finally {
            state.active--;
            state.queue.shift()?.();
        }
    }
    reportFailure(command, args, error) {
        this.consecutiveFailures++;
        const message = `[${new Date().toISOString()}] ${command}(${args.map((arg) => JSON.stringify(arg)).join(', ')}) failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`;
        if (this.output) {
            this.output.appendLine(message);
        }
        else {
            // Only possible before `setOutputChannel` runs at the very start of `activate()` -- keep
            // this failure visible somewhere rather than dropping it silently in that narrow window.
            console.error(`[vscode-jsp-linker] ${message}`);
        }
        const now = Date.now();
        if (this.consecutiveFailures >= FAILURE_WARNING_THRESHOLD && now - this.lastFailureWarningAt >= FAILURE_WARNING_COOLDOWN_MS) {
            this.lastFailureWarningAt = now;
            vscode.window.showWarningMessage('Letterboxd JSP-Java Linker: repeated failures talking to the Java language server -- some class-reference warnings may be inaccurate. See the "Letterboxd JSP Linker" output channel for details.');
        }
    }
}
exports.javaExtensionGateway = new JavaExtensionGateway();
//# sourceMappingURL=javaExtensionGateway.js.map