import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StringCache } from "../../src/cache/string-cache.js";
import type { MatchResult } from "../../src/matching/fuzzy-matcher.js";
import { resetParserManager } from "../../src/parsing/parser-manager.js";
import { search } from "../../src/search/search-engine.js";

const WASM_DIR = resolve(__dirname, "../../wasm");
const FIXTURE_DIR = resolve(__dirname, "../fixtures");

/**
 * Helper: create a fake vscode.Uri from a file path.
 */
function fakeUri(fsPath: string) {
	return {
		fsPath,
		toString() {
			return `file://${fsPath.replace(/\\/g, "/")}`;
		},
	};
}

// Mock the file-discovery module so we don't need the real vscode workspace API.
vi.mock("../../src/files/file-discovery.js", () => ({
	discoverFiles: vi.fn(),
}));

// Lazy import so the mock is in place before module evaluation.
const { discoverFiles } = await import("../../src/files/file-discovery.js");
const discoverFilesMock = vi.mocked(discoverFiles);

describe("search", () => {
	let cache: StringCache;

	beforeEach(() => {
		cache = new StringCache();
		discoverFilesMock.mockReset();
	});

	afterEach(() => {
		resetParserManager();
	});

	it("should return empty results for an empty query", async () => {
		const { results } = await search("", cache, WASM_DIR);
		expect(results).toHaveLength(0);
	});

	it("should find matching strings in a Python fixture file", async () => {
		const samplePath = resolve(FIXTURE_DIR, "sample.py");
		discoverFilesMock.mockResolvedValue([fakeUri(samplePath)] as never);

		const { results } = await search("hello world", cache, WASM_DIR, {
			scoreCutoff: 60,
		});

		expect(results.length).toBeGreaterThanOrEqual(1);
		const exactMatch = results.find(
			(r) => r.sourceString.content === "hello world" && r.score === 100,
		);
		expect(exactMatch).toBeDefined();
	});

	it("should return results sorted by score descending", async () => {
		const samplePath = resolve(FIXTURE_DIR, "sample.py");
		discoverFilesMock.mockResolvedValue([fakeUri(samplePath)] as never);

		const { results } = await search("hello", cache, WASM_DIR, { scoreCutoff: 0 });

		for (let i = 1; i < results.length; i++) {
			const prev = results[i - 1];
			const curr = results[i];
			if (prev && curr) {
				expect(prev.score).toBeGreaterThanOrEqual(curr.score);
			}
		}
	});

	it("should use the string cache on subsequent searches", async () => {
		const samplePath = resolve(FIXTURE_DIR, "sample.py");
		discoverFilesMock.mockResolvedValue([fakeUri(samplePath)] as never);

		// First search — populates cache
		await search("hello", cache, WASM_DIR);
		const uriKey = fakeUri(samplePath).toString();
		expect(cache.has(uriKey)).toBe(true);

		// Second search — should use cache (no re-parse needed)
		const { results } = await search("hello", cache, WASM_DIR);
		expect(results.length).toBeGreaterThanOrEqual(1);
	});

	it("should respect maxResults option", async () => {
		const samplePath = resolve(FIXTURE_DIR, "sample.py");
		discoverFilesMock.mockResolvedValue([fakeUri(samplePath)] as never);

		const { results } = await search("string", cache, WASM_DIR, {
			scoreCutoff: 0,
			maxResults: 3,
		});

		expect(results.length).toBeLessThanOrEqual(3);
	});

	it("should respect scoreCutoff option", async () => {
		const samplePath = resolve(FIXTURE_DIR, "sample.py");
		discoverFilesMock.mockResolvedValue([fakeUri(samplePath)] as never);

		const { results } = await search("hello world", cache, WASM_DIR, {
			scoreCutoff: 90,
		});

		for (const r of results) {
			expect(r.score).toBeGreaterThanOrEqual(90);
		}
	});

	it("should call onFileResults callback for each file with matches", async () => {
		const samplePath = resolve(FIXTURE_DIR, "sample.py");
		discoverFilesMock.mockResolvedValue([fakeUri(samplePath)] as never);

		const batches: MatchResult[][] = [];
		await search("hello", cache, WASM_DIR, {
			scoreCutoff: 0,
			onFileResults: (results) => batches.push(results),
		});

		expect(batches.length).toBeGreaterThanOrEqual(1);
		for (const batch of batches) {
			expect(batch.length).toBeGreaterThan(0);
		}
	});

	it("should handle files with no matching strings gracefully", async () => {
		const samplePath = resolve(FIXTURE_DIR, "sample.py");
		discoverFilesMock.mockResolvedValue([fakeUri(samplePath)] as never);

		const { results } = await search("zzz_no_match_zzz_xyzzy", cache, WASM_DIR, {
			scoreCutoff: 99,
		});

		expect(results).toHaveLength(0);
	});

	it("should return empty results when no files are discovered", async () => {
		discoverFilesMock.mockResolvedValue([]);

		const { results } = await search("hello", cache, WASM_DIR);
		expect(results).toHaveLength(0);
	});

	it("should skip files with unsupported extensions", async () => {
		// A .txt file has no registered language support
		const txtPath = resolve(FIXTURE_DIR, "nonexistent.txt");
		discoverFilesMock.mockResolvedValue([fakeUri(txtPath)] as never);

		const { results } = await search("hello", cache, WASM_DIR, { scoreCutoff: 0 });
		expect(results).toHaveLength(0);
	});

	it("should handle cancellation before file processing", async () => {
		const samplePath = resolve(FIXTURE_DIR, "sample.py");
		discoverFilesMock.mockResolvedValue([fakeUri(samplePath)] as never);

		const token = { isCancellationRequested: true, onCancellationRequested: vi.fn() };
		const { results } = await search("hello", cache, WASM_DIR, { token: token as never });

		expect(results).toHaveLength(0);
	});

	it("should search across multiple files", async () => {
		const samplePath = resolve(FIXTURE_DIR, "sample.py");
		// Use the same file twice to simulate multiple files
		discoverFilesMock.mockResolvedValue([fakeUri(samplePath), fakeUri(samplePath)] as never);

		// Even though it's the same file, the cache is keyed by URI so both calls parse
		const { results } = await search("hello world", cache, WASM_DIR, {
			scoreCutoff: 60,
		});

		// Both "copies" produce the same matches, so results should be doubled
		const exactMatches = results.filter(
			(r) => r.sourceString.content === "hello world" && r.score === 100,
		);
		expect(exactMatches.length).toBeGreaterThanOrEqual(2);
	});

	it("should return timing information", async () => {
		const samplePath = resolve(FIXTURE_DIR, "sample.py");
		discoverFilesMock.mockResolvedValue([fakeUri(samplePath)] as never);

		const { timings } = await search("hello", cache, WASM_DIR);

		expect(timings.totalMs).toBeGreaterThanOrEqual(0);
		expect(timings.discoveryMs).toBeGreaterThanOrEqual(0);
		expect(timings.collectMs).toBeGreaterThanOrEqual(0);
		expect(timings.matchMs).toBeGreaterThanOrEqual(0);
	});

	it("should pass includeGlob and excludeGlob to discoverFiles", async () => {
		discoverFilesMock.mockResolvedValue([]);

		await search("hello", cache, WASM_DIR, {
			includeGlob: "**/*.py",
			excludeGlob: "**/test/**",
		});

		expect(discoverFilesMock).toHaveBeenCalledWith("**/*.py", "**/test/**", undefined);
	});
});
