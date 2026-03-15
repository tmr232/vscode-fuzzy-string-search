# Changelog

All notable changes to the "Fuzzy String Search" extension will be documented in this file.

## [Unreleased]

### Changed

- Search timings now show wall-clock seconds instead of summed per-worker milliseconds, giving an accurate picture of actual user-experienced latency
- Collect and match phases are now sequential (collect all strings, then match all at once) so each timing reflects true wall time
- Removed streaming results — results are now sent once when the search completes

### Fixed

- Fix search becoming unresponsive after upgrading from a version that used millisecond timings — stale persisted state with old field names crashed the webview script before event listeners were registered

### Added

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
