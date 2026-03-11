# Fuzzy String Grep

A VSCode extension that fuzzy-matches user queries against string literals in source code, using tree-sitter for parsing and fuzzball for matching.

## Features

- Parse source files with tree-sitter to extract string literals
- Fuzzy-match queries against extracted strings using fuzzball
- Side panel UI similar to VSCode's built-in search
- Configurable score cutoff and result limits
- Per-file caching for fast repeated searches

## Supported Languages

- Python (MVP)

## Development

```bash
# Install dependencies
bun install

# Build
bun run build

# Run tests
bun run test

# Lint
bun run lint
```

## License

MIT
