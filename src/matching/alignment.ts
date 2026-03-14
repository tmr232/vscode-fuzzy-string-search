import * as fuzz from "fuzzball";
import type { ContentSegment } from "../types.js";

/**
 * Result of finding the best-matching alignment of a query within a target string.
 *
 * The alignment identifies which substring of the target best matches the query,
 * mirroring the internal logic of `fuzz.partial_ratio` but exposing the position.
 */
export interface AlignmentResult {
	/** Start index (inclusive) of the best-matching window in the target string. */
	start: number;
	/** End index (exclusive) of the best-matching window in the target string. */
	end: number;
	/** The best-matching substring of the target. */
	substring: string;
}

/**
 * Find the best-matching substring alignment of `query` within `target`.
 *
 * Uses a sliding window of `query.length` over the target, scoring each window
 * with `fuzz.ratio`, and returns the window with the highest score.
 *
 * This is a simplified reimplementation of the alignment logic inside
 * `fuzz.partial_ratio`. See ADR-004 for alternatives considered.
 *
 * @returns The alignment, or `undefined` if either string is empty.
 */
export function findAlignment(query: string, target: string): AlignmentResult | undefined {
	if (query === "" || target === "") return undefined;

	// partial_ratio always slides the shorter string over the longer one.
	const shorter = query.length <= target.length ? query : target;
	const longer = query.length <= target.length ? target : query;

	// If the query is longer than the target, the "window" is the entire target.
	if (query.length > target.length) {
		return { start: 0, end: target.length, substring: target };
	}

	const windowLen = shorter.length;
	let bestScore = -1;
	let bestStart = 0;

	for (let i = 0; i <= longer.length - windowLen; i++) {
		const window = longer.substring(i, i + windowLen);
		const score = fuzz.ratio(shorter, window, { full_process: false });
		if (score > bestScore) {
			bestScore = score;
			bestStart = i;
			if (score > 99.5) break; // Perfect match, no need to continue.
		}
	}

	const bestEnd = bestStart + windowLen;
	return {
		start: bestStart,
		end: bestEnd,
		substring: longer.substring(bestStart, bestEnd),
	};
}

/**
 * Format a source string for display using alignment information.
 *
 * Extracts the aligned substring and adds surrounding context with ellipsis
 * indicators when the match is not at the edges of the full string.
 *
 * @param content - The full source string content.
 * @param query - The user's search query.
 * @param contextChars - Number of characters of context to show around the match.
 * @returns The display string with ellipsis context.
 */
export function formatAlignedMatch(content: string, query: string, contextChars = 20): string {
	const alignment = findAlignment(query, content);
	if (!alignment) return content;

	// If the full content is short enough, just show it all.
	if (content.length <= query.length + contextChars * 2) {
		return content;
	}

	const ctxStart = Math.max(0, alignment.start - contextChars);
	const ctxEnd = Math.min(content.length, alignment.end + contextChars);

	const prefix = ctxStart > 0 ? "…" : "";
	const suffix = ctxEnd < content.length ? "…" : "";

	return prefix + content.substring(ctxStart, ctxEnd) + suffix;
}

/**
 * A source-file position (0-indexed line and column).
 */
export interface SourcePosition {
	line: number;
	column: number;
}

/**
 * Map a character offset within the assembled content string to a
 * source-file position using the segment mapping.
 *
 * Walks through segments, accumulating content lengths until it finds
 * the segment containing the offset, then computes the line/column
 * within that segment by counting newlines in the content.
 *
 * @param offset - Character offset within the content string.
 * @param segments - The content segments from a SourceString.
 * @param content - The full content string (used for newline counting in multi-line segments).
 * @returns The source-file position, or `undefined` if segments are empty.
 */
export function contentOffsetToPosition(
	offset: number,
	segments: ContentSegment[],
	content: string,
): SourcePosition | undefined {
	if (segments.length === 0) return undefined;

	let consumed = 0;
	for (const seg of segments) {
		if (offset < consumed + seg.contentLength) {
			const offsetInSegment = offset - consumed;
			const segContent = content.substring(consumed, consumed + seg.contentLength);
			const beforeOffset = segContent.substring(0, offsetInSegment);
			const lines = beforeOffset.split("\n");
			const lineOffset = lines.length - 1;
			const lastLineLen = lines[lines.length - 1]?.length ?? 0;

			return {
				line: seg.startLine + lineOffset,
				column: lineOffset === 0 ? seg.startColumn + lastLineLen : lastLineLen,
			};
		}
		consumed += seg.contentLength;
	}

	// Offset is at or past the end — clamp to end of last segment.
	const lastSeg = segments[segments.length - 1];
	if (!lastSeg) return undefined;
	return { line: lastSeg.endLine, column: lastSeg.endColumn };
}
