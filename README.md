# Fuzzy String Search

> [!IMPORTANT]
> This is a vibe-coded prototype

A Visual Studio Code extension that fuzzy-matches your queries against string literals in source code. It uses [tree-sitter](https://tree-sitter.github.io/) (via WASM) to parse files and extract strings, then scores them with [fuzzball](https://www.npmjs.com/package/fuzzball)'s `partial_ratio` scorer.

Think of it as "grep for string contents" — but fuzzy, so typos and partial matches still find what you're looking for.

## Features

- **Fuzzy string search** — find string literals by approximate content, not exact text
- **Tree-sitter parsing** — accurate extraction of string literals (handles triple-quotes, f-strings, raw strings, byte strings, and concatenated strings)
- **Side panel UI** — dedicated search panel in the activity bar with instant results
- **Click-to-navigate** — click any result to open the file and select the matched portion
- **Match alignment** — results show the matched substring with surrounding context
- **Streaming results** — results appear as files are processed, no waiting for full scan
- **In-memory caching** — parsed strings are cached per-file; automatic invalidation on save, delete, or external changes
- **Configurable** — adjustable score cutoff, result limits, and include/exclude glob filters

## Supported Languages

| Language   | File Extensions                                          | String Types                                                                                                   |
| ---------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Python     | `.py`, `.pyi`                                            | Single/double/triple-quoted, f-strings (interpolation → `{}`), raw strings, byte strings, concatenated strings |
| C/C++      | `.c`, `.h`, `.cpp`, `.hpp`, `.cc`, `.cxx`, `.hxx`, `.hh` | String literals (with `L`/`u`/`U`/`u8` prefixes), raw string literals, escape sequences, concatenated strings  |
| TypeScript | `.ts`, `.mts`, `.cts`                                    | Single/double-quoted strings, template literals (interpolation → `{}`), escape sequences                       |
| TSX        | `.tsx`                                                   | Same as TypeScript, plus JSX contexts                                                                          |
| JavaScript | `.js`, `.mjs`, `.cjs`                                    | Same as TypeScript                                                                                             |
| JSX        | `.jsx`                                                   | Same as TSX                                                                                                    |

Use the **⋯ languages** toggle in the search panel to select which languages to include in searches. The selection is persisted per workspace.

The architecture is pluggable — see [Contributing](#contributing).

## Usage

1. Install the extension
2. Click the **Fuzzy String Search** icon in the activity bar (magnifying glass)
3. Type your query in the search box
4. Click any result to jump to that string in the source file

### Filters

Click **⋯ languages** to choose which languages to search. The selection is saved per workspace.

Click **⋯ filters** below the search box to access:

- **Score cutoff** — minimum match score (0–100, default: 60)
- **Files to include** — glob pattern (e.g., `**/*.py`)
- **Files to exclude** — glob pattern (e.g., `**/tests/**`)

## Configuration

| Setting                                | Default | Description                                             |
| -------------------------------------- | ------- | ------------------------------------------------------- |
| `fuzzyStringSearch.defaultScoreCutoff` | `60`    | Minimum fuzzy match score (0–100) to include in results |
| `fuzzyStringSearch.maxResults`         | `100`   | Maximum number of results to return (0 for unlimited)   |

## How It Works

1. **File discovery** — finds workspace files matching supported language extensions (respects `.gitignore`)
2. **Parsing** — parses each file with tree-sitter and walks the AST to extract string literal nodes
3. **String extraction** — strips quotes and prefixes, replaces f-string interpolations with `{}`, joins concatenated strings
4. **Fuzzy matching** — scores each extracted string against your query using `fuzz.partial_ratio`
5. **Alignment** — locates the best-matching substring for display and click-to-navigate selection

## Contributing

### Adding a New Language

The extension uses a pluggable language support architecture. To add a new language:

1. Create `src/languages/<language>.ts` implementing the `LanguageSupport` interface
2. Register it in `src/languages/registry.ts`
3. Add the tree-sitter WASM grammar to `scripts/download-wasm.ts`

See `src/languages/python.ts` for a reference implementation.

### Development

```bash
# Install dependencies
bun install

# Download tree-sitter WASM files
bun run download-wasm

# Build
bun run build

# Run tests
bun run test

# Lint
bun run lint

# Package as .vsix
bun run package
```

## License

MIT
