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
exports.registerCheckAllCommand = registerCheckAllCommand;
const vscode = __importStar(require("vscode"));
const directiveAttributeDiagnostics_1 = require("./directiveAttributeDiagnostics");
const elDiagnostics_1 = require("./elDiagnostics");
const javaExtensionGateway_1 = require("./javaExtensionGateway");
const linkDiagnostics_1 = require("./linkDiagnostics");
const scannerParseFailureDiagnostics_1 = require("./scannerParseFailureDiagnostics");
const setPropertyDiagnostics_1 = require("./setPropertyDiagnostics");
const settings_1 = require("./settings");
const tagAttributeDiagnostics_1 = require("./tagAttributeDiagnostics");
const tagFieldDiagnostics_1 = require("./tagFieldDiagnostics");
const tldDiagnostics_1 = require("./tldDiagnostics");
const JSP_GLOB = '**/*.{jsp,jspf,tag}';
const TLD_GLOB = '**/*.tld';
// Built from each diagnostic class's own exported source constant, rather
// than its own independent copy of the same literals -- see
// TldDiagnostics's own SOURCE comment for why that used to matter: this set
// used to list 'jsp-tld-classes' while TldDiagnostics's actual diagnostics
// carried a stale 'jsp-broken-links' copy-pasted from LinkDiagnostics, so
// this filter accepted them under the wrong label rather than catching the
// mismatch.
const DIAGNOSTIC_SOURCES = new Set([
    linkDiagnostics_1.LINK_SOURCE,
    tagAttributeDiagnostics_1.TAG_ATTRIBUTE_SOURCE,
    directiveAttributeDiagnostics_1.DIRECTIVE_ATTRIBUTE_SOURCE,
    tldDiagnostics_1.TLD_SOURCE,
    setPropertyDiagnostics_1.SET_PROPERTY_SOURCE,
    tagFieldDiagnostics_1.TAG_FIELD_SOURCE,
    elDiagnostics_1.CHAIN_SOURCE,
    elDiagnostics_1.UNKNOWN_SOURCE,
    elDiagnostics_1.SYNTAX_SOURCE,
    scannerParseFailureDiagnostics_1.SCANNER_PARSE_FAILURE_SOURCE,
]);
// jdtls handles a modest batch of concurrent workspace-symbol queries fine,
// but this isn't a server built to be saturated -- the same conservative
// concurrency javaExtensionGateway.ts's own throttle uses for that exact
// bottleneck, reused here rather than an independent "seems reasonable"
// number for what is really the same underlying concern.
const CONCURRENCY = javaExtensionGateway_1.JDTLS_CONSERVATIVE_CONCURRENCY;
/**
 * Registers "Letterboxd JSP Linker: Check All Files", which runs this
 * extension's own diagnostics across every JSP/JSPF/tag/TLD file in the
 * workspace inside the CURRENT window, reusing its already-warm jdtls index
 * and the already-constructed diagnostic instances passed in from
 * `activate()`. This replaced the old `npm run check-all` approach (a `src/test/` entry point,
 * since deleted), which launched a second full VSCode + jdtls process against the same repo --
 * that second jdtls doing a cold full Maven project import while the live window's jdtls is also
 * indexing the same project fights over the same project's build state (the same class of problem
 * CLAUDE.md warns about for concurrent CLI/IDE Maven builds), which is why it corrupted the live
 * window rather than just being slow.
 *
 * Results go to an output channel, not individual editor tabs -- opening
 * hundreds of files as visible tabs would be its own kind of mess. Each file
 * is still loaded via `openTextDocument`, which doesn't show it.
 *
 * `output` is created once in `activate()` and shared with `javaExtensionGateway` (which also logs
 * jdtls-call failures there) rather than each owning its own same-named channel -- one "Letterboxd
 * JSP Linker" entry in the Output panel, not two confusingly-similar ones.
 */
function registerCheckAllCommand(context, output, linkDiagnostics, tagAttributeDiagnostics, directiveAttributeDiagnostics, tldDiagnostics, setPropertyDiagnostics, tagFieldDiagnostics, elDiagnostics, scannerParseFailureDiagnostics) {
    context.subscriptions.push(vscode.commands.registerCommand('vscode-jsp-linker.checkAllFiles', () => runCheckAll(output, linkDiagnostics, tagAttributeDiagnostics, directiveAttributeDiagnostics, tldDiagnostics, setPropertyDiagnostics, tagFieldDiagnostics, elDiagnostics, scannerParseFailureDiagnostics)));
}
async function runCheckAll(output, linkDiagnostics, tagAttributeDiagnostics, directiveAttributeDiagnostics, tldDiagnostics, setPropertyDiagnostics, tagFieldDiagnostics, elDiagnostics, scannerParseFailureDiagnostics) {
    // Same reasoning as extension.ts's own `validate()` gate: every jdtls-backed
    // check here (link/tld class resolution, EL chain typing) would silently
    // under-report while the server's still indexing, but the jdtls-independent
    // checks (tag/directive attributes, unknown-EL-variable) would still run --
    // producing a summary that looks complete but isn't, for a run the user
    // explicitly asked for and is likely to treat as authoritative. Bail with a
    // clear message rather than either running a misleadingly partial check or
    // silently blocking for however long indexing takes.
    if (!javaExtensionGateway_1.javaExtensionGateway.isReady()) {
        vscode.window.showWarningMessage('Letterboxd JSP Linker: the Java language server is still starting up -- try "Check All Files" again once it finishes indexing.');
        return;
    }
    output.clear();
    output.show(true);
    output.appendLine('Checking JSP/JSPF/tag/TLD files across the workspace...');
    const excludeGlob = (0, settings_1.getExcludeGlob)();
    const jspFiles = await vscode.workspace.findFiles(JSP_GLOB, excludeGlob);
    const tldFiles = await vscode.workspace.findFiles(TLD_GLOB, excludeGlob);
    const total = jspFiles.length + tldFiles.length;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'JSP Linker: checking all files', cancellable: false }, async (progress) => {
        let done = 0;
        const reportProgress = () => {
            done++;
            progress.report({ message: `${done}/${total}`, increment: 100 / total });
        };
        let errorCount = 0;
        let warningCount = 0;
        let infoCount = 0;
        let hintCount = 0;
        for (let i = 0; i < jspFiles.length; i += CONCURRENCY) {
            const batch = jspFiles.slice(i, i + CONCURRENCY);
            const counts = await Promise.all(batch.map(async (uri) => {
                try {
                    const document = await vscode.workspace.openTextDocument(uri);
                    await Promise.all([
                        linkDiagnostics.validate(document),
                        tagAttributeDiagnostics.validate(document),
                        setPropertyDiagnostics.validate(document),
                        tagFieldDiagnostics.validate(document),
                        elDiagnostics.validate(document),
                    ]);
                    directiveAttributeDiagnostics.validate(document);
                    scannerParseFailureDiagnostics.validate(document);
                    return reportDiagnostics(output, uri);
                }
                catch (error) {
                    return reportValidationFailure(output, uri, error);
                }
                finally {
                    reportProgress();
                }
            }));
            for (const c of counts) {
                errorCount += c.errors;
                warningCount += c.warnings;
                infoCount += c.infos;
                hintCount += c.hints;
            }
        }
        for (let i = 0; i < tldFiles.length; i += CONCURRENCY) {
            const batch = tldFiles.slice(i, i + CONCURRENCY);
            const counts = await Promise.all(batch.map(async (uri) => {
                try {
                    const document = await vscode.workspace.openTextDocument(uri);
                    await tldDiagnostics.validate(document);
                    return reportDiagnostics(output, uri);
                }
                catch (error) {
                    return reportValidationFailure(output, uri, error);
                }
                finally {
                    reportProgress();
                }
            }));
            for (const c of counts) {
                errorCount += c.errors;
                warningCount += c.warnings;
                infoCount += c.infos;
                hintCount += c.hints;
            }
        }
        output.appendLine('');
        output.appendLine(`${total} files checked, ${errorCount} error(s), ${warningCount} warning(s), ${infoCount} info(s), ${hintCount} hint(s).`);
    });
}
/**
 * Handles one file's validation throwing instead of resolving -- without
 * this, an exception from any single `validate()` call (e.g. an unexpected
 * jdtls response shape this extension doesn't handle) would reject the
 * *whole* `Promise.all` for its batch, silently aborting the entire
 * "Check All Files" run partway through: every later batch (and the final
 * "N files checked" summary line) would simply never run, with nothing in
 * the output channel itself pointing at which file or diagnostic caused it.
 * Reported the same way a real diagnostic error is (so it's visible without
 * digging through the Extension Host's own console), plus logged to
 * `console.error` with the full error for a stack trace, and counted as one
 * error so it still affects the final summary counts.
 */
function reportValidationFailure(output, uri, error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[vscode-jsp-linker] check-all validation threw for ${uri.fsPath}:`, error);
    output.appendLine(`ERROR ${uri.fsPath} Validation threw: ${message} (see Extension Host console for the full stack trace)`);
    return { errors: 1, warnings: 0, infos: 0, hints: 0 };
}
function reportDiagnostics(output, uri) {
    let errors = 0;
    let warnings = 0;
    let infos = 0;
    let hints = 0;
    for (const diagnostic of vscode.languages.getDiagnostics(uri)) {
        if (!diagnostic.source || !DIAGNOSTIC_SOURCES.has(diagnostic.source)) {
            continue;
        }
        const line = diagnostic.range.start.line + 1;
        const column = diagnostic.range.start.character + 1;
        // VS Code's Output panel only reliably linkifies absolute paths -- a
        // workspace-relative path (what this printed before) isn't guaranteed to
        // be clickable (see https://github.com/microsoft/vscode/issues/167211).
        const path = uri.fsPath;
        if (diagnostic.severity === vscode.DiagnosticSeverity.Error) {
            errors++;
            output.appendLine(`ERROR ${path}:${line}:${column} ${diagnostic.message}`);
        }
        else if (diagnostic.severity === vscode.DiagnosticSeverity.Warning) {
            warnings++;
            output.appendLine(`WARN  ${path}:${line}:${column} ${diagnostic.message}`);
        }
        else if (diagnostic.severity === vscode.DiagnosticSeverity.Information) {
            infos++;
            output.appendLine(`INFO  ${path}:${line}:${column} ${diagnostic.message}`);
        }
        else if (diagnostic.severity === vscode.DiagnosticSeverity.Hint) {
            hints++;
            output.appendLine(`HINT  ${path}:${line}:${column} ${diagnostic.message}`);
        }
    }
    return { errors, warnings, infos, hints };
}
//# sourceMappingURL=checkAllCommand.js.map