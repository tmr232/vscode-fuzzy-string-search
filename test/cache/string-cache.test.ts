import { describe, expect, it } from "vitest";
import { StringCache } from "../../src/cache/string-cache.js";
import type { SourceString } from "../../src/types.js";

function makeSourceString(content: string, filePath = "/test.py"): SourceString {
	return {
		content,
		filePath,
		startLine: 0,
		startColumn: 0,
		endLine: 0,
		endColumn: content.length,
		segments: [
			{
				contentLength: content.length,
				startLine: 0,
				startColumn: 0,
				endLine: 0,
				endColumn: content.length,
			},
		],
	};
}

describe("StringCache", () => {
	it("should return undefined for uncached file", () => {
		const cache = new StringCache();
		expect(cache.get("file:///test.py")).toBeUndefined();
	});

	it("should store and retrieve strings", () => {
		const cache = new StringCache();
		const strings = [makeSourceString("hello")];
		cache.set("file:///test.py", strings, "hash1");

		expect(cache.get("file:///test.py")).toEqual(strings);
	});

	it("should report correct size", () => {
		const cache = new StringCache();
		expect(cache.size).toBe(0);

		cache.set("file:///a.py", [makeSourceString("a")], "hash1");
		expect(cache.size).toBe(1);

		cache.set("file:///b.py", [makeSourceString("b")], "hash2");
		expect(cache.size).toBe(2);
	});

	it("should check existence with has()", () => {
		const cache = new StringCache();
		expect(cache.has("file:///test.py")).toBe(false);

		cache.set("file:///test.py", [], "hash1");
		expect(cache.has("file:///test.py")).toBe(true);
	});

	it("should invalidate a single entry", () => {
		const cache = new StringCache();
		cache.set("file:///a.py", [makeSourceString("a")], "hash1");
		cache.set("file:///b.py", [makeSourceString("b")], "hash2");

		const removed = cache.invalidate("file:///a.py");
		expect(removed).toBe(true);
		expect(cache.get("file:///a.py")).toBeUndefined();
		expect(cache.get("file:///b.py")).toBeDefined();
		expect(cache.size).toBe(1);
	});

	it("should return false when invalidating non-existent entry", () => {
		const cache = new StringCache();
		const removed = cache.invalidate("file:///nonexistent.py");
		expect(removed).toBe(false);
	});

	it("should clear all entries", () => {
		const cache = new StringCache();
		cache.set("file:///a.py", [makeSourceString("a")], "hash1");
		cache.set("file:///b.py", [makeSourceString("b")], "hash2");

		cache.clear();
		expect(cache.size).toBe(0);
		expect(cache.get("file:///a.py")).toBeUndefined();
		expect(cache.get("file:///b.py")).toBeUndefined();
	});

	it("should overwrite existing entry on set", () => {
		const cache = new StringCache();
		const oldStrings = [makeSourceString("old")];
		const newStrings = [makeSourceString("new")];

		cache.set("file:///test.py", oldStrings, "hash-old");
		cache.set("file:///test.py", newStrings, "hash-new");

		expect(cache.get("file:///test.py")).toEqual(newStrings);
		expect(cache.size).toBe(1);
	});

	it("should handle empty arrays", () => {
		const cache = new StringCache();
		cache.set("file:///empty.py", [], "hash1");

		expect(cache.get("file:///empty.py")).toEqual([]);
		expect(cache.has("file:///empty.py")).toBe(true);
	});

	it("should return full cache entry with getEntry()", () => {
		const cache = new StringCache();
		const strings = [makeSourceString("hello")];
		cache.set("file:///test.py", strings, "abc123");

		const entry = cache.getEntry("file:///test.py");
		expect(entry).toBeDefined();
		expect(entry?.contentHash).toBe("abc123");
		expect(entry?.strings).toEqual(strings);
	});

	it("should iterate over entries", () => {
		const cache = new StringCache();
		cache.set("file:///a.py", [makeSourceString("a")], "hash1");
		cache.set("file:///b.py", [makeSourceString("b")], "hash2");

		const entries = [...cache.entries()];
		expect(entries).toHaveLength(2);

		const uris = entries.map(([uri]) => uri);
		expect(uris).toContain("file:///a.py");
		expect(uris).toContain("file:///b.py");
	});
});
