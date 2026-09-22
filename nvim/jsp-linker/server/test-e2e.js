'use strict';
/**
 * End-to-end check: starts server.js as a real child process, speaks LSP to it over stdio against a
 * throwaway webapp, and asserts it answers. Stands in for the jdtls relay with a canned reply, so
 * the whole path -- activate(), the TLD index, the providers, the shim's diagnostics publishing --
 * runs without needing Neovim or a Java project.
 *
 * Run with: node test-e2e.js
 */

const assert = require('node:assert');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jsp-linker-test-'));
const webapp = path.join(root, 'web', 'src', 'main', 'webapp');
fs.mkdirSync(path.join(webapp, 'WEB-INF'), { recursive: true });
fs.writeFileSync(path.join(root, 'pom.xml'), '<project/>');
fs.writeFileSync(path.join(root, 'web', 'pom.xml'), '<project/>');

fs.writeFileSync(
  path.join(webapp, 'WEB-INF', 'functions.tld'),
  `<?xml version="1.0" encoding="UTF-8"?>
<taglib xmlns="http://java.sun.com/xml/ns/j2ee" version="2.1">
  <short-name>lfn</short-name>
  <uri>http://letterboxd.com/functions</uri>
  <function>
    <name>greet</name>
    <function-class>com.letterboxd.Functions</function-class>
    <function-signature>java.lang.String greet(java.lang.String)</function-signature>
  </function>
</taglib>`,
);

const jspPath = path.join(webapp, 'index.jsp');
fs.writeFileSync(
  jspPath,
  `<%@ taglib prefix="lfn" uri="http://letterboxd.com/functions" %>
<jsp:useBean id="member" class="com.letterboxd.om.Member" scope="request"/>
<p>\${lfn:greet(member.name)}</p>
<%@ include file="/WEB-INF/missing-fragment.jspf" %>
`,
);

const uri = `file://${jspPath}`;

const child = cp.spawn('node', [path.join(__dirname, 'server.js'), '--stdio'], {
  stdio: ['pipe', 'pipe', 'pipe'],
});

let stderr = '';
child.stderr.on('data', (d) => (stderr += d));

function send(msg) {
  const body = JSON.stringify(msg);
  child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

const waiters = [];
let buffer = Buffer.alloc(0);

child.stdout.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;
    const header = buffer.subarray(0, headerEnd).toString();
    const length = Number(/Content-Length: (\d+)/i.exec(header)[1]);
    if (buffer.length < headerEnd + 4 + length) return;
    const msg = JSON.parse(buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString());
    buffer = buffer.subarray(headerEnd + 4 + length);
    dispatch(msg);
  }
});

let lastDiagnostics = [];

function dispatch(msg) {
  if (msg.method === 'textDocument/publishDiagnostics' && msg.params.uri === uri) {
    lastDiagnostics = msg.params.diagnostics;
  }
  // Stand in for Neovim's relay: the extension asks for Java symbols, we answer "nothing found",
  // which is the honest answer here (no jdtls, no Java source) and exercises the abstain path.
  if (msg.method === 'jsp/java') {
    send({ jsonrpc: '2.0', method: 'jsp/javaResult', params: { id: msg.params.id, result: null } });
    return;
  }
  if (msg.method === 'window/logMessage' || msg.method === 'window/showMessage') {
    // JSP_DEBUG=1 surfaces the server's own log, which is where an activate() failure lands.
    if (process.env.JSP_DEBUG) console.log('  LOG:', String(msg.params.message).slice(0, 300));
    return;
  }
  for (let i = 0; i < waiters.length; i++) {
    if (waiters[i].match(msg)) {
      waiters.splice(i, 1)[0].resolve(msg);
      return;
    }
  }
}

function waitFor(match, label, timeout = 45000) {
  return new Promise((resolve, reject) => {
    const w = { match, resolve };
    waiters.push(w);
    setTimeout(() => {
      const i = waiters.indexOf(w);
      if (i !== -1) {
        waiters.splice(i, 1);
        reject(new Error(`timed out waiting for ${label}\nstderr:\n${stderr}`));
      }
    }, timeout);
  });
}

let nextId = 1;
function request(method, params) {
  const id = nextId++;
  const p = waitFor((m) => m.id === id, method);
  send({ jsonrpc: '2.0', id, method, params });
  return p.then((m) => {
    if (m.error) throw new Error(`${method} failed: ${JSON.stringify(m.error)}`);
    return m.result;
  });
}

(async () => {
  const init = await request('initialize', {
    processId: process.pid,
    rootUri: `file://${root}`,
    workspaceFolders: [{ uri: `file://${root}`, name: 'test' }],
    initializationOptions: { settings: {} },
    capabilities: {},
  });
  assert.ok(init.capabilities.definitionProvider, 'definitionProvider advertised');
  assert.ok(init.capabilities.hoverProvider, 'hoverProvider advertised');
  console.log('ok  initialize -> capabilities advertised');

  send({ jsonrpc: '2.0', method: 'initialized', params: {} });

  // The extension validates nothing until jdtls reports ready -- deliberately, so a file is never
  // shown as half-checked (see the isReady() gate in extension.js). Neovim sends this on LspAttach
  // of jdtls; here we stand in for it.
  send({ jsonrpc: '2.0', method: 'jsp/javaReady', params: {} });

  const diagnosticsPromise = waitFor(
    (m) => m.method === 'textDocument/publishDiagnostics' && m.params.uri === uri,
    'publishDiagnostics',
  );

  send({
    jsonrpc: '2.0',
    method: 'textDocument/didOpen',
    params: {
      textDocument: { uri, languageId: 'jsp', version: 1, text: fs.readFileSync(jspPath, 'utf8') },
    },
  });

  await diagnosticsPromise;
  // Each of the seven diagnostics providers publishes independently as it finishes, and LSP
  // replaces a file's whole list per publish -- so the first message says nothing. Settle first.
  await new Promise((r) => setTimeout(r, 2500));
  const published = { params: { diagnostics: lastDiagnostics } };
  console.log(`ok  diagnostics settled (${published.params.diagnostics.length} item(s))`);

  // The include points at a file that does not exist, which is the extension's own broken-link
  // check -- it needs no jdtls at all, so it is the one diagnostic that must appear here.
  const broken = published.params.diagnostics.find((d) => /missing-fragment/.test(d.message));
  assert.ok(broken, `expected a broken-include diagnostic, got: ${JSON.stringify(published.params.diagnostics, null, 2)}`);
  assert.ok(broken.range.start.line === 3, `diagnostic on the include line, got line ${broken.range.start.line}`);
  console.log(`ok  broken include flagged: "${broken.message.slice(0, 70)}..."`);

  // Hover over `lfn:greet` -- resolved from the workspace .tld, no jdtls needed for the function
  // itself, so this proves the TLD index built and the hover provider is wired.
  const hover = await request('textDocument/hover', {
    textDocument: { uri },
    position: { line: 2, character: 9 },
  });
  assert.ok(hover && hover.contents && hover.contents.value, `expected hover, got ${JSON.stringify(hover)}`);
  assert.match(hover.contents.value, /greet|Functions/, 'hover mentions the EL function');
  console.log(`ok  hover on lfn:greet -> "${hover.contents.value.replace(/\n/g, ' ').slice(0, 70)}..."`);

  // Definition on the include path. Target does not exist, so null is correct -- what matters is
  // that the provider ran and the server answered rather than crashing.
  const def = await request('textDocument/definition', {
    textDocument: { uri },
    position: { line: 1, character: 30 },
  });
  console.log(`ok  definition answered (${def === null ? 'null' : `${def.length} location(s)`})`);

  console.log('\nALL CHECKS PASSED');
  child.kill();
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(0);
})().catch((error) => {
  console.error(`\nFAILED: ${error.message}`);
  child.kill();
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(1);
});
