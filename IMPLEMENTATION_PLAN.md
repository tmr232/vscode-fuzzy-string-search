# Implementation Plan: VSCode Fuzzy String Search

A VSCode extension for fuzzy-matching against strings in source code, using tree-sitter for parsing and fuzzball for matching. Modeled after the [source-strings](file:///C:/Code/github.com/tmr232/source-strings/) Python CLI tool.

---

## Phase 1: Project Scaffolding

- [x] **1.1** Initialize project with `bun init`, configure `package.json` with VSCode extension fields (`engines.vscode`, `activationEvents`, `contributes`, `main: ./out/extension.js`)
- [x] **1.2** Install and configure TypeScript (`tsconfig.json`: strict, ES2022, NodeNext, outDir `./out`, rootDir `./src`)
- [x] **1.3** Set up esbuild for extension bundling (Node target, `vscode` as external)
- [x] **1.4** Install and configure vitest (`vitest.config.ts`, `test` script in `package.json`)
- [x] **1.5** Install and configure biome.js (`biome.json`) and oxlint for linting/formatting
- [x] **1.6** Create `.gitignore` (node_modules, out, .vscode-test, wasm/*.wasm)
- [x] **1.7** Create `.vscodeignore` to exclude dev files from packaged extension
- [x] **1.8** Create initial `src/extension.ts` with empty `activate`/`deactivate`
- [x] **1.9** Create directory structure:
  - `src/languages/` — language support modules
  - `src/parsing/` — tree-sitter parsing logic
  - `src/matching/` — fuzzy matching logic
  - `src/cache/` — per-file string cache
  - `src/views/` — side panel UI
  - `src/types.ts` — shared types/interfaces
  - `test/fixtures/` — test source files
  - `scripts/` — automation scripts
  - `wasm/` — bundled .wasm files
  - `docs/adr/` — architecture decision records
- [x] **1.10** Create `README.md` and `CHANGELOG.md`

## Phase 2: Pre-commit & CI

- [x] **2.1** Create `.pre-commit-config.yaml` with:
  - biome (formatting + linting)
  - `https://github.com/tmr232/precommit-ad-blocker/` (default config)
  - `https://github.com/zizmorcore/zizmor-pre-commit` (GitHub Actions security)
  - `https://github.com/tmr232/ratchet-pre-commit` (pin GitHub Actions versions)
- [x] **2.2** Run `prek install` to activate hooks
- [x] **2.3** Create GitHub Actions workflow: **build & test** (on push/PR)
  - Checkout, install bun, install deps, lint, build, test
- [x] **2.4** Create GitHub Actions workflow: **publish** (on release tag)
  - Build, package with `vsce`
  - Publish to VSCode Marketplace
  - Publish to Open VSX Registry
- [x] **2.5** Pin all GitHub Actions versions using ratchet

## Phase 3: Tree-Sitter Integration

- [x] **3.1** Install `web-tree-sitter` (`bun add web-tree-sitter`)
- [x] **3.2** Create `scripts/download-wasm.ts` to download language `.wasm` files from npm packages
  - Accept language name as argument, map to npm package
  - Also copies `web-tree-sitter.wasm` runtime
  - Save to `wasm/` directory
  - Start with `tree-sitter-python`
  - Add `download-wasm` script to `package.json`
- [x] **3.3** Run the download script to fetch `tree-sitter-python.wasm`
- [x] **3.4** Create `src/parsing/parser-manager.ts`:
  - `Parser.init()` at extension activation
  - Load `.wasm` files from configurable directory
  - Cache initialized `Language` objects per wasm path
- [x] **3.5** Write ADR-001: Use web-tree-sitter (WASM) over native node bindings

## Phase 4: Language Support Architecture

- [x] **4.1** Define `LanguageSupport` interface in `src/languages/language-support.ts`:
  ```typescript
  interface LanguageSupport {
    languageId: string;
    fileExtensions: string[];
    vscodeLanguageIds: string[];
    wasmFileName: string;
    stringNodeTypes: string[];
    concatenatedStringNodeTypes: string[];
    extractStringContent(node: Node): string;
    extractConcatenatedString(node: Node): string;
  }
  ```
- [x] **4.2** Create language registry in `src/languages/registry.ts`:
  - Register `LanguageSupport` implementations
  - Lookup by file extension or VSCode language ID
  - `getLanguageForFile(filename: string): LanguageSupport | undefined`
- [x] **4.3** Implement Python support in `src/languages/python.ts`:
  - String node types: `string`, `concatenated_string`
  - Handle: single/double/triple quotes, f-strings (interpolation → `{}`), raw strings, byte strings
  - Concatenated strings: recursively extract and join child strings
  - Skip `comment` nodes
- [x] **4.4** Register Python in the registry
- [x] **4.5** Write ADR-002: Language support plugin architecture

## Phase 5: String Collection

- [x] **5.1** Define `SourceString` type in `src/types.ts`:
  ```typescript
  interface SourceString {
    content: string;
    filePath: string;
    startLine: number;    // 0-indexed
    startColumn: number;
    endLine: number;
    endColumn: number;
  }
  ```
- [x] **5.2** Create `src/parsing/string-collector.ts`:
  - Use `TreeCursor` for efficient tree traversal (visitor pattern, matching source-strings approach)
  - Walk tree, collect string nodes via `LanguageSupport` interface
  - Return `SourceString[]`
- [x] **5.3** Write tests: `test/parsing/string-collector.test.ts`
  - Fixture: `test/fixtures/sample.py` with varied string types
  - Test simple strings, triple-quoted, concatenated, f-strings, nested strings
- [x] **5.4** Write tests: `test/parsing/python-strings.test.ts`
  - Unit-test Python `extractStringContent` and `extractConcatenatedString` directly
  - Verify quote stripping, prefix handling, interpolation placeholders

## Phase 6: Fuzzy Matching

- [x] **6.1** Install fuzzball (`bun add fuzzball`)
- [x] **6.2** Create `src/matching/fuzzy-matcher.ts`:
  - Use `fuzz.partial_ratio` as scorer (matching source-strings' `rapidfuzz.fuzz.partial_ratio`)
  - `fuzz.extract(query, sourceStrings, { scorer: fuzz.partial_ratio, processor, cutoff, limit })`
  - Processor function extracts `.content` from `SourceString`
  - Return results sorted by score
- [x] **6.3** Write tests: `test/matching/fuzzy-matcher.test.ts`
  - Exact match → score 100
  - Partial match → expected range
  - Below cutoff → excluded
  - Empty query → no results
  - Unicode strings
- [x] **6.4** Write ADR-003: Choice of partial_ratio scorer and fuzzball library

## Phase 7: File Discovery & Caching

- [x] **7.1** Create `src/files/file-discovery.ts`:
  - Use `workspace.findFiles(includePattern, excludePattern)`
  - `.gitignore` respected by default (VSCode API does this)
  - Filter by supported languages via registry
- [x] **7.2** Create `src/cache/string-cache.ts`:
  - In-memory `Map<string, SourceString[]>` keyed by file URI
  - `get(uri)` / `set(uri, strings)` / `invalidate(uri)` / `clear()`
- [x] **7.3** Wire up cache invalidation:
  - Listen to `workspace.onDidSaveTextDocument` → invalidate cache for that file
  - Listen to `workspace.onDidDeleteFiles` → remove from cache
  - `FileSystemWatcher` for external changes (e.g. git checkout, other editors)

## Phase 8: Search Engine (Orchestration)

- [x] **8.1** Create `src/search/search-engine.ts`:
  - Accepts: query, scoreCutoff, includeGlob, excludeGlob
  - Pipeline: discover files → for each file: check cache → parse if needed → cache strings → fuzzy match → collect results
  - Return all results sorted by score (across files)
- [x] **8.2** Implement parallel file processing:
  - Process files concurrently (e.g., `Promise.all` with concurrency limit)
  - Yield results incrementally (via callback or async generator) so UI updates as results arrive
- [x] **8.3** Implement cancellation:
  - Accept `CancellationToken` (VSCode API)
  - Check token before processing each file
  - Pass `AbortController` to fuzzball's `extractAsPromised` for mid-search cancellation
- [x] **8.4** Write integration tests: `test/search/search-engine.test.ts`
  - Given fixture files, verify end-to-end search returns expected results

## Phase 9: VSCode Side Panel UI

- [x] **9.1** Register a `ViewContainer` in `package.json` (`contributes.viewsContainers.activitybar`)
- [x] **9.2** Register a `TreeView` or `WebviewView` in the container
- [x] **9.3** Create `src/views/search-panel.ts`:
  - Input fields: query text, score cutoff (number), files to include (glob), files to exclude (glob)
  - Results list: file path, line number, matched string content, score
  - Clicking a result opens the file at the matched location
- [x] **9.4** Wire the panel to the search engine:
  - On input change (debounced), trigger search
  - Show results as they arrive (streaming)
  - Show a progress indicator during search
  - Allow cancellation (user types new query → cancel previous search)
- [x] **9.5** Add configuration settings in `package.json` (`contributes.configuration`):
  - `fuzzyStringGrep.defaultScoreCutoff` (default: 60)
  - `fuzzyStringGrep.maxResults` (default: 100)

## Phase 10: Extension Packaging & WASM Bundling

- [x] **10.1** Configure esbuild/webpack to copy `.wasm` files into the output bundle
- [x] **10.2** Ensure `tree-sitter.wasm` (from web-tree-sitter) is included in the extension package
- [x] **10.3** Ensure language `.wasm` files (from `wasm/`) are included in the extension package
- [x] **10.4** Update `.vscodeignore` to include necessary wasm files but exclude source/test files
- [x] **10.5** Test packaging with `vsce package` (or `bun run vsce package`)
- [x] **10.6** Test installing the packaged `.vsix` in VSCode

## Phase 11: Polish & Documentation

- [ ] **11.1** Ensure all linters (biome + oxlint) pass cleanly
- [ ] **11.2** Ensure all tests pass
- [ ] **11.3** Write `README.md`: features, usage, configuration, supported languages
- [ ] **11.4** Update `CHANGELOG.md` with initial release notes
- [ ] **11.5** Create `AGENTS.md` with project conventions for LLM agents
- [ ] **11.6** Verify pre-commit hooks run correctly
- [ ] **11.7** Verify GitHub Actions workflows run correctly
- [ ] **11.8** Tag v0.1.0 and test the publish workflow

---

## Future Work (Post-MVP)

- [x] Add C++ language support (`tree-sitter-cpp`)
- [ ] Add more languages (JavaScript, TypeScript, Go, Rust, etc.)
- [ ] Persistent cache (survive extension restarts)
- [ ] Workspace symbol provider integration
- [ ] Result highlighting in editor decorations
- [ ] Settings for choosing scorer (partial_ratio, token_set_ratio, etc.)
- [x] Print timings — how long to collect all the strings, how long to match
- [x] Group results by file
- [x] Persist results when hiding and re-opening the search view
- [x] Search in current file
- [x] Show results as they are found (streaming/incremental UI updates)
- [x] Better icon (distinct from the built-in search icon)
- [x] Verify pre-commit hooks in CI
- [x] Run zizmor as a GitHub Action instead of a pre-commit hook
- [x] Remove unneeded `.gitkeep` files
- [ ] Fix the timers - they are currently inconsistent.
