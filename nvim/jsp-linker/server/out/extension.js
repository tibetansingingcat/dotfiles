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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const checkAllCommand_1 = require("./checkAllCommand");
const classpathResourceContentProvider_1 = require("./classpathResourceContentProvider");
const classpathResources_1 = require("./classpathResources");
const definitionProvider_1 = require("./definitionProvider");
const diagnostics_1 = require("./diagnostics");
const directiveAttributeCompletionProvider_1 = require("./directiveAttributeCompletionProvider");
const directiveAttributeDiagnostics_1 = require("./directiveAttributeDiagnostics");
const directiveHoverProvider_1 = require("./directiveHoverProvider");
const elDiagnostics_1 = require("./elDiagnostics");
const variableTypes_1 = require("./variableTypes");
const generatedJavaCodeLensProvider_1 = require("./generatedJavaCodeLensProvider");
const javaExtensionGateway_1 = require("./javaExtensionGateway");
const javaSymbols_1 = require("./javaSymbols");
const linkDiagnostics_1 = require("./linkDiagnostics");
const settings_1 = require("./settings");
const jspHoverProvider_1 = require("./jspHoverProvider");
const scannerParseFailureDiagnostics_1 = require("./scannerParseFailureDiagnostics");
const setPropertyDiagnostics_1 = require("./setPropertyDiagnostics");
const tagAttributeCompletionProvider_1 = require("./tagAttributeCompletionProvider");
const tagAttributeDiagnostics_1 = require("./tagAttributeDiagnostics");
const tagAttributesResolver_1 = require("./tagAttributesResolver");
const tagFieldDiagnostics_1 = require("./tagFieldDiagnostics");
const tldDiagnostics_1 = require("./tldDiagnostics");
const tldIndex_1 = require("./tldIndex");
const JSP_SELECTOR = [
    { scheme: "file", pattern: "**/*.jsp" },
    { scheme: "file", pattern: "**/*.jspf" },
    { scheme: "file", pattern: "**/*.tag" },
];
const TLD_SELECTOR = [
    { scheme: "file", pattern: "**/*.tld" },
];
const REVALIDATE_COMMAND = "vscode-jsp-linker.revalidate";
function matchesJspSelector(document) {
    return (vscode.languages.match(JSP_SELECTOR, document) > 0 &&
        !(0, settings_1.isExcluded)(document.uri));
}
function matchesTldSelector(document) {
    return (vscode.languages.match(TLD_SELECTOR, document) > 0 &&
        !(0, settings_1.isExcluded)(document.uri));
}
async function activate(context) {
    // Created first, before anything else can report a jdtls-call failure --
    // shared with registerCheckAllCommand below rather than each owning its
    // own same-named channel.
    const output = vscode.window.createOutputChannel("Letterboxd JSP Linker");
    javaExtensionGateway_1.javaExtensionGateway.setOutputChannel(output);
    context.subscriptions.push(output);
    // Dedicated collection for "a diagnostics provider threw instead of completing", separate from
    // every provider's own collection -- see `runProvider`'s own doc for why this exists at all.
    const internalErrorDiagnostics = vscode.languages.createDiagnosticCollection("jsp-linker-internal-error");
    context.subscriptions.push(internalErrorDiagnostics);
    // documentUri.toString() -> providerName -> failure message. Rebuilt fresh at the start of every
    // `validate()` call for a document (see below) so a since-fixed provider's error doesn't linger
    // forever, and accumulated across every provider for one document rather than each overwriting
    // the others' -- `vscode.DiagnosticCollection#set` replaces a uri's whole diagnostic list, and up
    // to seven providers can fail independently (some synchronously, some as a later-resolving
    // rejection), so the collection itself can't be the source of truth for "what's currently
    // failing" the way each provider's own collection already is for its real diagnostics.
    const providerFailures = new Map();
    function recordProviderFailure(document, providerName, error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[vscode-jsp-linker] ${providerName}.validate threw for ${document.uri.fsPath}:`, error);
        output.appendLine(`ERROR ${document.uri.fsPath} ${providerName} threw: ${message} (see the Extension Host console for the full stack trace)`);
        const key = document.uri.toString();
        const forDocument = providerFailures.get(key) ?? new Map();
        forDocument.set(providerName, message);
        providerFailures.set(key, forDocument);
        internalErrorDiagnostics.set(document.uri, Array.from(forDocument, ([name, msg]) => (0, diagnostics_1.createDiagnostic)(document, [0, 1], `${name} failed unexpectedly (${msg}) -- this file's diagnostics from that check may be stale or missing. See the "Letterboxd JSP Linker" output channel for details.`, vscode.DiagnosticSeverity.Warning, "jsp-linker-internal-error")));
    }
    /**
     * Runs one diagnostics provider's `validate()` with failure containment. Without this, an
     * unexpected exception from any single provider -- a synchronous throw (`directiveAttributeDiagnostics`/
     * `scannerParseFailureDiagnostics` aren't `async`, so a throw there propagates straight out of
     * `validate()` below, skipping every later provider in the same call), or an unhandled rejection
     * from one of the five `async` providers (none of which are awaited or otherwise watched here) --
     * meant that provider's own `this.collection.set(document.uri, ...)` never ran, leaving stale or
     * absent diagnostics that read identically to "checked, and clean", with the actual error visible
     * nowhere but the Extension Host's own dev console. `checkAllCommand.ts`'s batch run already has
     * this exact protection (`reportValidationFailure`) for the one-off "Check All Files" command;
     * this extends the same idea to the interactive open/edit/save path, where an exception like this
     * would actually be hit in practice.
     */
    function runProvider(document, providerName, run) {
        try {
            const result = run();
            if (result && typeof result.then === "function") {
                result.catch((error) => recordProviderFailure(document, providerName, error));
            }
        }
        catch (error) {
            recordProviderFailure(document, providerName, error);
        }
    }
    if (!javaExtensionGateway_1.javaExtensionGateway.isExtensionActive()) {
        vscode.window.showWarningMessage("Letterboxd JSP-Java Linker: the redhat.java extension is not active, so definitions cannot be resolved.");
    }
    const tldIndex = new tldIndex_1.TldIndex();
    await tldIndex.build();
    const tagAttributesResolver = new tagAttributesResolver_1.TagAttributesResolver(tldIndex);
    const variableTypes = new variableTypes_1.VariableTypeResolver(tldIndex);
    const tagAttributeDiagnostics = new tagAttributeDiagnostics_1.TagAttributeDiagnostics(tagAttributesResolver);
    const directiveAttributeDiagnostics = new directiveAttributeDiagnostics_1.DirectiveAttributeDiagnostics();
    const linkDiagnostics = new linkDiagnostics_1.LinkDiagnostics(tldIndex);
    const tldDiagnostics = new tldDiagnostics_1.TldDiagnostics();
    const setPropertyDiagnostics = new setPropertyDiagnostics_1.SetPropertyDiagnostics(variableTypes);
    const tagFieldDiagnostics = new tagFieldDiagnostics_1.TagFieldDiagnostics(variableTypes);
    const elDiagnostics = new elDiagnostics_1.ElDiagnostics(variableTypes, tldIndex);
    const scannerParseFailureDiagnostics = new scannerParseFailureDiagnostics_1.ScannerParseFailureDiagnostics();
    // Every language-feature provider below is wrapped with excludeAware so an excluded document
    // (see settings.ts's isExcluded) gets no hover/definition/completion/codeLens either -- the same
    // concern validate()'s callers already gate via matchesJspSelector/matchesTldSelector, centralized
    // here as the one place all of this extension's providers are registered.
    const jspDefinitionProvider = new definitionProvider_1.JspDefinitionProvider(tldIndex, variableTypes, tagAttributesResolver);
    const jspHoverProvider = new jspHoverProvider_1.JspHoverProvider(tldIndex, tagAttributesResolver, variableTypes);
    const directiveHoverProvider = new directiveHoverProvider_1.DirectiveHoverProvider();
    const tagAttributeCompletionProvider = new tagAttributeCompletionProvider_1.TagAttributeCompletionProvider(tagAttributesResolver, tldIndex);
    const directiveAttributeCompletionProvider = new directiveAttributeCompletionProvider_1.DirectiveAttributeCompletionProvider();
    const generatedJavaCodeLensProvider = new generatedJavaCodeLensProvider_1.GeneratedJavaCodeLensProvider();
    context.subscriptions.push(vscode.languages.registerDefinitionProvider(JSP_SELECTOR, {
        provideDefinition: (0, settings_1.excludeAware)(jspDefinitionProvider.provideDefinition.bind(jspDefinitionProvider), undefined),
    }), vscode.languages.registerHoverProvider(JSP_SELECTOR, {
        provideHover: (0, settings_1.excludeAware)(jspHoverProvider.provideHover.bind(jspHoverProvider), undefined),
    }), vscode.languages.registerHoverProvider(JSP_SELECTOR, {
        provideHover: (0, settings_1.excludeAware)(directiveHoverProvider.provideHover.bind(directiveHoverProvider), undefined),
    }), vscode.languages.registerCompletionItemProvider(JSP_SELECTOR, {
        provideCompletionItems: (0, settings_1.excludeAware)(tagAttributeCompletionProvider.provideCompletionItems.bind(tagAttributeCompletionProvider), undefined),
    }, " ", '"', "'"), vscode.languages.registerCompletionItemProvider(JSP_SELECTOR, {
        provideCompletionItems: (0, settings_1.excludeAware)(directiveAttributeCompletionProvider.provideCompletionItems.bind(directiveAttributeCompletionProvider), undefined),
    }, " ", '"', "'"), vscode.languages.registerCodeLensProvider([
        { scheme: "file", pattern: "**/*.tag" },
        { scheme: "file", pattern: "**/*.jsp" },
    ], {
        provideCodeLenses: (0, settings_1.excludeAware)(generatedJavaCodeLensProvider.provideCodeLenses.bind(generatedJavaCodeLensProvider), undefined),
    }), vscode.commands.registerCommand("vscode-jsp-linker.openGeneratedJava", generatedJavaCodeLensProvider_1.openGeneratedJava), vscode.commands.registerCommand("vscode-jsp-linker.openGeneratedClass", generatedJavaCodeLensProvider_1.openGeneratedClass), 
    // Manual escape hatch for the same revalidation the javaWatcher below
    // runs automatically on every .java save -- useful when jdtls hasn't
    // finished reindexing yet by the time that watcher fires, so the first
    // pass still sees stale symbols; rerunning after jdtls catches up
    // refreshes diagnostics without needing to touch an open JSP file.
    vscode.commands.registerCommand(REVALIDATE_COMMAND, () => {
        (0, javaSymbols_1.clearJavaSymbolCaches)();
        validateAllOpen();
    }), vscode.workspace.registerTextDocumentContentProvider(classpathResourceContentProvider_1.CLASSPATH_RESOURCE_SCHEME, new classpathResourceContentProvider_1.ClasspathResourceContentProvider()), tagAttributeDiagnostics, directiveAttributeDiagnostics, linkDiagnostics, tldDiagnostics, setPropertyDiagnostics, tagFieldDiagnostics, elDiagnostics, scannerParseFailureDiagnostics);
    (0, checkAllCommand_1.registerCheckAllCommand)(context, output, linkDiagnostics, tagAttributeDiagnostics, directiveAttributeDiagnostics, tldDiagnostics, setPropertyDiagnostics, tagFieldDiagnostics, elDiagnostics, scannerParseFailureDiagnostics);
    // *.jsp and *.jspf, not just global.jspf: TldIndex.resolvePrefix walks a document's actual
    // <%@include%> chain to resolve a taglib prefix, so a taglib directive declared in *any*
    // statically-included file -- not only one literally named global.jspf -- can affect how a
    // prefix resolves. See TldIndex's own comment for why there's no special case for that one
    // filename. *.jsp is included deliberately, not just *.jspf: this codebase's own
    // WEB-INF/templates/esi/*.jsp fragments (and others) are routinely reached via
    // <%@include file="....jsp">, same as any .jspf -- see findAllIncludePaths's 'directive' kind,
    // which doesn't discriminate by the included file's extension either. *.tag is deliberately
    // excluded: a .tag file is invoked via custom-tag syntax, never <%@include%>, in this codebase.
    //
    // Only a *.tld change needs the expensive path (tldIndex.build(): re-globs and re-parses every
    // workspace .tld). A *.jsp/*.jspf change can only ever affect a fragment's own cached bindings
    // -- never the .tld index -- so it's handled by the far cheaper clearFragmentBindingsCache()
    // instead. Without this split, every *.jsp save in the webapp (there are hundreds) would pay
    // for a full .tld rescan it doesn't need.
    const tldWatcher = vscode.workspace.createFileSystemWatcher("**/WEB-INF/**/*.{tld,jsp,jspf}");
    const onTldRelevantFileChanged = (uri) => uri.fsPath.endsWith(".tld") ? tldIndex.build() : tldIndex.clearFragmentBindingsCache();
    tldWatcher.onDidChange(onTldRelevantFileChanged);
    tldWatcher.onDidCreate(onTldRelevantFileChanged);
    tldWatcher.onDidDelete(onTldRelevantFileChanged);
    // resolveMemberReturnType (javaSymbols.ts) caches its result for the
    // session -- see its own comment -- keyed by (fqcn, candidateNames), with
    // no cheap way to know which cache entries a given .java file could have
    // affected. Same precision/cost tradeoff tldWatcher already makes for
    // TLD/fragment changes: a blanket clear-and-revalidate on any .java
    // save, rather than tracking per-file dependencies.
    //
    // Deliberately reacts to every .java file, including generated ones under
    // target/generated-sources (Lombok, JPA metamodel, ...) -- those are real,
    // jdtls-indexed classes this extension resolves against
    // (java.symbols.includeGeneratedCode is on in .vscode/settings.json), not
    // noise to filter out. The actual overload this used to cause when many of
    // them changed at once wasn't from reacting too often -- it was
    // `resolveClass` (javaSymbols.ts) issuing unbounded concurrent
    // `vscode.executeWorkspaceSymbolProvider` calls into jdtls's shared
    // ForkJoinPool, which has its own fixed worker-thread limit; see the
    // concurrency limit added there, which fixes that without dropping any
    // file-change signal. Debounced here only to collapse a burst of real
    // changes (a branch switch, a multi-file refactor, one build's worth of
    // generated-source rewrites) into a single clear-and-revalidate rather than
    // one per file -- a pure efficiency win, not a correctness dependency.
    const javaWatcher = vscode.workspace.createFileSystemWatcher("**/*.java");
    let javaRevalidateTimeout;
    const onJavaFileChanged = () => {
        if (javaRevalidateTimeout) {
            clearTimeout(javaRevalidateTimeout);
        }
        javaRevalidateTimeout = setTimeout(() => {
            javaRevalidateTimeout = undefined;
            vscode.commands.executeCommand(REVALIDATE_COMMAND);
        }, 500);
    };
    javaWatcher.onDidChange(onJavaFileChanged);
    javaWatcher.onDidCreate(onJavaFileChanged);
    javaWatcher.onDidDelete(onJavaFileChanged);
    context.subscriptions.push(tldWatcher, javaWatcher, {
        dispose: () => {
            if (javaRevalidateTimeout) {
                clearTimeout(javaRevalidateTimeout);
            }
        },
    });
    function validate(document) {
        // Every check below either depends on jdtls directly (linkDiagnostics,
        // tldDiagnostics, elDiagnostics's chain tier) or doesn't (tag/directive
        // attribute validation, elDiagnostics's unknown-variable tier). Gating
        // the whole pass here -- rather than letting each check individually
        // decide whether it's ready -- means a document's diagnostics are always
        // shown complete or not at all, never some checks landing immediately
        // and others popping in later once jdtls catches up: a file that looks
        // clean on first paint but is actually still half-unchecked would
        // mislead the user, and that's worse than a short delay before anything
        // shows. `javaExtensionGateway.trackReadiness(validateAllOpen)` below
        // re-validates every open document the moment the server does become
        // ready, so this only ever costs the one startup window before
        // `serverReady()` first resolves -- `isReady()` never flips back to
        // false afterward.
        if (!javaExtensionGateway_1.javaExtensionGateway.isReady()) {
            return;
        }
        if (matchesTldSelector(document)) {
            runProvider(document, "tldDiagnostics", () => tldDiagnostics.validate(document));
            return;
        }
        internalErrorDiagnostics.delete(document.uri);
        providerFailures.delete(document.uri.toString());
        runProvider(document, "tagAttributeDiagnostics", () => tagAttributeDiagnostics.validate(document));
        runProvider(document, "directiveAttributeDiagnostics", () => directiveAttributeDiagnostics.validate(document));
        runProvider(document, "linkDiagnostics", () => linkDiagnostics.validate(document));
        runProvider(document, "setPropertyDiagnostics", () => setPropertyDiagnostics.validate(document));
        runProvider(document, "tagFieldDiagnostics", () => tagFieldDiagnostics.validate(document));
        runProvider(document, "elDiagnostics", () => elDiagnostics.validate(document));
        runProvider(document, "scannerParseFailureDiagnostics", () => scannerParseFailureDiagnostics.validate(document));
    }
    function validateAllOpen() {
        for (const document of vscode.workspace.textDocuments) {
            if (matchesJspSelector(document) || matchesTldSelector(document)) {
                validate(document);
            }
        }
    }
    // Class-reference diagnostics skip themselves while jdtls is still
    // indexing (see javaExtensionGateway.isReady()); once it's ready,
    // re-validate everything open so those diagnostics reflect the real index
    // rather than waiting for the next incidental edit/save.
    javaExtensionGateway_1.javaExtensionGateway.trackReadiness(validateAllOpen);
    // A module's classpath can also change well after jdtls first became
    // ready -- e.g. a new Maven dependency getting reimported -- which would
    // otherwise leave classpathResources.ts's per-module jar index (and any
    // diagnostics that depended on it) stale for the rest of the session.
    (0, classpathResources_1.trackClasspathInvalidation)(validateAllOpen);
    // Toggling vscode-jsp-linker.beanPropertyValidation.enabled (see
    // package.json) should clear/show its squiggles immediately rather than
    // waiting for the next incidental edit/save on each open document.
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(settings_1.BEAN_PROPERTY_VALIDATION_ENABLED_SETTING)) {
            validateAllOpen();
        }
        // Same immediate-refresh behavior for elUnknownVariableWarning.enabled
        // (see package.json) -- its own opt-out, separate from
        // beanPropertyValidation.enabled since it's a different confidence
        // tier (see ElDiagnostics's own comment).
        if (event.affectsConfiguration(settings_1.EL_UNKNOWN_VARIABLE_WARNING_ENABLED_SETTING)) {
            validateAllOpen();
        }
    }));
    // TODO: also revalidate open documents when a referenced .java class is
    // deleted/renamed elsewhere in the workspace, so a JSP left open in a
    // background tab doesn't keep showing a since-deleted class as resolved
    // until it's next edited/saved/reopened. A createFileSystemWatcher on
    // '**/src/main/java/**/*.java' (glob deliberately excludes
    // target/generated-sources -- annotation processing rewrites hundreds of
    // files there on every build, which would otherwise fire this constantly
    // while jdtls itself is mid-reindex) feeding a single debounced (~500ms-1s)
    // call to validateAllOpen would cover it; resolveClass isn't cached, so the
    // per-firing cost is just one workspace-symbol lookup per distinct FQCN
    // across currently-open JSP/tag documents.
    const pendingValidations = new Map();
    function scheduleValidate(document) {
        const key = document.uri.toString();
        const existing = pendingValidations.get(key);
        if (existing) {
            clearTimeout(existing);
        }
        pendingValidations.set(key, setTimeout(() => {
            pendingValidations.delete(key);
            validate(document);
        }, 300));
    }
    for (const document of vscode.workspace.textDocuments) {
        if (matchesJspSelector(document) || matchesTldSelector(document)) {
            validate(document);
        }
    }
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument((document) => {
        if (matchesJspSelector(document) || matchesTldSelector(document)) {
            validate(document);
        }
    }), vscode.workspace.onDidChangeTextDocument((event) => {
        if (matchesJspSelector(event.document) ||
            matchesTldSelector(event.document)) {
            scheduleValidate(event.document);
        }
    }), vscode.workspace.onDidSaveTextDocument((document) => {
        if (matchesJspSelector(document)) {
            // The saved file might itself be a .tag file whose declarations changed.
            tagAttributesResolver.invalidateTagFile(document.uri);
        }
        if (matchesJspSelector(document) || matchesTldSelector(document)) {
            validate(document);
        }
    }), {
        dispose: () => {
            for (const timeout of pendingValidations.values()) {
                clearTimeout(timeout);
            }
            pendingValidations.clear();
        },
    });
}
function deactivate() { }
//# sourceMappingURL=extension.js.map