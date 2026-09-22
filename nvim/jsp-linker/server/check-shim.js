'use strict';
/**
 * Checks that vscode-shim covers every editor API `out/` actually reaches for.
 *
 * This is the drift guard. The shim is a compatibility surface against a codebase built and
 * released elsewhere: when a new version of the extension calls a `vscode` API the shim lacks, the
 * .vsix keeps working and only the Neovim build breaks -- and it breaks at runtime, inside whichever
 * provider happened to touch it first, which surfaces as one silently missing feature rather than
 * as an error. Reading the requirement straight out of the compiled source turns that into a
 * build-time failure with the symbol named.
 *
 * Deliberately static: it greps rather than executing, so it covers paths the e2e test never runs
 * (every provider, every diagnostic check), and needs no jdtls and no workspace.
 *
 * Run with: node check-shim.js
 */

const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, 'out');
const shim = require('./vscode-shim');

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : sources(full);
    return e.isFile() && e.name.endsWith('.js') ? [full] : [];
  });
}

/**
 * Strips comments and string literals, so only real code is scanned.
 *
 * Without this the check is useless in exactly the way that gets a check ignored: this codebase
 * documents itself heavily and names APIs in prose (`vscode.DiagnosticCollection#set replaces...`,
 * `vscode.languages.register*Provider`), and it passes jdtls command names as strings
 * (`'vscode.executeWorkspaceSymbolProvider'`, `'vscode.open'`) -- none of which the shim must
 * implement as members. A regex cannot separate those from real calls; a scanner can, because the
 * only question is which state each character is in.
 */
function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') i++;
        i++;
      }
      i++;
      out += '""'; // keep it syntactically inert but non-empty
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const files = sources(OUT);
const text = files.map((f) => stripCommentsAndStrings(fs.readFileSync(f, 'utf8'))).join('\n');

// `vscode.Foo` -> the top-level export; `vscode.Foo.Bar` -> an enum member or static too.
const tops = new Set();
const members = new Map();
for (const m of text.matchAll(/vscode\.([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?/g)) {
  tops.add(m[1]);
  if (m[2]) {
    if (!members.has(m[1])) members.set(m[1], new Set());
    members.get(m[1]).add(m[2]);
  }
}

// Namespace members are reached as `vscode.workspace.findFiles(...)`, already captured above.
// These are the namespaces whose members must exist as functions or properties.
const NAMESPACES = new Set(['workspace', 'window', 'languages', 'commands', 'extensions', 'env']);

const missing = [];

for (const name of [...tops].sort()) {
  if (!(name in shim)) {
    missing.push(`vscode.${name}`);
    continue;
  }
  const value = shim[name];
  for (const member of [...(members.get(name) || [])].sort()) {
    // A class's statics (Uri.file, Uri.parse) and a namespace's members both live on the value.
    // An enum member must be present as a key; `undefined` would silently compare equal nowhere.
    const present = typeof value === 'function' || typeof value === 'object'
      ? member in value || (value && value.prototype && member in value.prototype)
      : false;
    if (!present) {
      missing.push(`vscode.${name}.${member}${NAMESPACES.has(name) ? '()' : ''}`);
    }
  }
}

console.log(`scanned ${files.length} compiled modules`);
console.log(`found ${tops.size} vscode.* symbols, ${[...members.values()].reduce((n, s) => n + s.size, 0)} members`);

if (missing.length) {
  console.error(`\nFAILED: vscode-shim is missing ${missing.length} API(s) the extension uses:\n`);
  for (const m of missing) console.error(`  ${m}`);
  console.error('\nAdd them to vscode-shim/index.js, or the Neovim build will fail at runtime.');
  process.exit(1);
}

console.log('\nOK: vscode-shim covers every API the compiled extension reaches for.');
