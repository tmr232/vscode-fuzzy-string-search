# Changelog

All notable changes to the "Fuzzy String Search" extension will be documented in this file.

## [Unreleased]

### Changed

- **Replaced JSON persistent cache with SQLite-based tiered cache (ADR-007):** the single JSON cache file is replaced by a SQLite database (via sql.js/WASM) with three tables — `files` (URI + hash), `strings` (deduplicated content), and `locations` (segments per file). This dramatically reduces disk size, enables incremental updates per file, and loads only string content into memory for matching (locations are queried on demand for matched results only).
- **Lazy cache lifecycle:** the extension no longer loads the persistent cache on activation. The SQLite database is opened and validated on the first search, reducing activation time to near-zero.
- **Fuzzy matcher operates on plain strings:** `fuzzyMatch` now accepts `string[]` instead of `SourceString[]`, returning `ScoredContentMatch[]` (`{ content, score }`). Location data is resolved only for the ~100 matched strings, not loaded for all candidates.
- **Search results use `SearchMatch` type:** results now carry `{ content, filePath, segments, score }` with `startLine`/`endLine` derived from segments at display time, rather than storing redundant top-level position fields.
- Output channel logs now show a detailed parsing timing breakdown: tree-sitter parsing time vs. string collection time (cumulative across files), in addition to the existing overall collection time
- Persistent cache is now saved eagerly after the first search and periodically (every 10 minutes) when modified, instead of only at deactivation — this prevents cache loss if VS Code crashes or the extension host is killed
- Persistent cache writes are now atomic (write-to-temp + rename) to prevent corruption from crashes mid-write
- Added diagnostic logging for persistent cache operations (load path, load/save outcomes) to the output channel
- Search timings now show wall-clock seconds instead of summed per-worker milliseconds, giving an accurate picture of actual user-experienced latency
- Collect and match phases are now sequential (collect all strings, then match all at once) so each timing reflects true wall time
- Removed streaming results — results are now sent once when the search completes

### Fixed

- Fix search becoming unresponsive after upgrading from a version that used millisecond timings — stale persisted state with old field names crashed the webview script before event listeners were registered
- Files that fail to read or parse are now remembered in the in-memory cache so they are not retried on subsequent searches (failed entries are not persisted to disk)

### Added

- New dependency: `sql.js` (SQLite compiled to WASM, ~1 MB) — consistent with the project's existing WASM approach for tree-sitter
- TypeScript/TSX language support: single/double-quoted strings and template literals (interpolation → `{}`), escape sequences — via the `tree-sitter-typescript` grammar
- JavaScript/JSX language support: same string handling as TypeScript, using the TypeScript grammar (which is a superset)
- Language selector in the search panel: collapsible "⋯ languages" section with per-language checkboxes to control which languages are searched; selection is persisted per workspace via `workspaceState`
- New languages added in future updates are enabled by default
- File counts next to each language in the language selector — shows how many workspace files match each language when the languages section is expanded
- Parse failure indicators: after a search, files that failed to read or parse are shown as a red count in the status line (e.g. "5 results · 2 files failed to parse") and per-language in the language selector (e.g. "⚠ 1 failed")
- Persistent string cache: parsed strings are saved to disk on deactivation and restored on startup, eliminating the slow first-search penalty after editor restarts (files are validated by content hash to ensure correctness)
- Parsing progress indicator: shows "Collecting strings x/n files" in the status area while files are being parsed
- "Group by file" checkbox in the search panel — when checked, results are grouped under file headers; when unchecked (default), results are shown as a flat list sorted by score
- C/C++ language support: regular string literals (with `L`/`u`/`U`/`u8` prefixes), raw string literals (`R"(...)"`), escape sequences, and concatenated strings (including with comments between parts) — all via the `tree-sitter-cpp` grammar
- CI workflow now packages and uploads the `.vsix` as a build artifact

## [0.1.0] - 2026-03-14

### Added

- Side panel UI in the activity bar with search input, collapsible filters (score cutoff, include/exclude globs), and clickable results
- Tree-sitter integration via `web-tree-sitter` (WASM-based) for accurate source code parsing
- Python language support: single/double/triple-quoted strings, f-strings (interpolation → `{}`), raw strings, byte strings, and concatenated strings
- Fuzzy matching using fuzzball's `partial_ratio` scorer with configurable score cutoff
- Match alignment display: shows the matched substring with surrounding context and ellipsis
- Click-to-navigate: clicking a result opens the file and selects the matched portion of the string
- Streaming results: results appear incrementally as files are processed
- In-memory per-file string cache with automatic invalidation on save, delete, and external file changes
- Concurrent file processing with configurable concurrency limit
- Search cancellation when the query changes mid-search
- Configuration settings: `fuzzyStringSearch.defaultScoreCutoff` (default: 60), `fuzzyStringSearch.maxResults` (default: 100)
- Pluggable language support architecture — new languages require only a `LanguageSupport` implementation and registry entry
- Pre-commit hooks via prek (biome, ad-blocker, zizmor, ratchet-pin)
- GitHub Actions CI workflow (lint, build, test on push/PR)
- GitHub Actions publish workflow (VSCode Marketplace + Open VSX on tag)
