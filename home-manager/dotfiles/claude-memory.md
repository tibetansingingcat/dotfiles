@RTK.md

# Tool preferences

Three MCP servers / skills are always installed (see
`home-manager/claude-code.nix`). They are cheaper and more accurate than the
generic alternatives, but only if reached for *first* — not after grep has
already burned the context.

## Serena — code navigation, over grep/Read

For any question about **code in the current project**, use Serena before
`Grep`/`Glob`/full-file `Read`:

- Finding a definition → `find_symbol`, not `grep "def foo"`
- What calls this → `find_referencing_symbols`, not `grep -rn "foo("`
- What's in this file/package → `get_symbols_overview`, not reading the file
- Renaming or rewriting a whole function → `rename_symbol` /
  `replace_symbol_body`

Serena is language-server-backed, so it returns *resolved* symbols instead of
textual guesses, and reads only the ranges it needs.

Setup order matters: call `initial_instructions` at the start of a coding task,
and `activate_project` if the project isn't active yet. If the language server
can't index the project (unsupported language, broken build), say so and fall
back to grep — don't silently retry.

Grep is still correct for non-code text: logs, configs, comments, string
literals, `.md`, and "where is this magic string" hunts.

## Cellar — JVM dependency APIs, over unzipping jars

For the public API of a **JVM dependency** (Scala 3, Scala 2, Java) — type
signatures, members, docs, source — use the `cellar` skill.

Never unzip, `javap`, or extract a jar to find a signature. Cellar queries any
published Maven artifact without a project import.

`cellar get-external` is the right call even when a Metals/Serena LSP is
running: the LSP covers *this project's* symbols, cellar covers *dependencies*.

## Context7 — library docs, over recall or web search

Before writing code against a **third-party library, framework, SDK, CLI, or
cloud service**, fetch its docs: `resolve-library-id` then `query-docs`.

Do this even for libraries that feel familiar (React, Django, Spring, Tailwind,
boto3) — training data lags releases, and a confidently wrong API call costs
more than the lookup.

Not for: refactoring, business-logic debugging, general language questions, or
code that touches no external dependency.

# Anthropic APIs

For anything Claude/Anthropic-specific — model IDs, pricing, token limits,
prompt caching, tool use — read the `claude-api` skill rather than answering
from memory. Model lineups change faster than training data.
