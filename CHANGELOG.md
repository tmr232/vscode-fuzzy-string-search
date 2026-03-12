# Changelog

All notable changes to the "Fuzzy String Grep" extension will be documented in this file.

## [Unreleased]

- Initial project scaffolding
- Add pre-commit hooks via prek (biome, ad-blocker, zizmor, ratchet-pin)
- Add GitHub Actions CI workflow (lint, build, test on push/PR)
- Add GitHub Actions publish workflow (VSCode Marketplace + Open VSX on tag)
- Pin all GitHub Actions versions with ratchet
- Add `@vscode/vsce` and `ovsx` as dev dependencies
- Add tree-sitter integration via `web-tree-sitter` (WASM-based)
- Add `tree-sitter-python` grammar as a dependency
- Create `scripts/download-wasm.ts` to copy language WASM files into `wasm/`
- Create `src/parsing/parser-manager.ts` for tree-sitter initialization, language loading, and parser creation
- Add ADR-001: Use web-tree-sitter (WASM) over native node bindings
- Define `LanguageSupport` interface for pluggable language support
- Create language registry with lookup by file extension, VSCode language ID, or language ID
- Implement Python language support (string extraction for all quote styles, f-strings, raw/byte strings, concatenated strings)
- Add ADR-002: Language support plugin architecture
- Create `src/parsing/string-collector.ts` — TreeCursor-based AST visitor that collects string literals via the LanguageSupport interface
- Add tests for string collection (`test/parsing/string-collector.test.ts`) and Python string extraction (`test/parsing/python-strings.test.ts`)
