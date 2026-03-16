import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PersistentCache } from "../../src/cache/persistent-cache.js";
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

function hashContent(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

describe("PersistentCache", () => {
	let storageDir: string;
	let fixtureDir: string;
	const workspaceUris = ["file:///workspace/project"];

	beforeEach(async () => {
		// Create unique temp directories for each test
		const base = join(
			tmpdir(),
			`persistent-cache-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		storageDir = join(base, "storage");
		fixtureDir = join(base, "fixtures");
		await mkdir(storageDir, { recursive: true });
		await mkdir(fixtureDir, { recursive: true });
	});

	afterEach(async () => {
		// Clean up temp directories
		const base = join(storageDir, "..");
		await rm(base, { recursive: true, force: true });
	});

	it("should save and load a round-trip successfully", async () => {
		const filePath = join(fixtureDir, "test.py");
		const fileContent = 'x = "hello world"';
		await writeFile(filePath, fileContent, "utf-8");

		const fileUri = `file:///${filePath.replace(/\\/g, "/")}`;
		const hash = hashContent(fileContent);

		// Populate and save
		const cache = new StringCache();
		cache.set(fileUri, [makeSourceString("hello world", filePath)], hash);

		const persistent = new PersistentCache(storageDir);
		await persistent.save(cache, workspaceUris);

		// Load into a fresh cache
		const cache2 = new StringCache();
		const loaded = await persistent.load(cache2, workspaceUris);

		expect(loaded).toBe(1);
		expect(cache2.get(fileUri)).toEqual([makeSourceString("hello world", filePath)]);
	});

	it("should skip entries with stale content hash", async () => {
		const filePath = join(fixtureDir, "test.py");
		const originalContent = 'x = "hello"';
		await writeFile(filePath, originalContent, "utf-8");

		const fileUri = `file:///${filePath.replace(/\\/g, "/")}`;
		const hash = hashContent(originalContent);

		// Save with original hash
		const cache = new StringCache();
		cache.set(fileUri, [makeSourceString("hello", filePath)], hash);

		const persistent = new PersistentCache(storageDir);
		await persistent.save(cache, workspaceUris);

		// Modify the file on disk
		await writeFile(filePath, 'x = "goodbye"', "utf-8");

		// Load — should skip due to hash mismatch
		const cache2 = new StringCache();
		const loaded = await persistent.load(cache2, workspaceUris);

		expect(loaded).toBe(0);
		expect(cache2.get(fileUri)).toBeUndefined();
	});

	it("should skip entries for deleted files", async () => {
		const filePath = join(fixtureDir, "deleted.py");
		const content = 'x = "gone"';
		await writeFile(filePath, content, "utf-8");

		const fileUri = `file:///${filePath.replace(/\\/g, "/")}`;
		const hash = hashContent(content);

		// Save
		const cache = new StringCache();
		cache.set(fileUri, [makeSourceString("gone", filePath)], hash);

		const persistent = new PersistentCache(storageDir);
		await persistent.save(cache, workspaceUris);

		// Delete the file
		await rm(filePath);

		// Load — should skip
		const cache2 = new StringCache();
		const loaded = await persistent.load(cache2, workspaceUris);

		expect(loaded).toBe(0);
	});

	it("should return 0 when no cache file exists", async () => {
		const persistent = new PersistentCache(storageDir);
		const cache = new StringCache();
		const loaded = await persistent.load(cache, workspaceUris);

		expect(loaded).toBe(0);
		expect(cache.size).toBe(0);
	});

	it("should discard cache with wrong schema version", async () => {
		const persistent = new PersistentCache(storageDir);

		// Write a cache file with wrong version directly
		const cacheDir = join(storageDir, "cache");
		await mkdir(cacheDir, { recursive: true });

		// We need to figure out the filename — save then overwrite
		const tempCache = new StringCache();
		const filePath = join(fixtureDir, "v.py");
		await writeFile(filePath, "x = 1", "utf-8");
		const fileUri = `file:///${filePath.replace(/\\/g, "/")}`;
		tempCache.set(fileUri, [], hashContent("x = 1"));
		await persistent.save(tempCache, workspaceUris);

		// Find and overwrite the cache file with wrong version
		const { readdir } = await import("node:fs/promises");
		const files = await readdir(cacheDir);
		expect(files).toHaveLength(1);
		const cacheFileName = files[0];
		expect(cacheFileName).toBeDefined();
		const cacheFilePath = join(cacheDir, cacheFileName as string);
		const data = JSON.parse(await readFile(cacheFilePath, "utf-8"));
		data.version = 999;
		await writeFile(cacheFilePath, JSON.stringify(data), "utf-8");

		// Load — should discard
		const cache = new StringCache();
		const loaded = await persistent.load(cache, workspaceUris);

		expect(loaded).toBe(0);
	});

	it("should handle corrupt JSON gracefully", async () => {
		const persistent = new PersistentCache(storageDir);

		// Create a corrupt cache file
		const cacheDir = join(storageDir, "cache");
		await mkdir(cacheDir, { recursive: true });

		// Save a valid cache first to get the filename
		const tempCache = new StringCache();
		const filePath = join(fixtureDir, "c.py");
		await writeFile(filePath, "x = 1", "utf-8");
		const fileUri = `file:///${filePath.replace(/\\/g, "/")}`;
		tempCache.set(fileUri, [], hashContent("x = 1"));
		await persistent.save(tempCache, workspaceUris);

		// Corrupt the file
		const { readdir } = await import("node:fs/promises");
		const files = await readdir(cacheDir);
		const cacheFileName = files[0] as string;
		const cacheFilePath = join(cacheDir, cacheFileName);
		await writeFile(cacheFilePath, "not valid json{{{", "utf-8");

		const cache = new StringCache();
		const loaded = await persistent.load(cache, workspaceUris);

		expect(loaded).toBe(0);
	});

	it("should not save when cache is empty", async () => {
		const persistent = new PersistentCache(storageDir);
		const cache = new StringCache();
		await persistent.save(cache, workspaceUris);

		// Cache dir should not even be created
		const { access } = await import("node:fs/promises");
		await expect(access(join(storageDir, "cache"))).rejects.toThrow();
	});

	it("should handle multiple entries with mixed validity", async () => {
		const validPath = join(fixtureDir, "valid.py");
		const stalePath = join(fixtureDir, "stale.py");
		const validContent = 'a = "valid"';
		const staleContent = 'b = "stale"';

		await writeFile(validPath, validContent, "utf-8");
		await writeFile(stalePath, staleContent, "utf-8");

		const validUri = `file:///${validPath.replace(/\\/g, "/")}`;
		const staleUri = `file:///${stalePath.replace(/\\/g, "/")}`;

		const cache = new StringCache();
		cache.set(validUri, [makeSourceString("valid", validPath)], hashContent(validContent));
		cache.set(staleUri, [makeSourceString("stale", stalePath)], hashContent(staleContent));

		const persistent = new PersistentCache(storageDir);
		await persistent.save(cache, workspaceUris);

		// Modify one file
		await writeFile(stalePath, 'b = "changed"', "utf-8");

		const cache2 = new StringCache();
		const loaded = await persistent.load(cache2, workspaceUris);

		expect(loaded).toBe(1);
		expect(cache2.get(validUri)).toBeDefined();
		expect(cache2.get(staleUri)).toBeUndefined();
	});
});
