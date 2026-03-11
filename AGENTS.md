# Agent Instructions: vscode-fuzzy-string-grep

## Project Overview

A VSCode extension that fuzzy-matches user queries against string literals in source code, using tree-sitter for parsing and fuzzball for matching.

## Key Conventions

### Package Manager
- **Always use `bun`** — never `npm`, `npx`, `yarn`, or `pnpm`.
- Use `bun add` to install packages, `bun run` to run scripts.
- Prefer `bun run <script>` over `bunx`. All tools should be added as project dependencies.

### Language & Build
- TypeScript, strict mode.
- Bundled with esbuild (Node target, `vscode` external).
- Output goes to `./out`.

### Testing
- Use **vitest** for all tests.
- Test files go in `test/` mirroring `src/` structure.
- Fixture files (sample source code for parsing tests) go in `test/fixtures/`.

### Linting & Formatting
- **biome.js** for formatting and linting.
- **oxlint** as an additional linter.
- Both must run clean (no warnings, no errors).

### Pre-commit
- Managed by **prek** (https://prek.j178.dev/), not pre-commit (Python).
- Config is in `.pre-commit-config.yaml` (prek is compatible with the same format).

### Tree-Sitter
- Use **web-tree-sitter** (WASM-based), not native node bindings.
- Language `.wasm` files live in `wasm/` and are downloaded via `scripts/download-wasm.ts`.
- The `tree-sitter.wasm` runtime file comes from the `web-tree-sitter` npm package.

### Fuzzy Matching
- Use **fuzzball** (`https://www.npmjs.com/package/fuzzball`).
- Default scorer: `fuzz.partial_ratio` (matches the source-strings project's use of `rapidfuzz.fuzz.partial_ratio`).

### Architecture
- **Language support is pluggable**: each language implements the `LanguageSupport` interface and is registered in `src/languages/registry.ts`.
- Adding a new language should require only: (1) a new file in `src/languages/`, (2) registering it in the registry, (3) downloading the `.wasm` file.
- MVP supports **Python only**; code must be structured for easy extension.

### File Layout
```
src/
  extension.ts              # Entry point
  types.ts                  # Shared types (SourceString, etc.)
  languages/
    language-support.ts     # LanguageSupport interface
    registry.ts             # Language registry (single registration point)
    python.ts               # Python implementation
  parsing/
    parser-manager.ts       # Tree-sitter init & language loading
    string-collector.ts     # Tree traversal → SourceString[]
  matching/
    fuzzy-matcher.ts        # fuzzball wrapper
  cache/
    string-cache.ts         # Per-file in-memory cache
  files/
    file-discovery.ts       # workspace.findFiles wrapper
  search/
    search-engine.ts        # Orchestrates: discover → parse → match → results
  views/
    search-panel.ts         # Side panel UI
test/
  fixtures/                 # Sample .py files etc.
  parsing/
  matching/
  search/
scripts/
  download-wasm.ts          # Download .wasm from GitHub releases
wasm/                       # Downloaded .wasm files (gitignored, downloaded on build)
docs/adr/                   # Architecture Decision Records
```

### Documentation
- Architecture decisions go in `docs/adr/` as numbered markdown files (ADR-001, ADR-002, etc.).
- User-facing changes go in `CHANGELOG.md`.
- Agent-relevant conventions stay in this file (`AGENTS.md`).

### CI/CD
- GitHub Actions for build, test, publish.
- Publish to both VSCode Marketplace and Open VSX.
- All GitHub Actions must have pinned versions (enforced by ratchet pre-commit hook).
- GitHub Actions security checked by zizmor pre-commit hook.

### Reference Project
- The Python CLI tool at `C:\Code\github.com\tmr232\source-strings\` is the reference implementation.
- Its `collect_strings.py` shows the tree-sitter visitor pattern for Python string extraction.
- Its `main.py` shows the fuzzy matching pipeline using `rapidfuzz.fuzz.partial_ratio`.
