# ADR-005: C/C++ Language Support

## Status

Accepted

## Context

After Python, C and C++ are natural next languages to support. Both are widely used and have string literal syntax that differs significantly from Python. Conveniently, the `tree-sitter-cpp` grammar can parse both C and C++ files, so a single grammar covers both languages.

## Decision

We add a single `LanguageSupport` implementation (`src/languages/cpp.ts`) that handles both C and C++ using the `tree-sitter-cpp` WASM grammar.

### String Node Types

The tree-sitter-cpp grammar produces two distinct string node types:

- **`string_literal`**: Regular string literals with optional encoding prefixes (`L"..."`, `u"..."`, `U"..."`, `u8"..."`). Children include the opening token (with prefix), `string_content` nodes, `escape_sequence` nodes, and the closing `"`.
- **`raw_string_literal`**: Raw string literals (`R"(...)"`  or `R"delim(...)delim"`). Children include the opening `R"`, optional `raw_string_delimiter`, `(`, `raw_string_content`, `)`, optional `raw_string_delimiter`, and closing `"`.

Both are listed in `stringNodeTypes` so the string collector picks them up.

### Escape Sequence Handling

Unlike Python's tree-sitter grammar (where escape sequences are embedded in `string_content`), tree-sitter-cpp emits `escape_sequence` as separate child nodes. We include them as-is (the raw escape text like `\n`, `\t`) since we're doing fuzzy text matching, not escape interpretation. Each escape sequence produces its own `ContentSegment` for accurate source-position mapping.

### Concatenated Strings

C/C++ implicit string concatenation (`"hello" "world"`) produces a `concatenated_string` node with `string_literal` and/or `raw_string_literal` children. Comments (`//` and `/* */`) between parts appear as `comment` children and are silently skipped, matching the Python implementation's behavior.

### File Extensions

The implementation covers both C and C++ extensions: `.c`, `.h`, `.cpp`, `.hpp`, `.cc`, `.cxx`, `.hxx`, `.hh`, `.C`, `.H`. Both `"c"` and `"cpp"` VSCode language IDs are registered.

## Consequences

- C and C++ files are now searchable with a single WASM grammar
- The pluggable architecture (ADR-002) worked as designed — only a new file, a registry line, and a WASM download entry were needed
- Escape sequences are treated as literal text segments, which is the right trade-off for fuzzy string search
