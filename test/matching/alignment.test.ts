import { describe, expect, it } from "vitest";
import {
	contentOffsetToPosition,
	findAlignment,
	formatAlignedMatch,
} from "../../src/matching/alignment.js";
import type { ContentSegment } from "../../src/types.js";

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

describe("contentOffsetToPosition", () => {
	it("should return undefined for empty segments", () => {
		expect(contentOffsetToPosition(0, [], "")).toBeUndefined();
	});

	it("should map offset within a single segment", () => {
		// content = "hello world" starting at line 0, col 5
		const segments: ContentSegment[] = [
			{ contentLength: 11, startLine: 0, startColumn: 5, endLine: 0, endColumn: 16 },
		];
		const pos = contentOffsetToPosition(3, segments, "hello world");
		expect(pos).toEqual({ line: 0, column: 8 });
	});

	it("should map offset at start of segment", () => {
		const segments: ContentSegment[] = [
			{ contentLength: 11, startLine: 0, startColumn: 5, endLine: 0, endColumn: 16 },
		];
		const pos = contentOffsetToPosition(0, segments, "hello world");
		expect(pos).toEqual({ line: 0, column: 5 });
	});

	it("should clamp offset past end to last segment end", () => {
		const segments: ContentSegment[] = [
			{ contentLength: 5, startLine: 0, startColumn: 5, endLine: 0, endColumn: 10 },
		];
		const pos = contentOffsetToPosition(10, segments, "hello");
		expect(pos).toEqual({ line: 0, column: 10 });
	});

	it("should map offset across multiple segments (concatenated string)", () => {
		// content = "hello world" from "hello " (col 6–12) + "world" (col 15–20)
		const segments: ContentSegment[] = [
			{ contentLength: 6, startLine: 0, startColumn: 6, endLine: 0, endColumn: 12 },
			{ contentLength: 5, startLine: 0, startColumn: 15, endLine: 0, endColumn: 20 },
		];
		// offset 6 is the first char of "world" → second segment, col 15
		const pos = contentOffsetToPosition(6, segments, "hello world");
		expect(pos).toEqual({ line: 0, column: 15 });
	});

	it("should map offset within second segment of concatenated string", () => {
		// content = "hello world" from "hello " (col 6–12) + "world" (col 15–20)
		const segments: ContentSegment[] = [
			{ contentLength: 6, startLine: 0, startColumn: 6, endLine: 0, endColumn: 12 },
			{ contentLength: 5, startLine: 0, startColumn: 15, endLine: 0, endColumn: 20 },
		];
		// offset 8 is 'r' in "world" → second segment, offset 2 into it → col 17
		const pos = contentOffsetToPosition(8, segments, "hello world");
		expect(pos).toEqual({ line: 0, column: 17 });
	});

	it("should handle multi-line concatenated string segments", () => {
		// x = (
		//     "first"   # line 1, col 5–10
		//     "second"  # line 2, col 5–11
		// )
		// content = "firstsecond"
		const segments: ContentSegment[] = [
			{ contentLength: 5, startLine: 1, startColumn: 5, endLine: 1, endColumn: 10 },
			{ contentLength: 6, startLine: 2, startColumn: 5, endLine: 2, endColumn: 11 },
		];
		// offset 5 → first char of "second" → line 2, col 5
		const pos = contentOffsetToPosition(5, segments, "firstsecond");
		expect(pos).toEqual({ line: 2, column: 5 });

		// offset 8 → 'o' in "second" → line 2, col 8
		const pos2 = contentOffsetToPosition(8, segments, "firstsecond");
		expect(pos2).toEqual({ line: 2, column: 8 });
	});

	it("should handle f-string with interpolation segments", () => {
		// x = f"hello {name}"
		// content = "hello {}"
		// segments: "hello " (col 6–12) + interpolation "{name}" (col 12–18)
		const segments: ContentSegment[] = [
			{ contentLength: 6, startLine: 0, startColumn: 6, endLine: 0, endColumn: 12 },
			{ contentLength: 2, startLine: 0, startColumn: 12, endLine: 0, endColumn: 18 },
		];
		// offset 6 → start of "{}" → interpolation start at col 12
		const pos = contentOffsetToPosition(6, segments, "hello {}");
		expect(pos).toEqual({ line: 0, column: 12 });
	});

	it("should handle multiline content within a single segment", () => {
		// x = """line one\nline two\nline three"""
		// content = "line one\nline two\nline three"
		// single segment starting at line 0, col 7
		const segments: ContentSegment[] = [
			{ contentLength: 28, startLine: 0, startColumn: 7, endLine: 2, endColumn: 10 },
		];
		// offset 0 → line 0, col 7
		expect(contentOffsetToPosition(0, segments, "line one\nline two\nline three")).toEqual({
			line: 0,
			column: 7,
		});
		// offset 9 → start of "line two" → line 1, col 0
		expect(contentOffsetToPosition(9, segments, "line one\nline two\nline three")).toEqual({
			line: 1,
			column: 0,
		});
		// offset 12 → 'e' in "line two" → line 1, col 3
		expect(contentOffsetToPosition(12, segments, "line one\nline two\nline three")).toEqual({
			line: 1,
			column: 3,
		});
	});
});
