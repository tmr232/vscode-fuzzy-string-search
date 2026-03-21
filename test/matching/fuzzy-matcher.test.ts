import * as fuzz from "fuzzball";
import { describe, expect, it } from "vitest";
import { fuzzyMatch } from "../../src/matching/fuzzy-matcher.js";

describe("fullProcess", () => {
	it("ensure this weird thing doesn't match (it matches with fullProcess)", () => {
		const strings = ["(&&)(?='.+'\\s?)"];
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
		const strings = ["hello world"];
		const results = fuzzyMatch("hello world", strings);

		expect(results).toHaveLength(1);
		expect(results[0]?.score).toBe(100);
		expect(results[0]?.content).toBe("hello world");
	});

	it("should return partial matches above cutoff", () => {
		const strings = ["hello world", "goodbye world"];
		const results = fuzzyMatch("hello", strings);

		expect(results.length).toBeGreaterThanOrEqual(1);
		const helloResult = results.find((r) => r.content === "hello world");
		expect(helloResult).toBeDefined();
		expect(helloResult?.score).toBe(100);
	});

	it("should exclude results below cutoff", () => {
		const strings = ["hello world", "xyzzy abcde"];
		const results = fuzzyMatch("hello world", strings, { cutoff: 80 });

		for (const r of results) {
			expect(r.score).toBeGreaterThanOrEqual(80);
		}
		expect(results.every((r) => r.content !== "xyzzy abcde")).toBe(true);
	});

	it("should return empty array for empty query", () => {
		const strings = ["hello world"];
		const results = fuzzyMatch("", strings);

		expect(results).toHaveLength(0);
	});

	it("should return empty array for empty source strings", () => {
		const results = fuzzyMatch("hello", []);

		expect(results).toHaveLength(0);
	});

	it("should respect the limit option", () => {
		const strings = ["hello world", "hello there", "hello friend", "hello everybody"];
		const results = fuzzyMatch("hello", strings, { limit: 2, cutoff: 0 });

		expect(results).toHaveLength(2);
	});

	it("should return results sorted by score descending", () => {
		const strings = ["completely different", "hello world", "hello"];
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
		const strings = ["こんにちは世界", "hello world"];
		const results = fuzzyMatch("こんにちは", strings, { cutoff: 0 });

		expect(results.length).toBeGreaterThanOrEqual(1);
		const japaneseResult = results.find((r) => r.content === "こんにちは世界");
		expect(japaneseResult).toBeDefined();
		expect(japaneseResult?.score).toBeGreaterThan(0);
	});

	it("should use default cutoff of 60 when not specified", () => {
		const strings = ["hello world", "x"];
		const results = fuzzyMatch("hello world", strings);

		for (const r of results) {
			expect(r.score).toBeGreaterThanOrEqual(60);
		}
	});

	it("should match with cutoff 0 to return all results", () => {
		const strings = ["hello world", "completely unrelated"];
		const results = fuzzyMatch("hello world", strings, { cutoff: 0 });

		expect(results).toHaveLength(2);
	});
});
