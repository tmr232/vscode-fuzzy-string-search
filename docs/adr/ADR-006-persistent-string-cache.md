# ADR-006: Persistent string cache across restarts

## Status

Accepted

## Context

The extension parses all workspace files with tree-sitter on the first search after every editor/extension restart. For large workspaces this takes several seconds (tree-sitter parsing is the bottleneck). The in-memory `StringCache` avoids re-parsing between searches within a session, but provides no benefit across restarts.

Users experience a slow first search every time they open VS Code, even when no files have changed since the last session.

## Decision

Persist the in-memory `StringCache` to disk as JSON, stored in the extension's `globalStorageUri` directory. Each cached entry includes a SHA-256 content hash of the file at parse time. On startup, entries are validated by re-reading and hashing the file — only entries whose hash still matches are restored.

### Key design choices

**Storage format: JSON over SQLite.** The access pattern is bulk-read-on-activate, bulk-write-on-deactivate. JSON excels at this. SQLite would add a native dependency (problematic for cross-platform VSIX packaging) or a ~1MB WASM bundle, with no benefit for our access pattern.

**Staleness detection: content hash over mtime.** File modification times are unreliable across `git checkout`, `git stash`, branch switches, and some filesystems. SHA-256 of file content is definitive. The cost is reading each cached file at startup to hash it, but this is much faster than re-parsing with tree-sitter.

**Schema versioning: discard on mismatch.** The cache file includes a `version` field. If the version doesn't match the expected value, the entire cache is discarded. No migration code — re-parsing is always a correct fallback. This avoids the class of bugs we encountered with stale persisted webview state.

**Cleanup: self-cleaning with age-based pruning.** Within a workspace, dead entries are naturally pruned by the save/load cycle (deleted files aren't in the in-memory cache at save time; unreadable files are skipped at load time). Across workspaces, stale cache files older than 30 days are pruned on activation.

**Non-blocking load.** Cache loading runs asynchronously on activation. Searches that start before loading completes simply re-parse files as before (graceful degradation).

### File layout

```
<globalStorageUri>/
  cache/
    <workspaceHash>.json    # One file per workspace (hash of folder URIs)
```

### Cache entry schema

```typescript
interface PersistedCacheFile {
  version: number;                                  // Schema version (currently 1)
  entries: Record<string, PersistedCacheEntry>;     // Keyed by file URI string
}

interface PersistedCacheEntry {
  contentHash: string;          // SHA-256 hex of file content at parse time
  strings: SourceString[];      // The cached parsed strings
}
```

## Consequences

### Positive

- **Fast first search after restart**: validated cache entries skip tree-sitter parsing entirely. Loading = read file + hash (fast I/O) vs. read file + parse AST + traverse (expensive).
- **No new dependencies**: uses only Node.js builtins (`node:crypto`, `node:fs`).
- **Self-cleaning**: no manual cache management needed by users.
- **Safe by default**: hash validation ensures stale data is never served. Schema version ensures forward compatibility.

### Negative

- **Startup I/O**: loading the cache reads and hashes every previously-cached file. For 1000 files this is ~1-2 seconds. This is async and non-blocking.
- **Disk usage**: typical cache is 1-5MB per workspace. Acceptable for the performance benefit.
- **Single bulk write on deactivation**: if the editor crashes, the cache from that session is lost. This is acceptable — re-parsing is the fallback. Periodic saves could be added later if needed.

## References

- [VS Code Extension API — globalStorageUri](https://code.visualstudio.com/api/references/vscode-api#ExtensionContext.globalStorageUri)
- ADR-001 (web-tree-sitter) — the parsing cost this cache mitigates
