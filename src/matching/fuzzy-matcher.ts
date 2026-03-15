import * as fuzz from "fuzzball";
import type { SourceString } from "../types.js";

/**
 * Result of a fuzzy match against a source string.
 */
export interface MatchResult {
	/** The matched source string. */
	sourceString: SourceString;
	/** The match score (0–100). */
	score: number;
}

/**
 * Options for fuzzy matching.
 */
export interface MatchOptions {
	/** Minimum score to include in results (0–100). Default: 60. */
	cutoff?: number;
	/** Maximum number of results to return. Default: no limit (0). */
	limit?: number;
	/** Minimum length ratio (0–100): result must be at least this % of query length. Default: 50. */
	minLengthRatio?: number;
}

const DEFAULT_CUTOFF = 60;
const DEFAULT_MIN_LENGTH_RATIO = 50;

/**
 * Fuzzy-match a query against an array of source strings using partial_ratio.
 *
 * Returns results sorted by score descending.
 */
export function fuzzyMatch(
	query: string,
	sourceStrings: SourceString[],
	options?: MatchOptions,
): MatchResult[] {
	if (query === "" || sourceStrings.length === 0) {
		return [];
	}

	const cutoff = options?.cutoff ?? DEFAULT_CUTOFF;
	const limit = options?.limit ?? 0;
	const minLengthRatio = options?.minLengthRatio ?? DEFAULT_MIN_LENGTH_RATIO;

	// Drop strings that are too short relative to the query.
	const relevantSourceStrings = sourceStrings.filter(
		(str) => str.content.length * 100 >= query.length * minLengthRatio,
	);

	const results = fuzz.extract(query, relevantSourceStrings, {
		scorer: fuzz.partial_ratio,
		processor: (choice: SourceString) => choice.content,
		cutoff,
		limit,
		full_process: false,
	});

	return results.map(([choice, score]: [SourceString, number, number]) => ({
		sourceString: choice as SourceString,
		score,
	}));
}
