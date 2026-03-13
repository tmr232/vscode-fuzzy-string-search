import * as fuzz from "fuzzball";
import { describe, expect, it } from "vitest";
import { fuzzyMatch } from "../../src/matching/fuzzy-matcher.js";
import type { SourceString } from "../../src/types.js";

function makeSourceString(content: string, index = 0): SourceString {
	return {
		content,
		filePath: "/test.py",
		startLine: index,
		startColumn: 0,
		endLine: index,
		endColumn: content.length,
	};
}

describe("fullProcess", () => {
	it("ensure this weird thing doesn't match (it matches with fullProcess)", () => {
		const strings = [makeSourceString("(&&)(?='.+'\\s?)")];
		const results = fuzzyMatch("abstract base class", strings);

		expect(results).toHaveLength(0);
	});

	it("guarantee the correct score", () => {
		const score = fuzz.partial_ratio("abstract base class", "(&&)(?='.+'\\s?)", {
			full_process: false,
		});
		expect(score).toBe(7);
	});
});

describe("fuzzyMatch", () => {
	it("should return an exact match with score 100", () => {
		const strings = [makeSourceString("hello world")];
		const results = fuzzyMatch("hello world", strings);

		expect(results).toHaveLength(1);
		expect(results[0]?.score).toBe(100);
		expect(results[0]?.sourceString.content).toBe("hello world");
	});

	it("should return partial matches above cutoff", () => {
		const strings = [makeSourceString("hello world"), makeSourceString("goodbye world")];
		const results = fuzzyMatch("hello", strings);

		expect(results.length).toBeGreaterThanOrEqual(1);
		const helloResult = results.find((r) => r.sourceString.content === "hello world");
		expect(helloResult).toBeDefined();
		expect(helloResult?.score).toBe(100);
	});

	it("should exclude results below cutoff", () => {
		const strings = [makeSourceString("hello world"), makeSourceString("xyzzy abcde")];
		const results = fuzzyMatch("hello world", strings, { cutoff: 80 });

		for (const r of results) {
			expect(r.score).toBeGreaterThanOrEqual(80);
		}
		expect(results.every((r) => r.sourceString.content !== "xyzzy abcde")).toBe(true);
	});

	it("should return empty array for empty query", () => {
		const strings = [makeSourceString("hello world")];
		const results = fuzzyMatch("", strings);

		expect(results).toHaveLength(0);
	});

	it("should return empty array for empty source strings", () => {
		const results = fuzzyMatch("hello", []);

		expect(results).toHaveLength(0);
	});

	it("should respect the limit option", () => {
		const strings = [
			makeSourceString("hello world", 0),
			makeSourceString("hello there", 1),
			makeSourceString("hello friend", 2),
			makeSourceString("hello everybody", 3),
		];
		const results = fuzzyMatch("hello", strings, { limit: 2, cutoff: 0 });

		expect(results).toHaveLength(2);
	});

	it("should return results sorted by score descending", () => {
		const strings = [
			makeSourceString("completely different"),
			makeSourceString("hello world"),
			makeSourceString("hello"),
		];
		const results = fuzzyMatch("hello world", strings, { cutoff: 0 });

		for (let i = 1; i < results.length; i++) {
			const prev = results[i - 1];
			const curr = results[i];
			if (prev && curr) {
				expect(prev.score).toBeGreaterThanOrEqual(curr.score);
			}
		}
	});

	it("should handle unicode strings", () => {
		const strings = [makeSourceString("こんにちは世界"), makeSourceString("hello world")];
		const results = fuzzyMatch("こんにちは", strings, { cutoff: 0 });

		expect(results.length).toBeGreaterThanOrEqual(1);
		const japaneseResult = results.find((r) => r.sourceString.content === "こんにちは世界");
		expect(japaneseResult).toBeDefined();
		expect(japaneseResult?.score).toBeGreaterThan(0);
	});

	it("should use default cutoff of 60 when not specified", () => {
		const strings = [makeSourceString("hello world"), makeSourceString("x")];
		const results = fuzzyMatch("hello world", strings);

		for (const r of results) {
			expect(r.score).toBeGreaterThanOrEqual(60);
		}
	});

	it("should match with cutoff 0 to return all results", () => {
		const strings = [makeSourceString("hello world"), makeSourceString("completely unrelated")];
		const results = fuzzyMatch("hello world", strings, { cutoff: 0 });

		expect(results).toHaveLength(2);
	});

	it("should preserve source string metadata in results", () => {
		const sourceString: SourceString = {
			content: "hello world",
			filePath: "/path/to/file.py",
			startLine: 5,
			startColumn: 4,
			endLine: 5,
			endColumn: 17,
		};
		const results = fuzzyMatch("hello world", [sourceString]);

		expect(results).toHaveLength(1);
		expect(results[0]?.sourceString.filePath).toBe("/path/to/file.py");
		expect(results[0]?.sourceString.startLine).toBe(5);
		expect(results[0]?.sourceString.startColumn).toBe(4);
		expect(results[0]?.sourceString.endLine).toBe(5);
		expect(results[0]?.sourceString.endColumn).toBe(17);
	});
});
