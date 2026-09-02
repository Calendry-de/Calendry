<!-- CODEGRAPH_START -->
## Graft (code graph)

This repo is indexed by [Graft](https://github.com/trailhq/Graft) (`@nanonets/graft`),
a local, regenerable code graph cached under `graft/` (git-ignored; run
`graft build` after cloning to generate your own). Wired via `graft init` on
2026-08-26: MCP server registration in `.mcp.json`, hooks/statusline in
`.claude/settings.json`, and the `graft` skill.

Reach for it BEFORE grep/find or reading files when understanding how
something works, locating code, tracing what calls a symbol, or scoping an
edit. The `graft` skill (auto-loaded whenever `graft/` exists) says this
directly. In practice: `graft ask "<question>"`, `graft callers <symbol>`,
`graft skeleton <file>`, or the MCP tools (`graft_find_code`,
`graft_trace_calls`, `graft_find_all`, `graft_file_api`, `graft_repo_map`,
`graft_check_freshness`) if the MCP server is loaded.

Structural graph (`graft build`) is local/deterministic (tree-sitter only,
no LLM, $0). Deep summaries (`graft build --deep`) call an LLM and need
`GRAFT_PROVIDER`/`GRAFT_API_KEY`/`GRAFT_MODEL` (or CLI flags). See the
gitignored `.env` once configured; never commit a key.

**Installing on Linux (npm global, this machine):** `npm install -g
@nanonets/graft` alone produces a CLI that crashes on every invocation:
npm blocks the native `node-gyp-build` install scripts, so the eagerly
imported tree-sitter grammars have no native build and the top-level import
throws before `--version` can print. Install with the scripts allowed:

    npm install -g --allow-scripts='@nanonets/graft,tree-sitter,tree-sitter-go,tree-sitter-java,tree-sitter-kotlin,tree-sitter-php,tree-sitter-python,@davisvaughan/tree-sitter-r,tree-sitter-typescript,tree-sitter-javascript' @nanonets/graft

`~/.bun/bin` is NOT on PATH here (only `~/.npm-global/bin`), so npm-global
is the working target despite the bun path named in the Windows note below.
`graft init --agents claude --no-build` restores the five wired files
(`.claude/helpers/graft-{hooks,statusline}.cjs`, `.claude/skills/graft/SKILL.md`,
and merge-only edits to `.claude/settings.json` / `.mcp.json`): it merges
rather than overwrites, verified byte-identical against a backup. The
committed config drifted from reality once already: `.claude/settings.json`
and `.mcp.json` were committed while `.claude/helpers/` never was, leaving
every hook and the statusline pointing at absent files and the MCP server
unable to start. **Commit `.claude/helpers/` and `.claude/skills/graft/`
together with the settings, or the wiring is dead on the next checkout.**

**`graft check` reports a false STALE on this repo. Ignore it, don't
"fix" the graph.** It lists ~202 `removed` nodes, every single one a
`.vue` file or Vue symbol and zero non-Vue, immediately after a clean
`graft build`. Cause is a card-naming mismatch inside that one subcommand:
cards are written with the extension stripped (`ManageShell.md`) while node
ids keep it (`app/components/manage/ManageShell.vue`), so reconciliation
can't match any Vue node and calls it deleted. Vue indexing itself is
healthy: `graft ask` and `graft skeleton` both return Vue symbols with
exact spans (`graft skeleton app/pages/login.vue` → 5 functions, ~95%
token saving). Only `graft check` is affected: the statusline reports
`✓ synced`, and neither hook shim calls `check`. Consequence: **do not
wire `graft check` into CI for this repo**: it exits 1 unconditionally.

**Windows-specific note, worth keeping:** `@nanonets/graft` bundles native
tree-sitter grammars for Go/Java/Kotlin/PHP/Python/R/TypeScript, imported
eagerly as static top-level ES imports in `dist/graph/extract.js`: one
failing to load crashes the whole CLI, even though the languages that
matter here (TypeScript, JavaScript, Vue SFCs, via a WASM container tier
that unwraps `<script>` and feeds it to the TS grammar) load fine.
`tree-sitter-kotlin` has no Windows prebuild and needs a full C++ toolchain
to compile from source; `tree-sitter-r` failed to fetch its Windows
prebuild. Patched locally (not upstream) by wrapping those two imports in a
`createRequire`-based try/catch defaulting to `null`. This is safe, because
`GRAMMARS[lang]` is only dereferenced for a file extension actually seen,
and this repo has no `.kt`/`.r` files. The patch lives in the global
install (`~/.bun/install/global/node_modules/@nanonets/graft/dist/graph/extract.js`)
and will need reapplying after `graft upgrade` on Windows until upstream
ships Windows prebuilds for those two grammars or lazy-loads per language.
<!-- CODEGRAPH_END -->

## `npx skills add` touches files outside the skill it installs

Same hazard class as the `--fix` tooling rule in the root `CLAUDE.md`: the
installer edits repo-wide state, not just its own skill directory. Observed
on 2026-08-26 installing seven skills, all three side effects unrequested:

1. **Deleted every pre-existing `.agents/skills/*/SKILL.md`** (all seven
   design skills), orphaning the `.claude/skills/*` symlinks that point
   into `.agents/`. Recover with `git restore --staged --worktree .agents/`.
2. **Stripped `/.agents/` and `/.claude/` from `.gitignore`**, silently
   reversing this repo's "agent tooling is not committed" policy. Those two
   directories are deliberately ignored while a few files inside them
   (`.claude/CLAUDE.md`, `.claude/settings.json`, `.agents/skills/*`) are
   force-added, so committing new files under them needs `git add -f`.
3. **Ran a broad `git add`**, staging unrelated pre-existing working-tree
   changes. Clear with `git reset`.

So: `git status` before and after, revert what you didn't ask for, and
verify every symlink still resolves to a real `SKILL.md`: a broken one
fails silently, the skill just stops being offered. Also note `--skill`
takes **space-separated** names; a comma-separated list matches nothing and
the CLI falls back to merely listing the repo's skills, which looks like
success.
