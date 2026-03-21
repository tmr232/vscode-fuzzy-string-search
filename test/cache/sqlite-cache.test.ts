import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteCache } from "../../src/cache/sqlite-cache.js";
import type { SourceString } from "../../src/types.js";

function makeSourceString(content: string, filePath = "/test.py", startLine = 0): SourceString {
	return {
		content,
		filePath,
		startLine,
		startColumn: 0,
		endLine: startLine,
		endColumn: content.length,
		segments: [
			{
				contentLength: content.length,
				startLine,
				startColumn: 0,
				endLine: startLine,
				endColumn: content.length,
			},
		],
	};
}

function hashContent(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

describe("SqliteCache", () => {
	let storageDir: string;
	let fixtureDir: string;
	const workspaceUris = ["file:///workspace/project"];

	beforeEach(async () => {
		const base = join(
			tmpdir(),
			`sqlite-cache-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		storageDir = join(base, "storage");
		fixtureDir = join(base, "fixtures");
		await mkdir(storageDir, { recursive: true });
		await mkdir(fixtureDir, { recursive: true });
	});

	afterEach(async () => {
		const base = join(storageDir, "..");
		await rm(base, { recursive: true, force: true });
	});

	it("should initialize with empty state", async () => {
		const cache = new SqliteCache(storageDir);

		await cache.ensureReady(workspaceUris, [], async () => null);

		expect(cache.getAllContents()).toHaveLength(0);
		expect(cache.isReady).toBe(true);

		cache.dispose();
	});

	it("should store and retrieve strings from parsed files", async () => {
		const filePath = join(fixtureDir, "test.py");
		const fileContent = 'x = "hello world"';
		await writeFile(filePath, fileContent, "utf-8");

		const fileUri = `file:///${filePath.replace(/\\/g, "/")}`;
		const hash = hashContent(fileContent);

		const cache = new SqliteCache(storageDir);

		await cache.ensureReady(workspaceUris, [fileUri], async (uri) => {
			if (uri === fileUri) {
				return {
					strings: [makeSourceString("hello world", filePath)],
					contentHash: hash,
				};
			}
			return null;
		});

		expect(cache.getAllContents()).toEqual(["hello world"]);
		expect(cache.getIdForContent("hello world")).toBeDefined();

		cache.dispose();
	});

	it("should deduplicate identical strings across files", async () => {
		const file1 = join(fixtureDir, "a.py");
		const file2 = join(fixtureDir, "b.py");
		await writeFile(file1, 'x = "shared"', "utf-8");
		await writeFile(file2, 'y = "shared"', "utf-8");

		const uri1 = `file:///${file1.replace(/\\/g, "/")}`;
		const uri2 = `file:///${file2.replace(/\\/g, "/")}`;

		const cache = new SqliteCache(storageDir);

		await cache.ensureReady(workspaceUris, [uri1, uri2], async (uri) => {
			if (uri === uri1) {
				return {
					strings: [makeSourceString("shared", file1)],
					contentHash: hashContent('x = "shared"'),
				};
			}
			if (uri === uri2) {
				return {
					strings: [makeSourceString("shared", file2)],
					contentHash: hashContent('y = "shared"'),
				};
			}
			return null;
		});

		// Only one unique string content
		expect(cache.getAllContents()).toEqual(["shared"]);

		// But two location rows
		const id = cache.getIdForContent("shared") as number;
		expect(id).toBeDefined();
		const locations = cache.getLocationsForIds([id]);
		expect(locations).toHaveLength(2);

		cache.dispose();
	});

	it("should return locations for matched IDs", async () => {
		const filePath = join(fixtureDir, "test.py");
		await writeFile(filePath, 'x = "hello"', "utf-8");

		const fileUri = `file:///${filePath.replace(/\\/g, "/")}`;

		const cache = new SqliteCache(storageDir);

		await cache.ensureReady(workspaceUris, [fileUri], async (uri) => {
			if (uri === fileUri) {
				return {
					strings: [makeSourceString("hello", filePath, 5)],
					contentHash: hashContent('x = "hello"'),
				};
			}
			return null;
		});

		const id = cache.getIdForContent("hello") as number;
		expect(id).toBeDefined();

		const locations = cache.getLocationsForIds([id]);
		expect(locations).toHaveLength(1);
		expect(locations[0]?.content).toBe("hello");
		expect(locations[0]?.fileUri).toBe(fileUri);
		expect(locations[0]?.segments).toHaveLength(1);
		expect(locations[0]?.segments[0]?.startLine).toBe(5);

		cache.dispose();
	});

	it("should detect stale files and re-parse them", async () => {
		const filePath = join(fixtureDir, "test.py");
		const fileUri = `file:///${filePath.replace(/\\/g, "/")}`;

		// First run: write original content
		await writeFile(filePath, 'x = "hello"', "utf-8");

		const cache = new SqliteCache(storageDir);
		await cache.ensureReady(workspaceUris, [fileUri], async (uri) => {
			if (uri === fileUri) {
				return {
					strings: [makeSourceString("hello", filePath)],
					contentHash: hashContent('x = "hello"'),
				};
			}
			return null;
		});

		// Save and dispose
		await cache.save(workspaceUris);
		cache.dispose();

		// Modify the file
		await writeFile(filePath, 'x = "goodbye"', "utf-8");

		// Second run: should detect staleness and re-parse
		const cache2 = new SqliteCache(storageDir);
		await cache2.ensureReady(workspaceUris, [fileUri], async (uri) => {
			if (uri === fileUri) {
				return {
					strings: [makeSourceString("goodbye", filePath)],
					contentHash: hashContent('x = "goodbye"'),
				};
			}
			return null;
		});

		expect(cache2.getAllContents()).toEqual(["goodbye"]);
		expect(cache2.getIdForContent("hello")).toBeUndefined();
		expect(cache2.getIdForContent("goodbye")).toBeDefined();

		cache2.dispose();
	});

	it("should handle deleted files", async () => {
		const filePath = join(fixtureDir, "test.py");
		const fileUri = `file:///${filePath.replace(/\\/g, "/")}`;

		await writeFile(filePath, 'x = "hello"', "utf-8");

		const cache = new SqliteCache(storageDir);
		await cache.ensureReady(workspaceUris, [fileUri], async (uri) => {
			if (uri === fileUri) {
				return {
					strings: [makeSourceString("hello", filePath)],
					contentHash: hashContent('x = "hello"'),
				};
			}
			return null;
		});

		// Save and dispose
		await cache.save(workspaceUris);
		cache.dispose();

		// Delete the file
		await rm(filePath);

		// Second run: file no longer in workspace
		const cache2 = new SqliteCache(storageDir);
		await cache2.ensureReady(
			workspaceUris,
			[], // empty workspace
			async () => null,
		);

		expect(cache2.getAllContents()).toHaveLength(0);

		cache2.dispose();
	});

	it("should persist and restore across instances", async () => {
		const filePath = join(fixtureDir, "test.py");
		const fileContent = 'x = "hello"';
		await writeFile(filePath, fileContent, "utf-8");

		const fileUri = `file:///${filePath.replace(/\\/g, "/")}`;
		const hash = hashContent(fileContent);

		// First instance: populate and save
		const cache1 = new SqliteCache(storageDir);
		await cache1.ensureReady(workspaceUris, [fileUri], async (uri) => {
			if (uri === fileUri) {
				return {
					strings: [makeSourceString("hello", filePath)],
					contentHash: hash,
				};
			}
			return null;
		});
		await cache1.save(workspaceUris);
		cache1.dispose();

		// Second instance: should load from disk without re-parsing
		let parseCalled = false;
		const cache2 = new SqliteCache(storageDir);
		await cache2.ensureReady(workspaceUris, [fileUri], async () => {
			parseCalled = true;
			return null;
		});

		// File hash hasn't changed, so it should NOT have been re-parsed
		expect(parseCalled).toBe(false);
		expect(cache2.getAllContents()).toEqual(["hello"]);

		cache2.dispose();
	});

	it("should handle markChanged for pending invalidations", async () => {
		const filePath = join(fixtureDir, "test.py");
		const fileUri = `file:///${filePath.replace(/\\/g, "/")}`;

		await writeFile(filePath, 'x = "hello"', "utf-8");

		const cache = new SqliteCache(storageDir);
		await cache.ensureReady(workspaceUris, [fileUri], async (uri) => {
			if (uri === fileUri) {
				return {
					strings: [makeSourceString("hello", filePath)],
					contentHash: hashContent('x = "hello"'),
				};
			}
			return null;
		});

		expect(cache.getAllContents()).toEqual(["hello"]);

		// Mark as changed
		cache.markChanged(fileUri);

		// Update file content
		await writeFile(filePath, 'x = "world"', "utf-8");

		// Process pending changes on next ensureReady
		await cache.ensureReady(workspaceUris, [fileUri], async (uri) => {
			if (uri === fileUri) {
				return {
					strings: [makeSourceString("world", filePath)],
					contentHash: hashContent('x = "world"'),
				};
			}
			return null;
		});

		expect(cache.getAllContents()).toEqual(["world"]);

		cache.dispose();
	});

	it("should handle markDeleted for pending invalidations", async () => {
		const filePath = join(fixtureDir, "test.py");
		const fileUri = `file:///${filePath.replace(/\\/g, "/")}`;

		await writeFile(filePath, 'x = "hello"', "utf-8");

		const cache = new SqliteCache(storageDir);
		await cache.ensureReady(workspaceUris, [fileUri], async (uri) => {
			if (uri === fileUri) {
				return {
					strings: [makeSourceString("hello", filePath)],
					contentHash: hashContent('x = "hello"'),
				};
			}
			return null;
		});

		expect(cache.getAllContents()).toEqual(["hello"]);

		// Mark as deleted
		cache.markDeleted(fileUri);

		// Process pending changes
		await cache.ensureReady(workspaceUris, [], async () => null);

		expect(cache.getAllContents()).toHaveLength(0);

		cache.dispose();
	});

	it("should get contents for specific files (scoped search)", async () => {
		const file1 = join(fixtureDir, "a.py");
		const file2 = join(fixtureDir, "b.py");
		await writeFile(file1, 'x = "aaa"', "utf-8");
		await writeFile(file2, 'y = "bbb"', "utf-8");

		const uri1 = `file:///${file1.replace(/\\/g, "/")}`;
		const uri2 = `file:///${file2.replace(/\\/g, "/")}`;

		const cache = new SqliteCache(storageDir);
		await cache.ensureReady(workspaceUris, [uri1, uri2], async (uri) => {
			if (uri === uri1) {
				return {
					strings: [makeSourceString("aaa", file1)],
					contentHash: hashContent('x = "aaa"'),
				};
			}
			if (uri === uri2) {
				return {
					strings: [makeSourceString("bbb", file2)],
					contentHash: hashContent('y = "bbb"'),
				};
			}
			return null;
		});

		// All contents includes both
		expect(cache.getAllContents()).toHaveLength(2);

		// Scoped to file 1 only
		const scoped = cache.getContentsForFiles([uri1]);
		expect(scoped).toEqual(["aaa"]);

		cache.dispose();
	});

	it("should handle schema version mismatch by discarding", async () => {
		const filePath = join(fixtureDir, "test.py");
		await writeFile(filePath, 'x = "hello"', "utf-8");

		const fileUri = `file:///${filePath.replace(/\\/g, "/")}`;

		// Create and save a cache
		const cache1 = new SqliteCache(storageDir);
		await cache1.ensureReady(workspaceUris, [fileUri], async () => ({
			strings: [makeSourceString("hello", filePath)],
			contentHash: hashContent('x = "hello"'),
		}));
		await cache1.save(workspaceUris);

		// Corrupt the schema version by opening the DB and changing PRAGMA user_version
		// We'll do this by loading the saved DB, changing it, and saving it back
		const initSqlJs = (await import("sql.js")).default;
		const SQL = await initSqlJs();
		const { readFile: rf } = await import("node:fs/promises");
		const { readdirSync } = await import("node:fs");
		const cacheDir = join(storageDir, "cache");
		const files = readdirSync(cacheDir);
		const dbFile = files.find((f) => f.endsWith(".sqlite")) as string;
		expect(dbFile).toBeDefined();
		const dbPath = join(cacheDir, dbFile);
		const dbData = await rf(dbPath);
		const db = new SQL.Database(dbData);
		db.run("PRAGMA user_version = 999");
		const { writeFile: wf } = await import("node:fs/promises");
		await wf(dbPath, Buffer.from(db.export()));
		db.close();

		cache1.dispose();

		// Second instance should discard and re-create
		const cache2 = new SqliteCache(storageDir);
		let parseCalledForNewDb = false;
		await cache2.ensureReady(workspaceUris, [fileUri], async () => {
			parseCalledForNewDb = true;
			return {
				strings: [makeSourceString("hello", filePath)],
				contentHash: hashContent('x = "hello"'),
			};
		});

		expect(parseCalledForNewDb).toBe(true);
		expect(cache2.getAllContents()).toEqual(["hello"]);

		cache2.dispose();
	});

	it("should track failed URIs", async () => {
		const cache = new SqliteCache(storageDir);
		await cache.ensureReady(workspaceUris, [], async () => null);

		expect(cache.getFailed("file:///bad.py")).toBeUndefined();

		cache.setFailed("file:///bad.py", "python");
		expect(cache.getFailed("file:///bad.py")).toBe("python");

		cache.dispose();
	});
});
