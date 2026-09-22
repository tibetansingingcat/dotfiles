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
exports.LinkDiagnostics = exports.LINK_SOURCE = void 0;
const vscode = __importStar(require("vscode"));
const webAppPaths_1 = require("./webAppPaths");
const diagnostics_1 = require("./diagnostics");
const javaSymbols_1 = require("./javaSymbols");
const elScan_1 = require("./elScan");
const jspScan_1 = require("./jspScan");
// The one place this diagnostic collection's name is spelled out -- reused
// below for both the collection itself and every diagnostic's `.source`, and
// exported so checkAllCommand.ts's DIAGNOSTIC_SOURCES can reference it too,
// rather than checkAllCommand.ts, the collection, and every diagnostic each
// carrying their own independent copy of the same literal (exactly the
// pattern that let TldDiagnostics's diagnostics silently carry the wrong
// `.source` for as long as they did).
exports.LINK_SOURCE = 'jsp-broken-links';
function diagnostic(document, range, message, severity) {
    return (0, diagnostics_1.createDiagnostic)(document, range, message, severity, exports.LINK_SOURCE);
}
/**
 * Flags links this extension would otherwise silently fail to navigate.
 * Severity reflects how confident each check can actually be:
 *  - File-relative includes, EL functions, and uri-bound custom tag *names*
 *    (`<tag>`/`<tag-file>` entries) in a taglib we've indexed from a
 *    workspace .tld are fully deterministic (a sibling file, a function
 *    name, or a tag name, either exists or it doesn't) -- reported as errors.
 *  - An EL function call whose prefix isn't bound by any `<%@ taglib %>`
 *    directive anywhere in scope (the document itself, or any fragment
 *    reached through its `<%@include%>` chain -- see `TldIndex.resolvePrefix`)
 *    is the same kind of deterministic typo, *unless* it's declared in
 *    `vscode-jsp-linker.compilerRecognizedElFunctions` -- a call some
 *    external tool (e.g. a patched JSP compiler) resolves outside the
 *    taglib mechanism entirely, so no directive will ever exist for it. See
 *    `TldIndex.checkFunctionCall`.
 *  - Webapp-root-relative includes and tagdir-backed tag files are reported
 *    as warnings: a dependency's WAR overlay (e.g. Supermodel ships shared
 *    admin fragments/tags this way) can supply them without the file ever
 *    existing in this workspace, so "not found locally" isn't proof of a typo.
 *  - Java class references are also warnings, since resolution is delegated
 *    to the Java extension, which may simply not have finished indexing yet.
 *    Skipped entirely when that extension isn't active.
 *  - A uri-bound taglib whose TLD couldn't be indexed at all (workspace or classpath jar --
 *    typically a jar-shipped TLD gated on the Java extension's initial project import, e.g.
 *    Supermodel's `sm:`) is deliberately silent too, for the same reason as Java class references
 *    just above: `checkTagUsage`/`checkFunctionCall`'s own `'unresolved-taglib'` case can't tell
 *    "still indexing" from "a real, lasting gap", so it abstains rather than guess wrong, and relies
 *    on `javaExtensionGateway.trackReadiness(validateAllOpen)` (extension.ts) to redo this pass once
 *    the classpath genuinely has settled -- see `classpathResources.ts`'s own caching fix for why
 *    that settling can be trusted to actually happen once, not just eventually.
 */
class LinkDiagnostics {
    tldIndex;
    collection = vscode.languages.createDiagnosticCollection(exports.LINK_SOURCE);
    constructor(tldIndex) {
        this.tldIndex = tldIndex;
    }
    dispose() {
        this.collection.dispose();
    }
    async validate(document) {
        const text = (0, jspScan_1.maskJspComments)(document.getText());
        const diagnostics = [];
        // allSettled, not all: a failure in one check (e.g. checkClassReferences
        // hitting the Java extension before its language server has finished
        // starting) must not discard diagnostics the other, independent checks
        // already found.
        const results = await Promise.allSettled([
            this.checkIncludePaths(document, text, diagnostics),
            this.checkCustomTags(document, text, diagnostics),
            this.checkElFunctionCalls(document, text, diagnostics),
            this.checkClassReferences(document, text, diagnostics),
        ]);
        for (const result of results) {
            if (result.status === 'rejected') {
                console.error('[vscode-jsp-linker] link diagnostic check failed:', result.reason);
            }
        }
        this.collection.set(document.uri, diagnostics);
    }
    async checkIncludePaths(document, text, diagnostics) {
        for (const usage of (0, jspScan_1.findAllIncludePaths)(text)) {
            const location = await (0, webAppPaths_1.resolveIncludePath)(document.uri, usage.path);
            if (location) {
                continue;
            }
            // A webapp-root-relative path (leading "/") can legitimately be
            // supplied at build time by a WAR overlay from a dependency jar (e.g.
            // Supermodel ships shared admin fragments this way) rather than
            // existing as a file in this workspace -- "not found locally" isn't
            // proof of a typo the way it is for a file-relative include, which is
            // always a sibling of the including file itself.
            const severity = usage.path.startsWith('/') ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error;
            const hint = severity === vscode.DiagnosticSeverity.Warning ? ' (may be supplied by a dependency\'s WAR overlay)' : '';
            diagnostics.push(diagnostic(document, usage.range, `Cannot find included file "${usage.path}"${hint}.`, severity));
        }
    }
    async checkCustomTags(document, text, diagnostics) {
        for (const usage of (0, jspScan_1.findCustomTagUsages)(text)) {
            const tagFilePath = await this.tldIndex.resolveTagFile(text, document.uri, usage.prefix, usage.tagName);
            if (tagFilePath) {
                const location = await (0, webAppPaths_1.resolveWebAppRelativePath)(document.uri, tagFilePath);
                if (!location) {
                    // WAR-overlay caveat, same as checkIncludePaths: a tagdir is
                    // always a webapp-root-relative path, and a shared component
                    // library can supply its .tag files from a dependency jar rather
                    // than a workspace file, so this is a warning, not a hard error.
                    diagnostics.push(diagnostic(document, usage.nameRange, `Cannot find tag file "${tagFilePath}" for <${usage.prefix}:${usage.tagName}> (may be supplied by a dependency's WAR overlay).`, vscode.DiagnosticSeverity.Warning));
                }
                continue;
            }
            // Not tagdir-bound -- check the tag *name* against the uri-bound
            // taglib's <tag>/<tag-file> entries instead. Same confidence as
            // checkElFunctionCalls: once a taglib is indexed (workspace or jar),
            // its full <tag>/<tag-file> list is known, so "declares neither" is
            // just as deterministic as an unknown EL function -- an error, not a
            // WAR-overlay-style warning.
            const status = await this.tldIndex.checkTagUsage(text, document.uri, usage.prefix, usage.tagName);
            if (status === 'unknown-tag') {
                diagnostics.push(diagnostic(document, usage.nameRange, `No tag named "${usage.tagName}" in the taglib bound to prefix "${usage.prefix}".`, vscode.DiagnosticSeverity.Error));
            }
            else if (status === 'unbound-prefix') {
                // Same reasoning and severity as `checkElFunctionCalls`'s own `'unbound-prefix'` case: the
                // JSP spec requires a taglib directive to use `<prefix:tagName>` at all, so this is exactly
                // as deterministic a typo as `'unknown-tag'` above -- previously silent (see `checkTagUsage`'s
                // own doc), not a coverage gap.
                diagnostics.push(diagnostic(document, usage.nameRange, `Prefix "${usage.prefix}" isn't bound by any <%@ taglib %> directive in scope (this file or its include chain).`, vscode.DiagnosticSeverity.Error));
            }
            // `'resolved'`, `'unresolved-taglib'`, `'reserved-prefix'`, and `'xml-namespace-prefix'` are all
            // deliberately silent here -- `'unresolved-taglib'` specifically matches `checkClassReferences`'s
            // own precedent just below: don't guess wrong while the Java extension's classpath data hasn't
            // settled, and rely on `javaExtensionGateway.trackReadiness(validateAllOpen)` (extension.ts) to
            // redo this pass once it genuinely has, rather than narrating a "can't check this yet" note that
            // fires on routine, expected startup lag. The actual fix for that lag lingering *after* readiness
            // is `classpathResources.ts`'s own caching (see `memoizeUntilReady`'s and `getKnownProjectRoots`'s
            // comments) -- not a diagnostic here.
        }
    }
    async checkElFunctionCalls(document, text, diagnostics) {
        for (const usage of (0, elScan_1.findAllElFunctionCalls)(text)) {
            const status = await this.tldIndex.checkFunctionCall(text, document.uri, usage.prefix, usage.functionName);
            if (status === 'unknown-function') {
                diagnostics.push(diagnostic(document, usage.range, `No EL function named "${usage.functionName}" in the taglib bound to prefix "${usage.prefix}".`, vscode.DiagnosticSeverity.Error));
            }
            else if (status === 'unbound-prefix') {
                diagnostics.push(diagnostic(document, usage.range, `Prefix "${usage.prefix}" isn't bound by any <%@ taglib %> directive in scope (this file or its include chain), and "${usage.prefix}:${usage.functionName}" isn't declared in "vscode-jsp-linker.compilerRecognizedElFunctions" either.`, vscode.DiagnosticSeverity.Error));
            }
            // `'unresolved-taglib'` is deliberately silent here too -- see `checkCustomTags`'s own comment.
        }
    }
    async checkClassReferences(document, text, diagnostics) {
        const usages = [
            ...(0, jspScan_1.findAllUseBeanClasses)(text),
            ...(0, jspScan_1.findAllAttributeTypes)(text),
            ...(0, jspScan_1.findAllScriptletFqcns)(text),
            ...(0, jspScan_1.findAllPageImportFqcns)(text),
        ];
        // Several usages (e.g. the same FQCN repeated across scriptlets) commonly
        // share a class -- resolve each distinct FQCN once rather than once per usage.
        // resolveClasses already abstains (undefined) rather than falsely
        // reporting `false` when the language server isn't ready or active, so no
        // separate readiness check is needed here -- checking `=== false`
        // specifically (not just falsy) is what makes that abstention effective.
        const resolutions = await (0, javaSymbols_1.resolveClasses)(usages.map((usage) => usage.fqcn));
        for (const usage of usages) {
            if (resolutions.get(usage.fqcn) === false) {
                diagnostics.push(diagnostic(document, usage.range, `Cannot resolve Java class "${usage.fqcn}".`, vscode.DiagnosticSeverity.Warning));
            }
        }
    }
}
exports.LinkDiagnostics = LinkDiagnostics;
//# sourceMappingURL=linkDiagnostics.js.map