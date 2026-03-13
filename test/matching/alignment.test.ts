import { describe, expect, it } from "vitest";
import { findAlignment, formatAlignedMatch } from "../../src/matching/alignment.js";

describe("findAlignment", () => {
	it("should return undefined for empty query", () => {
		expect(findAlignment("", "hello world")).toBeUndefined();
	});

	it("should return undefined for empty target", () => {
		expect(findAlignment("hello", "")).toBeUndefined();
	});

	it("should find exact substring match", () => {
		const result = findAlignment("world", "hello world");
		expect(result).toBeDefined();
		expect(result?.substring).toBe("world");
		expect(result?.start).toBe(6);
		expect(result?.end).toBe(11);
	});

	it("should find best fuzzy alignment", () => {
		const result = findAlignment("wrld", "hello world");
		expect(result).toBeDefined();
		// The best 4-char window should be around "orld" or "worl"
		expect(result?.substring.length).toBe(4);
	});

	it("should find match at the beginning", () => {
		const result = findAlignment("hello", "hello world");
		expect(result).toBeDefined();
		expect(result?.substring).toBe("hello");
		expect(result?.start).toBe(0);
		expect(result?.end).toBe(5);
	});

	it("should handle query longer than target", () => {
		const result = findAlignment("hello world foo", "hello");
		expect(result).toBeDefined();
		expect(result?.start).toBe(0);
		expect(result?.end).toBe(5);
		expect(result?.substring).toBe("hello");
	});

	it("should handle equal-length strings", () => {
		const result = findAlignment("hello", "hello");
		expect(result).toBeDefined();
		expect(result?.substring).toBe("hello");
		expect(result?.start).toBe(0);
		expect(result?.end).toBe(5);
	});

	it("should find alignment in a long string", () => {
		const longString = "the quick brown fox jumps over the lazy dog";
		const result = findAlignment("lazy", longString);
		expect(result).toBeDefined();
		expect(result?.substring).toBe("lazy");
		expect(result?.start).toBe(35);
		expect(result?.end).toBe(39);
	});
});

describe("formatAlignedMatch", () => {
	it("should return full content for short strings", () => {
		const result = formatAlignedMatch("hello world", "hello");
		expect(result).toBe("hello world");
	});

	it("should truncate long strings with ellipsis", () => {
		const longString =
			"this is a very long string that contains the word needle somewhere in the middle of it all";
		const result = formatAlignedMatch(longString, "needle", 10);
		expect(result).toContain("needle");
		expect(result.length).toBeLessThan(longString.length);
	});

	it("should add leading ellipsis when match is not at start", () => {
		const longString = "aaaaaaaaaaaaaaaaaaaaaaaaaaa needle bbbbbbbbbbbbbbbbbbbbbbbbbbb";
		const result = formatAlignedMatch(longString, "needle", 5);
		expect(result).toMatch(/^…/);
	});

	it("should add trailing ellipsis when match is not at end", () => {
		const longString = "aaaaaaaaaaaaaaaaaaaaaaaaaaa needle bbbbbbbbbbbbbbbbbbbbbbbbbbb";
		const result = formatAlignedMatch(longString, "needle", 5);
		expect(result).toMatch(/…$/);
	});

	it("should not add leading ellipsis when match is at start", () => {
		const longString = "needle bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
		const result = formatAlignedMatch(longString, "needle", 5);
		expect(result).not.toMatch(/^…/);
	});

	it("should return full content when alignment fails", () => {
		const result = formatAlignedMatch("hello", "", 5);
		expect(result).toBe("hello");
	});
});
