import * as fuzz from "fuzzball";

export interface ScoredContentMatch {
	content: string;
	score: number;
}

export interface MatchOptions {
	cutoff?: number;
	limit?: number;
	minLengthRatio?: number;
}

const DEFAULT_CUTOFF = 60;
const DEFAULT_MIN_LENGTH_RATIO = 50;

export function fuzzyMatch(
	query: string,
	contents: string[],
	options?: MatchOptions,
): ScoredContentMatch[] {
	if (query === "" || contents.length === 0) {
		return [];
	}

	const cutoff = options?.cutoff ?? DEFAULT_CUTOFF;
	const limit = options?.limit ?? 0;
	const minLengthRatio = options?.minLengthRatio ?? DEFAULT_MIN_LENGTH_RATIO;

	const relevantContents = contents.filter(
		(content) => content.length * 100 >= query.length * minLengthRatio,
	);

	const results = fuzz.extract(query, relevantContents, {
		scorer: fuzz.partial_ratio,
		processor: (choice: string) => choice,
		cutoff,
		limit,
		full_process: false,
	});

	return results.map(([choice, score]: [string, number, number]) => ({
		content: choice as string,
		score,
	}));
}
