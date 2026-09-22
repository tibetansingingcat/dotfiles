'use strict';
/**
 * The LSP server: it hosts the unmodified VSCode extension in `out/` on top of `vscode-shim`, and
 * turns the providers that extension registers into real LSP responses.
 *
 * Nothing here knows anything about JSP. It only bridges two directions:
 *   - Neovim's LSP requests  -> the extension's registered providers.
 *   - The extension's jdtls calls -> Neovim, via the `jsp/java` notification pair (see `relay`).
 *
 * The relay is a notification pair rather than a server-to-client *request* on purpose: Neovim
 * answers a server-to-client request from the handler's return value, synchronously, so a jdtls
 * round trip made that way would block the editor's event loop for the length of a workspace symbol
 * search. Notifications in both directions, correlated by id, keep it asynchronous.
 */

const {
  createConnection,
  ProposedFeatures,
  TextDocumentSyncKind,
  TextDocuments,
} = require('vscode-languageserver/node');
const { TextDocument: LspTextDocument } = require('vscode-languageserver-textdocument');

const vscode = require('vscode');
const { host, Uri, Position, TextDocument } = vscode;
const internal = vscode._internal;

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(LspTextDocument);

host.connection = connection;
host.documents = documents;
host.log = (msg) => connection.console.log(String(msg));

// ---------------------------------------------------------------------------------------------
// The jdtls relay.

let nextRelayId = 1;
const pending = new Map();
const RELAY_TIMEOUT_MS = 30000;

host.relay = (method, params) =>
  new Promise((resolve) => {
    const id = nextRelayId++;
    // A relay that never comes back must not wedge the caller forever: the extension's own
    // `javaExtensionGateway.execute` treats `undefined` as "abstain", which is the correct
    // degradation here too (jdtls suspended via :JdtlsStop, or simply not attached yet).
    const timer = setTimeout(() => {
      if (pending.delete(id)) {
        connection.console.log(`relay ${method} #${id} timed out`);
        resolve(undefined);
      }
    }, RELAY_TIMEOUT_MS);
    pending.set(id, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
    connection.sendNotification(method, { id, ...params });
  });

connection.onNotification('jsp/javaResult', ({ id, result }) => {
  const resolve = pending.get(id);
  if (resolve) {
    pending.delete(id);
    resolve(result === null ? undefined : result);
  }
});

connection.onNotification('jsp/javaReady', () => {
  internal.java.javaApi._ready = true;
  internal.java.javaReady.fire(true);
});

connection.onNotification('jsp/classpathUpdate', ({ root }) => {
  internal.java.classpathUpdated.fire(Uri.file(root));
});

// ---------------------------------------------------------------------------------------------
// Bridging LSP requests onto the extension's providers.

function docFor(uriString) {
  const live = documents.get(uriString);
  if (!live) return undefined;
  return new TextDocument(Uri.parse(uriString), live.getText(), live.version);
}

const CANCEL = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };

/**
 * Runs every registered provider whose selector matches, and returns the first usable answer.
 * The extension registers more than one hover and completion provider for the same files (a JSP tag
 * provider and a directive provider), each abstaining with `undefined` outside its own syntax -- so
 * "first non-empty wins" is the composition it was already written for.
 */
async function firstResult(list, document, run) {
  for (const { selector, provider } of list) {
    if (!internal.selectorMatches(selector, document)) continue;
    try {
      const result = await run(provider);
      if (result !== undefined && result !== null && (!Array.isArray(result) || result.length > 0)) {
        return result;
      }
    } catch (error) {
      connection.console.error(`provider failed: ${error && error.stack ? error.stack : error}`);
    }
  }
  return undefined;
}

function toLspRange(r) {
  return {
    start: { line: r.start.line, character: r.start.character },
    end: { line: r.end.line, character: r.end.character },
  };
}

function markdownOf(contents) {
  const parts = (Array.isArray(contents) ? contents : [contents])
    .map((c) => (typeof c === 'string' ? c : c && c.value ? c.value : ''))
    .filter(Boolean);
  return parts.join('\n\n---\n\n');
}

connection.onInitialize((params) => {
  host.workspaceRoot =
    (params.workspaceFolders && params.workspaceFolders[0] && Uri.parse(params.workspaceFolders[0].uri).fsPath) ||
    params.rootPath ||
    process.cwd();
  host.settings = (params.initializationOptions && params.initializationOptions.settings) || {};

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      definitionProvider: true,
      hoverProvider: true,
      codeLensProvider: { resolveProvider: false },
      completionProvider: { triggerCharacters: [' ', '"', "'", '<', ':', '.', '$', '{'] },
      executeCommandProvider: { commands: [...internal.registeredCommands.keys()] },
    },
  };
});

connection.onInitialized(async () => {
  try {
    // The extension's own `activate`. It builds the TLD index and registers every provider, so
    // nothing below can run until it resolves.
    const extension = require('./out/extension.js');
    const subscriptions = [];
    await extension.activate({
      subscriptions,
      extensionPath: __dirname,
      extensionUri: Uri.file(__dirname),
      globalState: memento(),
      workspaceState: memento(),
      asAbsolutePath: (p) => require('node:path').join(__dirname, p),
    });
    connection.console.log('jsp-linker: extension activated');
  } catch (error) {
    connection.console.error(`jsp-linker: activate failed: ${error && error.stack ? error.stack : error}`);
    connection.sendNotification('window/showMessage', {
      type: 1,
      message: `JSP Linker failed to start: ${error && error.message ? error.message : error}`,
    });
  }
});

function memento() {
  const store = new Map();
  return {
    get: (k, d) => (store.has(k) ? store.get(k) : d),
    update: (k, v) => { store.set(k, v); return Promise.resolve(); },
    keys: () => [...store.keys()],
    setKeysForSync: () => {},
  };
}

connection.onDefinition(async ({ textDocument, position }) => {
  const document = docFor(textDocument.uri);
  if (!document) return null;
  const pos = new Position(position.line, position.character);
  const result = await firstResult(internal.providers.definition, document, (p) =>
    p.provideDefinition(document, pos, CANCEL),
  );
  if (!result) return null;
  const list = Array.isArray(result) ? result : [result];
  return list.map((l) =>
    l.targetUri
      ? { uri: l.targetUri.toString(), range: toLspRange(l.targetRange) }
      : { uri: l.uri.toString(), range: toLspRange(l.range) },
  );
});

connection.onHover(async ({ textDocument, position }) => {
  const document = docFor(textDocument.uri);
  if (!document) return null;
  const pos = new Position(position.line, position.character);
  const hover = await firstResult(internal.providers.hover, document, (p) =>
    p.provideHover(document, pos, CANCEL),
  );
  if (!hover) return null;
  return {
    contents: { kind: 'markdown', value: markdownOf(hover.contents) },
    range: hover.range ? toLspRange(hover.range) : undefined,
  };
});

connection.onCompletion(async ({ textDocument, position, context }) => {
  const document = docFor(textDocument.uri);
  if (!document) return null;
  const pos = new Position(position.line, position.character);
  const items = await firstResult(internal.providers.completion, document, (p) =>
    p.provideCompletionItems(document, pos, CANCEL, context || { triggerKind: 1 }),
  );
  if (!items) return null;
  const list = Array.isArray(items) ? items : items.items || [];
  return list.map((item) => {
    const snippet = item.insertText && item.insertText.value !== undefined;
    return {
      label: typeof item.label === 'string' ? item.label : item.label.label,
      kind: (item.kind ?? 0) + 1, // vscode 0-based -> LSP 1-based
      detail: item.detail,
      documentation: item.documentation
        ? { kind: 'markdown', value: markdownOf(item.documentation) }
        : undefined,
      sortText: item.sortText,
      filterText: item.filterText,
      insertText: snippet ? item.insertText.value : item.insertText,
      insertTextFormat: snippet ? 2 : 1,
      textEdit: item.range
        ? {
            range: toLspRange(item.range),
            newText: snippet ? item.insertText.value : (item.insertText || item.label),
          }
        : undefined,
    };
  });
});

connection.onCodeLens(async ({ textDocument }) => {
  const document = docFor(textDocument.uri);
  if (!document) return null;
  const lenses = await firstResult(internal.providers.codeLens, document, (p) =>
    p.provideCodeLenses(document, CANCEL),
  );
  if (!lenses) return null;
  return lenses.map((lens) => ({
    range: toLspRange(lens.range),
    command: lens.command
      ? {
          title: lens.command.title,
          command: lens.command.command,
          arguments: (lens.command.arguments || []).map((a) => (a instanceof Uri ? a.toString() : a)),
        }
      : undefined,
  }));
});

connection.onExecuteCommand(async ({ command, arguments: args }) => {
  const handler = internal.registeredCommands.get(command);
  if (!handler) return null;
  // A command registered by the extension takes `vscode.Uri`s, not the strings that survive JSON.
  const revived = (args || []).map((a) =>
    typeof a === 'string' && /^[a-z][a-z0-9+.-]*:\/\//i.test(a) ? Uri.parse(a) : a,
  );
  return (await handler(...revived)) ?? null;
});

// ---------------------------------------------------------------------------------------------
// Document lifecycle. The extension validates from its own open/change/save listeners, so these
// just forward the events it already subscribes to.

documents.onDidOpen(({ document }) => {
  internal.events.onDidOpen.fire(docFor(document.uri));
});

documents.onDidChangeContent(({ document }) => {
  internal.events.onDidChange.fire({
    document: docFor(document.uri),
    contentChanges: [],
    reason: undefined,
  });
});

documents.onDidSave(({ document }) => {
  internal.events.onDidSave.fire(docFor(document.uri));
});

documents.onDidClose(({ document }) => {
  internal.openTextDocuments.delete(document.uri);
  for (const collection of internal.diagnosticCollections) {
    collection.map.delete(document.uri);
  }
  connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
});

connection.onDidChangeConfiguration((change) => {
  if (change.settings) host.settings = change.settings;
  internal.events.onDidChangeConfig.fire({ affectsConfiguration: () => true });
});

documents.listen(connection);
connection.listen();
