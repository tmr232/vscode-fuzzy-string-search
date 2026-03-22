import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initSqlJs } from "../../src/cache/sql-init.js";
import { SqliteCache } from "../../src/cache/sqlite-cache.js";

import { resetParserManager } from "../../src/parsing/parser-manager.js";
import { search } from "../../src/search/search-engine.js";

const WASM_DIR = resolve(__dirname, "../../wasm");
const FIXTURE_DIR = resolve(__dirname, "../fixtures");

const WORKSPACE_URIS = ["file:///workspace/project"];

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
	let cache: SqliteCache;
	let storageDir: string;

	beforeAll(async () => {
		await initSqlJs();
	});

	beforeEach(async () => {
		storageDir = resolve(
			tmpdir(),
			`search-engine-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		await mkdir(storageDir, { recursive: true });
		cache = new SqliteCache(storageDir);
		discoverFilesMock.mockReset();
	});

	afterEach(async () => {
		cache.dispose();
		resetParserManager();
		await rm(storageDir, { recursive: true, force: true }).catch(() => {});
	});

	it("should return empty results for an empty query", async () => {
		const { results } = await search("", cache, WASM_DIR, WORKSPACE_URIS);
		expect(results).toHaveLength(0);
	});

	it("should find matching strings in a Python fixture file", async () => {
		const samplePath = resolve(FIXTURE_DIR, "sample.py");
		discoverFilesMock.mockResolvedValue([fakeUri(samplePath)] as never);

		const { results } = await search("hello world", cache, WASM_DIR, WORKSPACE_URIS, {
			scoreCutoff: 60,
		});

		expect(results.length).toBeGreaterThanOrEqual(1);
		const exactMatch = results.find((r) => r.content === "hello world" && r.score === 100);
		expect(exactMatch).toBeDefined();
	});

	it("should return results sorted by score descending", async () => {
		const samplePath = resolve(FIXTURE_DIR, "sample.py");
		discoverFilesMock.mockResolvedValue([fakeUri(samplePath)] as never);

		const { results } = await search("hello", cache, WASM_DIR, WORKSPACE_URIS, {
			scoreCutoff: 0,
		});

		for (let i = 1; i < results.length; i++) {
			const prev = results[i - 1];
			const curr = results[i];
			if (prev && curr) {
				expect(prev.score).toBeGreaterThanOrEqual(curr.score);
			}
		}
	});

	it("should use cached data on subsequent searches", async () => {
		const samplePath = resolve(FIXTURE_DIR, "sample.py");
		discoverFilesMock.mockResolvedValue([fakeUri(samplePath)] as never);

		// First search — populates cache
		await search("hello", cache, WASM_DIR, WORKSPACE_URIS);
		expect(cache.isReady).toBe(true);

		// Second search — should use cache (no re-parse needed)
		const { results } = await search("hello", cache, WASM_DIR, WORKSPACE_URIS);
		expect(results.length).toBeGreaterThanOrEqual(1);
	});

	it("should respect maxResults option", async () => {
		const samplePath = resolve(FIXTURE_DIR, "sample.py");
		discoverFilesMock.mockResolvedValue([fakeUri(samplePath)] as never);

		const { results } = await search("string", cache, WASM_DIR, WORKSPACE_URIS, {
			scoreCutoff: 0,
			maxResults: 3,
		});

		expect(results.length).toBeLessThanOrEqual(3);
	});

	it("should respect scoreCutoff option", async () => {
		const samplePath = resolve(FIXTURE_DIR, "sample.py");
		discoverFilesMock.mockResolvedValue([fakeUri(samplePath)] as never);

		const { results } = await search("hello world", cache, WASM_DIR, WORKSPACE_URIS, {
			scoreCutoff: 90,
		});

		for (const r of results) {
			expect(r.score).toBeGreaterThanOrEqual(90);
		}
	});

	it("should handle files with no matching strings gracefully", async () => {
		const samplePath = resolve(FIXTURE_DIR, "sample.py");
		discoverFilesMock.mockResolvedValue([fakeUri(samplePath)] as never);

		const { results } = await search("zzz_no_match_zzz_xyzzy", cache, WASM_DIR, WORKSPACE_URIS, {
			scoreCutoff: 99,
		});

		expect(results).toHaveLength(0);
	});

	it("should return empty results when no files are discovered", async () => {
		discoverFilesMock.mockResolvedValue([]);

		const { results } = await search("hello", cache, WASM_DIR, WORKSPACE_URIS);
		expect(results).toHaveLength(0);
	});

	it("should skip files with unsupported extensions", async () => {
		// A .txt file has no registered language support
		const txtPath = resolve(FIXTURE_DIR, "nonexistent.txt");
		discoverFilesMock.mockResolvedValue([fakeUri(txtPath)] as never);

		const { results } = await search("hello", cache, WASM_DIR, WORKSPACE_URIS, {
			scoreCutoff: 0,
		});
		expect(results).toHaveLength(0);
	});

	it("should handle cancellation before file processing", async () => {
		const samplePath = resolve(FIXTURE_DIR, "sample.py");
		discoverFilesMock.mockResolvedValue([fakeUri(samplePath)] as never);

		const token = { isCancellationRequested: true, onCancellationRequested: vi.fn() };
		const { results } = await search("hello", cache, WASM_DIR, WORKSPACE_URIS, {
			token: token as never,
		});

		expect(results).toHaveLength(0);
	});

	it("should search across multiple files", async () => {
		const samplePath = resolve(FIXTURE_DIR, "sample.py");
		// Use the same file twice to simulate multiple files
		discoverFilesMock.mockResolvedValue([fakeUri(samplePath), fakeUri(samplePath)] as never);

		const { results } = await search("hello world", cache, WASM_DIR, WORKSPACE_URIS, {
			scoreCutoff: 60,
		});

		// Both "copies" produce the same URI so dedup means same locations
		// But there should still be at least one result
		const exactMatches = results.filter((r) => r.content === "hello world" && r.score === 100);
		expect(exactMatches.length).toBeGreaterThanOrEqual(1);
	});

	it("should return timing information", async () => {
		const samplePath = resolve(FIXTURE_DIR, "sample.py");
		discoverFilesMock.mockResolvedValue([fakeUri(samplePath)] as never);

		const { timings } = await search("hello", cache, WASM_DIR, WORKSPACE_URIS);

		expect(timings.totalSec).toBeGreaterThanOrEqual(0);
		expect(timings.discoverySec).toBeGreaterThanOrEqual(0);
		expect(timings.collectSec).toBeGreaterThanOrEqual(0);
		expect(timings.matchSec).toBeGreaterThanOrEqual(0);
	});

	it("should pass includeGlob and excludeGlob to discoverFiles", async () => {
		discoverFilesMock.mockResolvedValue([]);

		await search("hello", cache, WASM_DIR, WORKSPACE_URIS, {
			includeGlob: "**/*.py",
			excludeGlob: "**/test/**",
		});

		expect(discoverFilesMock).toHaveBeenCalledWith("**/*.py", "**/test/**", undefined, undefined);
	});

	it("should include filePath and segments in results", async () => {
		const samplePath = resolve(FIXTURE_DIR, "sample.py");
		discoverFilesMock.mockResolvedValue([fakeUri(samplePath)] as never);

		const { results } = await search("hello world", cache, WASM_DIR, WORKSPACE_URIS, {
			scoreCutoff: 90,
		});

		expect(results.length).toBeGreaterThanOrEqual(1);
		const match = results[0] as (typeof results)[0];
		expect(match).toBeDefined();
		expect(match.filePath).toBeTruthy();
		expect(match.segments).toBeDefined();
		expect(match.segments.length).toBeGreaterThanOrEqual(1);
	});
});
