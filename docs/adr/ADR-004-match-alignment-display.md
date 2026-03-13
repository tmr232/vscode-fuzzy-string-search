# ADR-004: Match Alignment for Result Display

## Status

Accepted

## Context

When fuzzy-matching user queries against source-code string literals, long strings make search results unreadable. The full string content is displayed for every match, but the user only cares about the portion of the string that actually matched their query.

Python's `rapidfuzz` library provides `fuzz.partial_ratio_alignment()` which returns alignment indices (the start/end of the best-matching substring within the target). The JavaScript `fuzzball` library we use does not expose this — its `partial_ratio` returns only the score.

## Decision

We implement a **sliding-window alignment function** (`findAlignment`) that replicates the core logic of `partial_ratio` to find *where* the best match occurs within a string, and apply it **at display-time** (in `formatResults`) rather than during matching.

### Algorithm

1. Determine the shorter and longer string (query vs. target).
2. Slide a window of `shorter.length` across the longer string.
3. Score each window with `fuzz.ratio()` (same scorer `partial_ratio` uses internally).
4. Return the window position (start, end) and substring with the highest score.
5. Early-exit on score > 99.5 (perfect match).

### Display formatting

`formatAlignedMatch()` takes the full content, query, and a context-characters parameter (default: 20). It:

- Shows the aligned substring plus surrounding context characters.
- Adds `…` ellipsis indicators when the displayed portion doesn't reach the string edges.
- Falls back to showing the full string when it's short enough.

### Integration point

Alignment runs in `formatResults()` inside `search-panel.ts`, which is called only when sending results to the webview. The matching pipeline (`fuzzyMatch` / `fuzz.extract`) is unchanged.

## Alternatives Considered

### 1. Expose fuzzball's internal SequenceMatcher

`fuzzball`'s `_partial_ratio` internally uses `SequenceMatcher.getMatchingBlocks()` to find candidate alignment offsets, then scores each. We could import and use `SequenceMatcher` directly to avoid the brute-force sliding window.

**Rejected because:** `SequenceMatcher` is not part of fuzzball's public API. Depending on it would be fragile across fuzzball version updates.

### 2. Switch to a library with built-in alignment (e.g., port rapidfuzz)

Python's `rapidfuzz` has `partial_ratio_alignment` which returns an `Alignment` object with `src_start`, `src_end`, `dest_start`, `dest_end`. We could use a JS port of rapidfuzz or write bindings.

**Deferred because:** No mature JS port of `rapidfuzz` with alignment support exists. This could be revisited if performance becomes an issue or if such a library emerges.

### 3. Compute alignment during matching (in `fuzzyMatch`)

We could compute alignment inside `fuzzyMatch` and include it in `MatchResult`, avoiding recomputation at display-time.

**Rejected for now because:** Alignment is only needed for display. Computing it during matching would add overhead for results that may be filtered out by sorting/limiting. Running at display-time keeps the matching hot path lean.

## Consequences

- Search results show only the relevant portion of long strings, making them readable.
- The matching pipeline remains unchanged — no performance impact on scoring.
- Alignment runs O(n) `fuzz.ratio` calls per displayed result (where n = target length − query length). For typical string lengths and result counts (≤100), this is negligible.
- If alignment performance becomes a concern with very long strings or high result counts, alternative 1 or 2 can be adopted without changing the display layer.
