# ADR-007: SQLite-based tiered cache

## Status

Proposed (supersedes ADR-006)

## Context

ADR-006 introduced a JSON-based persistent cache that stores all parsed `SourceString` data in a single file per workspace. While it eliminated re-parsing across restarts, it has significant scaling problems:

- **Cache files are too large.** For large workspaces the JSON file exceeds 200 MB, making both serialization and deserialization slow.
- **Full bulk write on every save.** The entire cache is re-serialized even when a single file changes.
- **Startup re-hashes every cached file.** The `load()` path reads and SHA-256-hashes every previously-cached file to validate freshness, adding seconds of blocking I/O.
- **All location data is loaded eagerly.** A search typically matches ~100 strings out of hundreds of thousands, yet every `ContentSegment[]` for every string in the workspace is loaded into memory.

## Decision

Replace the single JSON cache file with a **SQLite database** (via `sql.js`, SQLite compiled to WASM) containing three tables that separate concerns by access pattern.

### Schema

```sql
CREATE TABLE files (
    uri   TEXT PRIMARY KEY,
    hash  TEXT NOT NULL
);

CREATE TABLE strings (
    id      INTEGER PRIMARY KEY,
    content TEXT NOT NULL UNIQUE
);

CREATE TABLE locations (
    string_id  INTEGER NOT NULL REFERENCES strings(id),
    file_uri   TEXT NOT NULL REFERENCES files(uri) ON DELETE CASCADE,
    segments   TEXT NOT NULL  -- JSON-encoded ContentSegment[]
);

CREATE INDEX idx_locations_string_id ON locations(string_id);
CREATE INDEX idx_locations_file_uri ON locations(file_uri);
```

### Tiered access pattern

1. **Strings** — loaded in bulk into a `Map<string, number>` (content → id) on first search. This is the only data that must be fully in memory for fuzzy matching. Keying by content enables O(1) dedup when inserting strings from newly-parsed files, and O(1) lookup to resolve matched strings to IDs after `fuzz.extract`.

2. **Files** — keyed lookups (`SELECT hash FROM files WHERE uri = ?`) during incremental parsing to decide whether a file needs re-parsing. Small table, fast reads.

3. **Locations** — queried only after matching, for the small set of matched string IDs: `SELECT * FROM locations WHERE string_id IN (...)`. The top-level `startLine`/`startColumn`/`endLine`/`endColumn` from `SourceString` are derived from the first and last segments at read time, avoiding redundant storage.

### Lifecycle

1. **Extension activates** → register the webview provider. No cache work.
2. **Webview opens** → discover files, populate language counters in the UI.
3. **First search** → open the SQLite database, load and validate the cache (re-read and re-hash files, re-parse stale entries), load the strings table into memory, run the search.
4. **Subsequent searches** → use the in-memory `Map<string, number>`, rely on `FileSystemWatcher` for live invalidation of changed files.

### Staleness detection

Content hashes (SHA-256) remain the staleness mechanism. `mtime` is unreliable across git operations (`checkout`, `stash`, `rebase`) and is not used.

On first search the cache is validated by re-reading and hashing cached files. This is slower than a lazy approach but ensures correctness. If user feedback indicates this is too slow, we can move validation to a background task and serve potentially-stale results while re-validation runs.

### Why SQLite over the original JSON

| Concern | JSON (ADR-006) | SQLite (this ADR) |
|---|---|---|
| Incremental updates | Full rewrite on every save | Scoped `INSERT`/`DELETE` per file |
| Disk size | ~200 MB for large workspaces | Smaller (deduplicated strings, no redundant location fields, SQLite page compression) |
| Startup data loaded | Everything (all strings + all locations) | Strings only; locations loaded on demand |
| Memory for matching | Full `SourceString[]` with all segments | Flat `string[]` (content only) |

### Why not a gzipped flat file for strings

The original proposal in KNOWN_ISSUES.md suggested a `\0`-separated gzipped file for strings. SQLite is preferred because:

- Incremental updates work (insert/delete individual strings) without rewriting the whole file.
- Deduplication is handled by `UNIQUE` constraint.
- Single file to manage instead of coordinating multiple files.
- No custom serialization/deserialization code.

## Consequences

### Positive

- **Much smaller on disk.** String deduplication and separation of location data significantly reduce cache size.
- **Faster startup.** Only strings are loaded into memory; locations are fetched on demand.
- **Incremental saves.** File changes result in scoped database operations, not full rewrites.
- **Lower memory usage.** In-memory representation is `Map<string, number>` instead of `SourceString[]` with full location segments.

### Negative

- **New dependency.** `sql.js` adds a ~1 MB WASM binary. This is consistent with the project's existing use of WASM for tree-sitter (ADR-001) and avoids the native addon packaging issues that would come with `better-sqlite3`.
- **In-memory database.** `sql.js` loads the entire database into an `ArrayBuffer` in memory. For our use case this is acceptable — with deduplicated strings and compact location data, the database should be single-digit MBs, far smaller than the current 200 MB JSON. If this becomes a problem, we can switch to a native SQLite library with platform-specific VSIXs.
- **Async load, sync queries.** The WASM module must be loaded asynchronously, but once initialized, queries are synchronous. Bulk operations (initial load, re-validation) should be chunked to avoid blocking the extension host.
- **Must explicitly persist.** Unlike `better-sqlite3` which writes to disk automatically, `sql.js` requires explicitly exporting the database bytes and writing them to a file. This is handled by the save logic.
- **Schema migration.** Future schema changes require migration logic or a version-check-and-discard strategy (as in ADR-006).

## References

- ADR-006 (the JSON cache this supersedes)
- [sql.js](https://github.com/sql-js/sql.js/) — SQLite compiled to WebAssembly
- [VS Code discussion: Easiest way to use sqlite in vscode extension](https://github.com/microsoft/vscode-discussions/discussions/16)
- [KNOWN_ISSUES.md — Cache section](../KNOWN_ISSUES.md)
