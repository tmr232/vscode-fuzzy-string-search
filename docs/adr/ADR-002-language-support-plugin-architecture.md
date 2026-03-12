# ADR-002: Language Support Plugin Architecture

## Status

Accepted

## Context

The extension needs to support multiple programming languages for string extraction. Each language has different string syntax (quotes, prefixes, interpolation, concatenation) and different tree-sitter node types. We need an architecture that makes adding new languages straightforward without modifying core parsing or matching logic.

## Decision

We adopt a **plugin-style interface** (`LanguageSupport`) with a **central registry**.

### LanguageSupport Interface

Each language provides:

- **Metadata**: `languageId`, `fileExtensions`, `vscodeLanguageIds`, `wasmFileName`
- **Node types**: `stringNodeTypes` and `concatenatedStringNodeTypes` — the tree-sitter node types that the string collector should look for
- **Extractors**: `extractStringContent(node)` and `extractConcatenatedString(node)` — functions that convert raw AST nodes into plain string content

### Registry

A central `registry.ts` file registers all language implementations and provides lookup by file extension, VSCode language ID, or language ID. Adding a new language requires only:

1. Creating a new file in `src/languages/` that exports a `LanguageSupport` object
2. Importing and calling `register()` in `registry.ts`
3. Downloading the corresponding `.wasm` file

### String Content Extraction

String extraction follows the pattern from the reference Python project (`source-strings`):

- **Simple strings**: Extract `string_content` children, replace `interpolation` nodes with `{}` placeholders
- **Concatenated strings**: Extract each child `string` node and join the results
- **Comments inside concatenations**: Silently skipped (they appear as children of `concatenated_string` in Python)

The `source` parameter was dropped from `extractStringContent` and `extractConcatenatedString` because tree-sitter-python v0.25+ provides structured children (`string_start`, `string_content`, `string_end`, `interpolation`) that give us the content directly via `node.text`, without needing byte-range slicing into the source.

## Consequences

- Adding a new language is a localized change (one new file + one registry line + WASM download)
- The string collector and search engine remain language-agnostic
- Each language can handle its own string syntax quirks (f-strings, raw strings, template literals, etc.)
- The interface is simple enough to implement but flexible enough for diverse language grammars
