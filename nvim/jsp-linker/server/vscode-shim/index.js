'use strict';
/**
 * A `vscode` module standing in for the real editor API, backed by `vscode-languageserver`.
 *
 * The extension in `../out` is the compiled VSCode extension, copied verbatim and never edited.
 * Roughly 6000 of its ~11300 lines never import `vscode` at all (the JSP/EL scanners, the TLD
 * parser, `javaSymbols`), and the rest touch only the 23 symbols implemented here -- so faking the
 * API is a far smaller job than rewriting the half that uses it, and leaves upstream's own files
 * byte-identical, which is what makes re-copying a newer `out/` a copy rather than a merge.
 *
 * Two deliberate gaps, both of which the extension already treats as normal:
 *   - Anything needing a real editor UI (`showTextDocument`, `withProgress`) degrades to an LSP
 *     notification. Nothing reads its return value.
 *   - Every jdtls call is relayed to Neovim rather than answered here (see `commands.executeCommand`).
 *     A relay failure returns `undefined`, which is exactly the "abstain rather than guess wrong"
 *     contract `javaExtensionGateway.execute` already imposes on every one of its callers.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');

// Set by ../server.js once the connection exists. Kept as a mutable slot rather than passed in,
// because the extension's own modules capture `vscode` at require time, before that point.
const host = {
  connection: null,
  documents: null,
  workspaceRoot: process.cwd(),
  settings: {},
  relay: async () => undefined,
  log: () => {},
};

// --------------------------------------------------------------------------------------------
// Geometry and data types.
//
// `Range.contains` is the only behaviour any of these needs -- everything else is read as plain
// data -- so they stay one-liners rather than reimplementing the real API's full comparison surface.

class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}

class Range {
  constructor(a, b, c, d) {
    if (typeof a === 'number') {
      this.start = new Position(a, b);
      this.end = new Position(c, d);
    } else {
      this.start = a;
      this.end = b;
    }
  }
  contains(positionOrRange) {
    const p = positionOrRange instanceof Range ? positionOrRange.start : positionOrRange;
    const q = positionOrRange instanceof Range ? positionOrRange.end : positionOrRange;
    return !before(p, this.start) && !before(this.end, q);
  }
}

function before(a, b) {
  return a.line < b.line || (a.line === b.line && a.character < b.character);
}

class Location {
  constructor(uri, rangeOrPosition) {
    this.uri = uri;
    this.range = rangeOrPosition instanceof Range
      ? rangeOrPosition
      : new Range(rangeOrPosition, rangeOrPosition);
  }
}

/**
 * Mirrors `vscode.Uri`. The extension leans on `fsPath`, `path`, `scheme` and `toString()`, and
 * `jdtUri.ts` specifically parses a `jdt://` URI's own path -- so this keeps a real scheme/path
 * split rather than treating every URI as a filesystem path.
 */
class Uri {
  constructor(scheme, authority, uriPath, query, fragment) {
    this.scheme = scheme;
    this.authority = authority || '';
    this.path = uriPath || '';
    this.query = query || '';
    this.fragment = fragment || '';
  }

  static file(fsPath) {
    return new Uri('file', '', fsPath.replace(/\\/g, '/'), '', '');
  }

  static parse(value) {
    const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(value);
    if (m) {
      return new Uri(m[1], decodeURIComponent(m[2]), decodeURIComponent(m[3]), m[4] || '', m[5] || '');
    }
    const n = /^([a-zA-Z][a-zA-Z0-9+.-]*):([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(value);
    if (n) {
      return new Uri(n[1], '', n[2], n[3] || '', n[4] || '');
    }
    return Uri.file(value);
  }

  static from(parts) {
    return new Uri(parts.scheme, parts.authority, parts.path, parts.query, parts.fragment);
  }

  get fsPath() {
    return this.scheme === 'file' ? this.path : this.toString();
  }

  with(change) {
    return new Uri(
      change.scheme ?? this.scheme,
      change.authority ?? this.authority,
      change.path ?? this.path,
      change.query ?? this.query,
      change.fragment ?? this.fragment,
    );
  }

  toString() {
    if (this.scheme === 'file') {
      return pathToFileURL(this.path).toString();
    }
    let s = `${this.scheme}://${this.authority}${this.path}`;
    if (this.query) s += `?${this.query}`;
    if (this.fragment) s += `#${this.fragment}`;
    return s;
  }

  toJSON() {
    return this.toString();
  }
}

const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 };

class Diagnostic {
  constructor(range, message, severity) {
    this.range = range;
    this.message = message;
    this.severity = severity ?? DiagnosticSeverity.Error;
  }
}

class MarkdownString {
  constructor(value) {
    this.value = value || '';
    this.isTrusted = false;
  }
  appendMarkdown(v) {
    this.value += v;
    return this;
  }
  appendText(v) {
    this.value += v;
    return this;
  }
  appendCodeblock(code, lang) {
    this.value += `\n\`\`\`${lang || ''}\n${code}\n\`\`\`\n`;
    return this;
  }
}

class Hover {
  constructor(contents, range) {
    this.contents = Array.isArray(contents) ? contents : [contents];
    this.range = range;
  }
}

class SnippetString {
  constructor(value) {
    this.value = value || '';
  }
}

const CompletionItemKind = {
  Text: 0, Method: 1, Function: 2, Constructor: 3, Field: 4, Variable: 5, Class: 6,
  Interface: 7, Module: 8, Property: 9, Unit: 10, Value: 11, Enum: 12, Keyword: 13,
  Snippet: 14, Color: 15, File: 16, Reference: 17, Folder: 18, EnumMember: 19,
  Constant: 20, Struct: 21, Event: 22, Operator: 23, TypeParameter: 24,
};

class CompletionItem {
  constructor(label, kind) {
    this.label = label;
    this.kind = kind;
  }
}

class CodeLens {
  constructor(range, command) {
    this.range = range;
    this.command = command;
  }
}

class RelativePattern {
  constructor(base, pattern) {
    this.baseUri = base instanceof Uri ? base : Uri.file(String(base));
    this.base = this.baseUri.fsPath;
    this.pattern = pattern;
  }
}

class EventEmitter {
  constructor() {
    this.listeners = [];
    this.event = (listener) => {
      this.listeners.push(listener);
      return { dispose: () => { this.listeners = this.listeners.filter((l) => l !== listener); } };
    };
  }
  fire(value) {
    for (const l of this.listeners.slice()) l(value);
  }
  dispose() {
    this.listeners = [];
  }
}

const ProgressLocation = { SourceControl: 1, Window: 10, Notification: 15 };

// vscode's own SymbolKind is 0-based where LSP's is 1-based; `reviveDocumentSymbol` and
// `reviveSymbolInformation` below convert incoming jdtls symbols, so the extension compares
// against these values and never against a raw LSP kind.
const SymbolKind = {
  File: 0, Module: 1, Namespace: 2, Package: 3, Class: 4, Method: 5, Property: 6, Field: 7,
  Constructor: 8, Enum: 9, Interface: 10, Function: 11, Variable: 12, Constant: 13, String: 14,
  Number: 15, Boolean: 16, Array: 17, Object: 18, Key: 19, Null: 20, EnumMember: 21, Struct: 22,
  Event: 23, Operator: 24, TypeParameter: 25,
};

// --------------------------------------------------------------------------------------------
// TextDocument.
//
// The extension reads `uri`, `getText`, `offsetAt`, `positionAt`, `version` and `fileName` and
// nothing else, so this wraps a string rather than pulling in a full document implementation.

class TextDocument {
  constructor(uri, text, version) {
    this.uri = uri;
    this.version = version ?? 1;
    this._text = text;
    this._lineStarts = null;
  }

  get fileName() {
    return this.uri.fsPath;
  }

  get languageId() {
    const ext = path.extname(this.uri.path);
    return ext === '.tld' ? 'xml' : 'jsp';
  }

  get lineCount() {
    return this.starts().length;
  }

  getText(range) {
    if (!range) return this._text;
    return this._text.slice(this.offsetAt(range.start), this.offsetAt(range.end));
  }

  starts() {
    if (!this._lineStarts) {
      this._lineStarts = [0];
      for (let i = 0; i < this._text.length; i++) {
        if (this._text.charCodeAt(i) === 10) this._lineStarts.push(i + 1);
      }
    }
    return this._lineStarts;
  }

  offsetAt(position) {
    const starts = this.starts();
    if (position.line >= starts.length) return this._text.length;
    if (position.line < 0) return 0;
    const lineStart = starts[position.line];
    const lineEnd = position.line + 1 < starts.length ? starts[position.line + 1] : this._text.length;
    return Math.min(lineStart + Math.max(0, position.character), lineEnd);
  }

  positionAt(offset) {
    const starts = this.starts();
    const clamped = Math.max(0, Math.min(offset, this._text.length));
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (starts[mid] <= clamped) lo = mid; else hi = mid - 1;
    }
    return new Position(lo, clamped - starts[lo]);
  }

  lineAt(lineOrPosition) {
    const line = typeof lineOrPosition === 'number' ? lineOrPosition : lineOrPosition.line;
    const starts = this.starts();
    const from = starts[line] ?? this._text.length;
    const to = line + 1 < starts.length ? starts[line + 1] : this._text.length;
    const text = this._text.slice(from, to).replace(/\r?\n$/, '');
    return { lineNumber: line, text, range: new Range(line, 0, line, text.length) };
  }
}

// --------------------------------------------------------------------------------------------
// Glob matching.
//
// `findFiles` and `isExcluded` are given VSCode-flavoured globs (`**/WEB-INF/**/*.tld`, and a
// brace-joined exclude string built by `settings.ts`). Translating to a RegExp keeps this
// dependency-free; `**` has to be handled before `*` so a path separator only crosses where the
// pattern actually allows it.

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') i++;
        re += '(?:.*\\/)?';
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      re += '(?:';
    } else if (c === '}') {
      re += ')';
    } else if (c === ',') {
      re += '|';
    } else if ('\\^$+.()|[]'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

const globCache = new Map();
function matchGlob(glob, relativePath) {
  let re = globCache.get(glob);
  if (!re) {
    re = globToRegExp(glob);
    globCache.set(glob, re);
  }
  return re.test(relativePath);
}

const SKIP_DIRS = new Set(['.git', 'node_modules', '.svn', '.hg', 'target', '.idea', '.metals', '.bloop']);

async function walk(dir, onFile) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(full, onFile);
    } else if (entry.isFile()) {
      await onFile(full);
    }
  }
}

// --------------------------------------------------------------------------------------------
// Namespaces.

const diagnosticCollections = new Set();

/**
 * One `DiagnosticCollection` per check, exactly as the extension creates them -- but LSP has no
 * equivalent concept: `textDocument/publishDiagnostics` replaces a file's whole list. So each
 * collection holds its own entries and publishing merges across every collection for that URI,
 * which keeps upstream's "each provider owns its own collection" structure working unchanged.
 */
class DiagnosticCollection {
  constructor(name) {
    this.name = name;
    this.map = new Map();
    diagnosticCollections.add(this);
  }
  set(uri, diagnostics) {
    const key = uri.toString();
    if (!diagnostics || diagnostics.length === 0) this.map.delete(key);
    else this.map.set(key, diagnostics);
    publishFor(key);
  }
  delete(uri) {
    this.map.delete(uri.toString());
    publishFor(uri.toString());
  }
  clear() {
    const keys = [...this.map.keys()];
    this.map.clear();
    keys.forEach(publishFor);
  }
  get(uri) {
    return this.map.get(uri.toString()) || [];
  }
  dispose() {
    this.clear();
    diagnosticCollections.delete(this);
  }
}

function publishFor(uriString) {
  if (!host.connection) return;
  const all = [];
  for (const collection of diagnosticCollections) {
    for (const d of collection.map.get(uriString) || []) {
      all.push({
        range: {
          start: { line: d.range.start.line, character: d.range.start.character },
          end: { line: d.range.end.line, character: d.range.end.character },
        },
        severity: (d.severity ?? 0) + 1, // vscode 0-based Error..Hint -> LSP 1-based
        message: d.message,
        source: d.source || 'jsp-linker',
        code: d.code && typeof d.code === 'object' ? d.code.value : d.code,
      });
    }
  }
  host.connection.sendDiagnostics({ uri: uriString, diagnostics: all });
}

const openTextDocuments = new Map();

const onDidOpen = new EventEmitter();
const onDidChange = new EventEmitter();
const onDidSave = new EventEmitter();
const onDidClose = new EventEmitter();
const onDidChangeConfig = new EventEmitter();

const workspace = {
  get workspaceFolders() {
    return [{ uri: Uri.file(host.workspaceRoot), name: path.basename(host.workspaceRoot), index: 0 }];
  },

  /**
   * Every document the editor has open, plus any this shim read from disk itself.
   *
   * The editor's own set has to be in here: `activate()` ends by validating everything already
   * open, which is what covers the document whose `didOpen` arrived while `activate` was still
   * awaiting its TLD index build -- a race that happens on essentially every start, since the
   * buffer that triggers the server to launch is open before the server exists.
   */
  get textDocuments() {
    const live = host.documents
      ? host.documents.all().map((d) => new TextDocument(Uri.parse(d.uri), d.getText(), d.version))
      : [];
    const seen = new Set(live.map((d) => d.uri.toString()));
    for (const [key, doc] of openTextDocuments) {
      if (!seen.has(key)) live.push(doc);
    }
    return live;
  },

  getConfiguration(section) {
    const prefix = section ? `${section}.` : '';
    return {
      get(key, fallback) {
        const value = host.settings[prefix + key];
        return value === undefined ? fallback : value;
      },
      has(key) {
        return host.settings[prefix + key] !== undefined;
      },
      inspect() {
        return undefined;
      },
    };
  },

  asRelativePath(uriOrPath, includeWorkspaceFolder) {
    const p = typeof uriOrPath === 'string' ? uriOrPath : uriOrPath.fsPath;
    const rel = path.relative(host.workspaceRoot, p);
    if (rel.startsWith('..')) return p;
    return includeWorkspaceFolder ? path.join(path.basename(host.workspaceRoot), rel) : rel;
  },

  async openTextDocument(uriOrPath) {
    const uri = uriOrPath instanceof Uri
      ? uriOrPath
      : typeof uriOrPath === 'string' ? Uri.file(uriOrPath) : Uri.parse(String(uriOrPath));
    const key = uri.toString();

    const live = host.documents && host.documents.get(key);
    if (live) {
      return new TextDocument(uri, live.getText(), live.version);
    }
    const cached = openTextDocuments.get(key);
    if (cached) return cached;

    // A non-file URI (`jdt://` decompiled source) has no bytes here -- only the editor's own
    // jdtls integration can materialise it, so ask Neovim rather than guessing.
    const text = uri.scheme === 'file'
      ? await fsp.readFile(uri.fsPath, 'utf8')
      : await host.relay('jsp/readUri', { uri: key });
    if (text === undefined || text === null) {
      throw new Error(`cannot read ${key}`);
    }
    const doc = new TextDocument(uri, String(text), 1);
    openTextDocuments.set(key, doc);
    return doc;
  },

  async findFiles(include, exclude, maxResults) {
    const base = include instanceof RelativePattern ? include.base : host.workspaceRoot;
    const pattern = include instanceof RelativePattern ? include.pattern : include;
    const results = [];
    await walk(base, async (full) => {
      if (maxResults && results.length >= maxResults) return;
      const rel = path.relative(base, full).replace(/\\/g, '/');
      if (!matchGlob(pattern, rel)) return;
      if (exclude) {
        const relToRoot = path.relative(host.workspaceRoot, full).replace(/\\/g, '/');
        const excludePattern = typeof exclude === 'string' ? exclude : exclude.pattern;
        if (matchGlob(excludePattern, relToRoot)) return;
      }
      results.push(Uri.file(full));
    });
    return maxResults ? results.slice(0, maxResults) : results;
  },

  fs: {
    async readFile(uri) {
      return new Uint8Array(await fsp.readFile(uri.fsPath));
    },
    async stat(uri) {
      const s = await fsp.stat(uri.fsPath);
      return { type: s.isDirectory() ? 2 : 1, ctime: s.ctimeMs, mtime: s.mtimeMs, size: s.size };
    },
    async readDirectory(uri) {
      const entries = await fsp.readdir(uri.fsPath, { withFileTypes: true });
      return entries.map((e) => [e.name, e.isDirectory() ? 2 : 1]);
    },
  },

  /**
   * A no-op watcher. Neovim drives re-validation from its own autocommands (see the Lua side),
   * so nothing here needs an inotify watch of its own -- but the extension registers watchers at
   * activation and disposes them at shutdown, so the shape still has to exist.
   */
  createFileSystemWatcher() {
    const noop = new EventEmitter();
    return {
      onDidCreate: noop.event,
      onDidChange: noop.event,
      onDidDelete: noop.event,
      dispose: () => noop.dispose(),
    };
  },

  registerTextDocumentContentProvider(scheme, provider) {
    contentProviders.set(scheme, provider);
    return { dispose: () => contentProviders.delete(scheme) };
  },

  onDidOpenTextDocument: onDidOpen.event,
  onDidChangeTextDocument: onDidChange.event,
  onDidSaveTextDocument: onDidSave.event,
  onDidCloseTextDocument: onDidClose.event,
  onDidChangeConfiguration: onDidChangeConfig.event,
};

const contentProviders = new Map();

const window = {
  get activeTextEditor() {
    return undefined;
  },
  createOutputChannel(name) {
    return {
      name,
      appendLine: (line) => host.log(`[${name}] ${line}`),
      append: (text) => host.log(`[${name}] ${text}`),
      show: () => {},
      clear: () => {},
      dispose: () => {},
    };
  },
  showInformationMessage(message) {
    notify(3, message);
    return Promise.resolve(undefined);
  },
  showWarningMessage(message) {
    notify(2, message);
    return Promise.resolve(undefined);
  },
  showErrorMessage(message) {
    notify(1, message);
    return Promise.resolve(undefined);
  },
  async showTextDocument(uriOrDocument, options) {
    const uri = uriOrDocument instanceof Uri ? uriOrDocument : uriOrDocument.uri;
    const range = options && options.selection;
    await host.relay('jsp/showDocument', {
      uri: uri.toString(),
      line: range ? range.start.line : 0,
      character: range ? range.start.character : 0,
    });
  },
  async withProgress(options, task) {
    notify(3, options.title || 'JSP Linker: working');
    return task({ report: () => {} }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) });
  },
};

function notify(type, message) {
  if (host.connection) host.connection.sendNotification('window/showMessage', { type, message });
}

const providers = {
  definition: [],
  hover: [],
  completion: [],
  codeLens: [],
};

function selectorMatches(selector, document) {
  const list = Array.isArray(selector) ? selector : [selector];
  const rel = workspace.asRelativePath(document.uri, false).replace(/\\/g, '/');
  return list.some((s) => {
    if (typeof s === 'string') return document.languageId === s;
    if (s.scheme && s.scheme !== document.uri.scheme) return false;
    if (s.pattern) return matchGlob(s.pattern, rel) || matchGlob(s.pattern, document.uri.path);
    if (s.language) return document.languageId === s.language;
    return true;
  });
}

const languages = {
  createDiagnosticCollection(name) {
    return new DiagnosticCollection(name);
  },
  match(selector, document) {
    return selectorMatches(selector, document) ? 10 : 0;
  },
  getDiagnostics(uri) {
    if (!uri) return [];
    const out = [];
    for (const c of diagnosticCollections) out.push(...c.get(uri));
    return out;
  },
  registerDefinitionProvider(selector, provider) {
    providers.definition.push({ selector, provider });
    return { dispose: () => {} };
  },
  registerHoverProvider(selector, provider) {
    providers.hover.push({ selector, provider });
    return { dispose: () => {} };
  },
  registerCompletionItemProvider(selector, provider, ...triggers) {
    providers.completion.push({ selector, provider, triggers });
    return { dispose: () => {} };
  },
  registerCodeLensProvider(selector, provider) {
    providers.codeLens.push({ selector, provider });
    return { dispose: () => {} };
  },
};

const registeredCommands = new Map();

const commands = {
  registerCommand(id, handler) {
    registeredCommands.set(id, handler);
    return { dispose: () => registeredCommands.delete(id) };
  },

  /**
   * Every jdtls-backed command the extension issues is relayed to Neovim, which forwards it to the
   * `jdtls` client already attached there. Spawning a second jdtls here instead would mean a second
   * full Eclipse workspace index of the same project, for the same answers.
   *
   * The results come back as plain LSP JSON, so they are rebuilt into the `Uri`/`Range` shapes the
   * extension reads -- `javaSymbols` calls `selectionRange.contains(position)` on them, which plain
   * JSON has no method for.
   */
  async executeCommand(command, ...args) {
    switch (command) {
      case 'vscode.executeWorkspaceSymbolProvider': {
        const raw = await host.relay('jsp/java', { method: 'workspace/symbol', params: { query: args[0] } });
        return (raw || []).map(reviveSymbolInformation);
      }
      case 'vscode.executeDefinitionProvider': {
        const raw = await host.relay('jsp/java', {
          method: 'textDocument/definition',
          params: { textDocument: { uri: args[0].toString() }, position: plainPosition(args[1]) },
          open: args[0].toString(),
        });
        return reviveLocations(raw);
      }
      case 'vscode.executeDocumentSymbolProvider': {
        const raw = await host.relay('jsp/java', {
          method: 'textDocument/documentSymbol',
          params: { textDocument: { uri: args[0].toString() } },
          open: args[0].toString(),
        });
        return (raw || []).map(reviveDocumentSymbol);
      }
      case 'java.execute.workspaceCommand': {
        return host.relay('jsp/java', {
          method: 'workspace/executeCommand',
          params: { command: args[0], arguments: args.slice(1) },
        });
      }
      case 'vscode.open': {
        return host.relay('jsp/showDocument', { uri: String(args[0]), line: 0, character: 0 });
      }
      default: {
        const local = registeredCommands.get(command);
        if (local) return local(...args);
        host.log(`unhandled executeCommand: ${command}`);
        return undefined;
      }
    }
  },

  getCommands() {
    return Promise.resolve([...registeredCommands.keys()]);
  },
};

function plainPosition(p) {
  return { line: p.line, character: p.character };
}

function reviveRange(r) {
  return r
    ? new Range(r.start.line, r.start.character, r.end.line, r.end.character)
    : new Range(0, 0, 0, 0);
}

function reviveSymbolInformation(s) {
  // jdtls answers workspace/symbol with SymbolInformation, whose location may omit `range` until
  // the symbol is resolved; an absent range degrades to the start of the file rather than throwing.
  const loc = s.location || {};
  return {
    name: s.name,
    kind: (s.kind ?? 1) - 1, // LSP 1-based SymbolKind -> vscode 0-based
    containerName: s.containerName || '',
    location: new Location(Uri.parse(loc.uri || ''), reviveRange(loc.range)),
  };
}

function reviveLocations(raw) {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((l) =>
    l.targetUri
      ? new Location(Uri.parse(l.targetUri), reviveRange(l.targetSelectionRange || l.targetRange))
      : new Location(Uri.parse(l.uri), reviveRange(l.range)),
  );
}

function reviveDocumentSymbol(s) {
  // jdtls can answer documentSymbol with flat SymbolInformation when hierarchical support is not
  // advertised. Both shapes are normalised to the DocumentSymbol the extension expects.
  if (s.location && !s.range) {
    return {
      name: s.name,
      detail: '',
      kind: (s.kind ?? 1) - 1,
      range: reviveRange(s.location.range),
      selectionRange: reviveRange(s.location.range),
      children: [],
    };
  }
  return {
    name: s.name,
    detail: s.detail || '',
    kind: (s.kind ?? 1) - 1,
    range: reviveRange(s.range),
    selectionRange: reviveRange(s.selectionRange || s.range),
    children: (s.children || []).map(reviveDocumentSymbol),
  };
}

const extensions = {
  /**
   * The extension gates on `redhat.java` being installed and exposes its `serverReady` /
   * `onDidClasspathUpdate` events. Here that role is played by the jdtls client in Neovim, so this
   * reports it as present and wires the same events to the relay's own signals.
   */
  getExtension(id) {
    if (id !== 'redhat.java') return undefined;
    return {
      id,
      isActive: true,
      exports: javaApi,
    };
  },
};

const javaReady = new EventEmitter();
const classpathUpdated = new EventEmitter();
const projectsImported = new EventEmitter();

const javaApi = {
  serverReady: () => new Promise((resolve) => {
    if (javaApi._ready) return resolve(true);
    javaReady.event(() => resolve(true));
  }),
  onDidClasspathUpdate: classpathUpdated.event,
  onDidProjectsImport: projectsImported.event,
  _ready: false,
};

module.exports = {
  host,
  Position,
  Range,
  Location,
  Uri,
  Diagnostic,
  DiagnosticSeverity,
  MarkdownString,
  Hover,
  SnippetString,
  CompletionItem,
  CompletionItemKind,
  CodeLens,
  RelativePattern,
  EventEmitter,
  ProgressLocation,
  SymbolKind,
  TextDocument,
  workspace,
  window,
  languages,
  commands,
  extensions,
  // Consumed by ../server.js, not by the extension.
  _internal: {
    providers,
    registeredCommands,
    contentProviders,
    selectorMatches,
    openTextDocuments,
    diagnosticCollections,
    events: { onDidOpen, onDidChange, onDidSave, onDidClose, onDidChangeConfig },
    java: { javaReady, classpathUpdated, projectsImported, javaApi },
  },
};
