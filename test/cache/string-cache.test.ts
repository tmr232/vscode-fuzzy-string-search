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
		cache.set("file:///test.py", strings);

		expect(cache.get("file:///test.py")).toBe(strings);
	});

	it("should report correct size", () => {
		const cache = new StringCache();
		expect(cache.size).toBe(0);

		cache.set("file:///a.py", [makeSourceString("a")]);
		expect(cache.size).toBe(1);

		cache.set("file:///b.py", [makeSourceString("b")]);
		expect(cache.size).toBe(2);
	});

	it("should check existence with has()", () => {
		const cache = new StringCache();
		expect(cache.has("file:///test.py")).toBe(false);

		cache.set("file:///test.py", []);
		expect(cache.has("file:///test.py")).toBe(true);
	});

	it("should invalidate a single entry", () => {
		const cache = new StringCache();
		cache.set("file:///a.py", [makeSourceString("a")]);
		cache.set("file:///b.py", [makeSourceString("b")]);

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
		cache.set("file:///a.py", [makeSourceString("a")]);
		cache.set("file:///b.py", [makeSourceString("b")]);

		cache.clear();
		expect(cache.size).toBe(0);
		expect(cache.get("file:///a.py")).toBeUndefined();
		expect(cache.get("file:///b.py")).toBeUndefined();
	});

	it("should overwrite existing entry on set", () => {
		const cache = new StringCache();
		const oldStrings = [makeSourceString("old")];
		const newStrings = [makeSourceString("new")];

		cache.set("file:///test.py", oldStrings);
		cache.set("file:///test.py", newStrings);

		expect(cache.get("file:///test.py")).toBe(newStrings);
		expect(cache.size).toBe(1);
	});

	it("should handle empty arrays", () => {
		const cache = new StringCache();
		cache.set("file:///empty.py", []);

		expect(cache.get("file:///empty.py")).toEqual([]);
		expect(cache.has("file:///empty.py")).toBe(true);
	});
});
