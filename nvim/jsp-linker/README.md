# jsp-linker.nvim

The Letterboxd JSP-Java Linker (a VSCode extension) running under Neovim as an LSP server.

Jump from a Java reference inside a JSP to its Java source, hover it, complete tag attributes, and
get the extension's diagnostics -- broken includes, unbound taglib prefixes, unknown EL variables,
bean property checks. `UPSTREAM-README.md` documents what it links and why; all of it applies here.

## How it works

The extension is **not ported**. `server/out/` is its compiled output, copied verbatim and never
edited -- about 11,300 lines, of which roughly 6,000 (the JSP and EL scanners, the TLD parser,
`javaSymbols`) never touch the editor API at all.

Three pieces make it run here:

| Piece | Job |
|---|---|
| `server/vscode-shim/` | A `vscode` module backed by `vscode-languageserver`. The extension's 23 editor-API symbols, nothing more. |
| `server/server.js` | LSP server. Turns the providers the extension registers into LSP responses. |
| `lua/jsp-linker/` | Starts the server, relays its Java questions to jdtls, adds the commands. |

`require("vscode")` resolves to the shim through a `file:` dependency in `server/package.json`, so
upstream's own files stay byte-identical. Re-copying a newer `out/` is a copy, not a merge.

## The jdtls relay

The extension resolves every Java symbol through jdtls rather than parsing Java itself. A standalone
server cannot reach the jdtls running under `nvim-jdtls`, and starting a second one would mean a
second full Eclipse workspace index of the same project. So Neovim relays:

```
extension --(jsp/java notification)--> server --> Neovim --> jdtls client
extension <--(jsp/javaResult)--------- server <-- Neovim <-- jdtls client
```

A notification pair, not a server-to-client request: Neovim answers those from the handler's return
value, synchronously, so a jdtls round trip made that way would block the editor for the length of a
workspace-symbol search -- and the extension issues these eight at a time.

A relay that fails or times out returns `undefined`, which is the extension's own
"abstain rather than guess wrong" contract. So a suspended jdtls (`:JdtlsStop`) degrades to
"cannot tell", never to a wrong answer.

## Diagnostics need jdtls

The extension publishes **no diagnostics at all** until jdtls reports ready -- deliberately, so a
file is never shown as half-checked (see the `isReady()` gate in `out/extension.js`). Hover and
go-to-definition still work without it. If diagnostics never appear, check `:LspInfo` for a jdtls
client; `:JdtlsStop` suppresses them by design.

## Commands

| Command | Does |
|---|---|
| `:JspCheckAll` | Check every JSP and TLD in the workspace |
| `:JspRevalidate` | Clear Java symbol caches and revalidate open files |
| `:JspOpenGeneratedJava` | Open the Jasper-generated Java for this JSP |
| `:JspOpenGeneratedClass` | Open the Jasper-generated class |
| `:JspLinkerRestart` | Restart the server |

## Configuration

Settings are the extension's own, passed through from `lua/plugins/jsp-linker.lua`. Anything the
workspace's `.vscode/settings.json` sets goes there under the same keys -- `elBindingTags` (custom
tags that declare a scoped variable, e.g. Supermodel's `sm:set`/`sm:forEach`), `exclude`,
`compilerRecognizedElFunctions`. `UPSTREAM-README.md` and the extension's `package.json` document
each one.

## Tests

```sh
cd server && node test-e2e.js
```

Starts the server as a real child process, speaks LSP to it against a throwaway webapp, and asserts
it publishes a broken-include diagnostic and hovers an EL function. The jdtls relay is stubbed, so
no Java project is needed.

## Updating the extension

```sh
unzip -o vscode-jsp-linker-X.Y.Z.vsix -d /tmp/ext
rm -rf server/out && cp -R /tmp/ext/extension/out server/out
rm -rf server/out/__tests__ server/out/el/__tests__
cd server && node test-e2e.js
```

If a new version reaches for an editor API the shim lacks, the server logs
`unhandled executeCommand:` or throws on activate -- both land in `:LspLog`.

## Known gaps

- `createFileSystemWatcher` is a no-op. A `.tld` edited outside Neovim is not noticed until
  `:JspLinkerRestart`. Editing one *in* Neovim is fine.
- `withProgress` degrades to a single message, so `:JspCheckAll` reports no incremental progress.
- `server/out/` is compiled JavaScript. The TypeScript sources live in the extension's own repo,
  which is where any real change belongs -- not here.
