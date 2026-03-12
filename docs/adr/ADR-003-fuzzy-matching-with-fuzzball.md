# ADR-003: Fuzzy Matching with fuzzball and partial_ratio

## Status

Accepted

## Context

The extension needs to fuzzy-match user queries against string literals extracted from source code. The reference Python project (`source-strings`) uses `rapidfuzz.fuzz.partial_ratio` for scoring. We need a JavaScript equivalent that provides similar scoring behavior and supports batch extraction with cutoff and limit options.

## Decision

We use **fuzzball** (`fuzzball` npm package), a JavaScript port of TheFuzz/fuzzywuzzy, with `fuzz.partial_ratio` as the default scorer.

### Why fuzzball

- It is a direct port of the same Python library family (fuzzywuzzy/TheFuzz) that `rapidfuzz` is compatible with, so scoring behavior is comparable to the reference project.
- It provides `fuzz.extract()` for batch matching with built-in `cutoff`, `limit`, `processor`, and `scorer` options — exactly what we need.
- It supports `extractAsPromised()` with `AbortController` for async cancellation, which will be used by the search engine in later phases.
- It has TypeScript type definitions included.
- It is well-maintained with 200k+ weekly downloads.

### Why partial_ratio

- `partial_ratio` finds the highest-scoring substring match between the query and the target string. This is ideal for our use case because users often search for a fragment of a string literal rather than the full content.
- This matches the reference project's use of `rapidfuzz.fuzz.partial_ratio`.
- Other scorers (e.g., `token_set_ratio`, `WRatio`) could be offered as configuration options in the future.

### API Design

The `fuzzyMatch()` function wraps `fuzz.extract()`:

- Accepts a query, an array of `SourceString` objects, and optional `MatchOptions` (cutoff, limit).
- Uses a `processor` function to extract the `.content` field from each `SourceString` for scoring.
- Returns `MatchResult[]` with `{ sourceString, score }`, sorted by score descending.
- Default cutoff is 60 (configurable).

## Consequences

- Fuzzy matching behavior closely mirrors the reference Python project.
- The `fuzzyMatch()` function is a simple, testable wrapper around fuzzball with no VSCode dependencies.
- Future phases can use `extractAsPromised()` with `AbortController` for cancellable async searches.
- Alternative scorers can be added as a configuration option later without changing the architecture.
