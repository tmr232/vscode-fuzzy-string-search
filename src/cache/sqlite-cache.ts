import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import initSqlJs, { type Database } from "sql.js";
import type { ContentSegment, SourceString } from "../types.js";

export interface CacheLogger {
	appendLine(message: string): void;
}

/**
 * Current schema version. Bump on breaking changes to force a full re-create.
 */
const CACHE_SCHEMA_VERSION = 1;

/**
 * A location row returned when querying matched string IDs.
 */
export interface LocationRow {
	stringId: number;
	content: string;
	fileUri: string;
	segments: ContentSegment[];
}

/**
 * SQLite-based tiered cache (ADR-007).
 *
 * Three tables separate concerns by access pattern:
 * - `strings` — loaded in bulk into memory for fuzzy matching
 * - `files` — keyed lookups for staleness detection
 * - `locations` — queried on demand for matched string IDs
 *
 * Uses sql.js (SQLite compiled to WASM) to avoid native addon packaging issues.
 */
export class SqliteCache {
	private db?: Database;
	private ready = false;
	private dirty = false;

	/** In-memory index: content → string ID. */
	private contentToId = new Map<string, number>();
	/** All string contents for fuzzy matching. */
	private allContents: string[] = [];

	/** URIs that changed since last sync. */
	private changedUris = new Set<string>();
	/** URIs that were deleted since last sync. */
	private deletedUris = new Set<string>();
	/** URIs that failed to parse, mapped to their language ID. */
	private failedUris = new Map<string, string>();

	private readonly cacheDir: string;

	constructor(
		globalStoragePath: string,
		private readonly logger?: CacheLogger,
	) {
		this.cacheDir = join(globalStoragePath, "cache");
	}

	/**
	 * Ensure the cache is initialized and synced with the workspace.
	 *
	 * On first call: opens or creates the SQLite DB, loads the strings table
	 * into memory, and validates cached files against the workspace.
	 *
	 * On subsequent calls: processes any pending changed/deleted URIs.
	 *
	 * @param workspaceFolderUris - Workspace folder URI strings (for cache file naming).
	 * @param parseFile - Callback to parse a file URI into SourceStrings.
	 *   Called for files that need (re-)parsing. Should return null if the file
	 *   cannot be parsed (wrong language, read error, etc.).
	 * @param allFileUris - All workspace file URIs to validate against.
	 */
	async ensureReady(
		workspaceFolderUris: string[],
		wasmDir: string,
		allFileUris: string[],
		parseFile: (uri: string) => Promise<{
			strings: SourceString[];
			contentHash: string;
		} | null>,
		onProgress?: (parsed: number, total: number) => void,
	): Promise<void> {
		if (!this.ready) {
			await this.initDb(workspaceFolderUris, wasmDir);
			await this.validateAndSync(allFileUris, parseFile, onProgress);
			this.ready = true;
			return;
		}

		// Process pending invalidations
		await this.processPendingChanges(parseFile);
	}

	/**
	 * Mark a file URI as changed (needs re-parsing on next search).
	 */
	markChanged(uri: string): void {
		this.changedUris.add(uri);
		this.deletedUris.delete(uri);
		this.failedUris.delete(uri);
	}

	/**
	 * Mark a file URI as deleted.
	 */
	markDeleted(uri: string): void {
		this.deletedUris.add(uri);
		this.changedUris.delete(uri);
		this.failedUris.delete(uri);
	}

	/**
	 * Record that a file URI failed to parse.
	 */
	setFailed(uri: string, languageId: string): void {
		this.failedUris.set(uri, languageId);
	}

	/**
	 * Get the language ID of a previously failed parse, or undefined.
	 */
	getFailed(uri: string): string | undefined {
		return this.failedUris.get(uri);
	}

	/**
	 * Get all string contents for fuzzy matching.
	 */
	getAllContents(): string[] {
		return this.allContents;
	}

	/**
	 * Get the string ID for a given content, or undefined if not in the cache.
	 */
	getIdForContent(content: string): number | undefined {
		return this.contentToId.get(content);
	}

	/**
	 * Get string contents for a specific set of file URIs (for scoped searches).
	 */
	getContentsForFiles(fileUris: readonly string[]): string[] {
		if (!this.db) return [];

		const contents: string[] = [];
		const seen = new Set<string>();
		const stmt = this.db.prepare(
			"SELECT DISTINCT s.content FROM locations l JOIN strings s ON l.string_id = s.id WHERE l.file_uri = ?",
		);

		for (const uri of fileUris) {
			stmt.bind([uri]);
			while (stmt.step()) {
				const content = stmt.get()[0] as string;
				if (!seen.has(content)) {
					seen.add(content);
					contents.push(content);
				}
			}
			stmt.reset();
		}
		stmt.free();
		return contents;
	}

	/**
	 * Query locations for a set of matched string IDs.
	 * Returns rows with content, file URI, and segments.
	 */
	getLocationsForIds(ids: readonly number[]): LocationRow[] {
		if (!this.db || ids.length === 0) return [];

		const rows: LocationRow[] = [];
		// Chunk to avoid SQLite parameter limits
		const CHUNK_SIZE = 500;
		for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
			const chunk = ids.slice(i, i + CHUNK_SIZE);
			const placeholders = chunk.map(() => "?").join(",");
			const stmt = this.db.prepare(
				`SELECT l.string_id, s.content, l.file_uri, l.segments
				 FROM locations l
				 JOIN strings s ON l.string_id = s.id
				 WHERE l.string_id IN (${placeholders})`,
			);
			stmt.bind(chunk);
			while (stmt.step()) {
				const row = stmt.get();
				rows.push({
					stringId: row[0] as number,
					content: row[1] as string,
					fileUri: row[2] as string,
					segments: JSON.parse(row[3] as string) as ContentSegment[],
				});
			}
			stmt.free();
		}
		return rows;
	}

	/**
	 * Get the cached content hash for a file URI, or undefined if not cached.
	 */
	getCachedHash(uri: string): string | undefined {
		if (!this.db) return undefined;
		const stmt = this.db.prepare("SELECT hash FROM files WHERE uri = ?");
		stmt.bind([uri]);
		let hash: string | undefined;
		if (stmt.step()) {
			hash = stmt.get()[0] as string;
		}
		stmt.free();
		return hash;
	}

	/**
	 * Persist the in-memory database to disk.
	 */
	async save(workspaceFolderUris: string[]): Promise<void> {
		if (!this.db || !this.dirty) return;

		const filePath = this.dbFilePath(workspaceFolderUris);
		await mkdir(this.cacheDir, { recursive: true });
		const data = this.db.export();
		const buffer = Buffer.from(data);
		const tmpPath = `${filePath}.tmp`;
		await writeFile(tmpPath, buffer);
		const { rename } = await import("node:fs/promises");
		await rename(tmpPath, filePath);
		this.dirty = false;
		this.logger?.appendLine(`SQLite cache: saved to ${filePath} (${buffer.length} bytes)`);
	}

	/**
	 * Close the database and release resources.
	 */
	dispose(): void {
		this.db?.close();
		this.db = undefined;
		this.ready = false;
		this.contentToId.clear();
		this.allContents = [];
		this.changedUris.clear();
		this.deletedUris.clear();
		this.failedUris.clear();
	}

	/**
	 * Whether the cache has been initialized (DB loaded and validated).
	 */
	get isReady(): boolean {
		return this.ready;
	}

	/**
	 * Whether the cache has unsaved changes.
	 */
	get isDirty(): boolean {
		return this.dirty;
	}

	// --- Private methods ---

	private async initDb(workspaceFolderUris: string[], wasmDir: string): Promise<void> {
		const filePath = this.dbFilePath(workspaceFolderUris);
		this.logger?.appendLine(`SQLite cache path: ${filePath}`);

		const SQL = await initSqlJs({ locateFile: (file: string) => join(wasmDir, file) });

		// Try to load existing DB from disk
		let db: Database;
		try {
			const fileData = await readFile(filePath);
			db = new SQL.Database(fileData);

			// Check schema version
			const versionResult = db.exec("PRAGMA user_version");
			const version =
				versionResult.length > 0 && versionResult[0]?.values?.[0]?.[0] !== undefined
					? (versionResult[0].values[0][0] as number)
					: 0;

			if (version !== CACHE_SCHEMA_VERSION) {
				this.logger?.appendLine(
					`SQLite cache: schema version mismatch (got ${version}, expected ${CACHE_SCHEMA_VERSION}) — discarding`,
				);
				db.close();
				await this.deleteFile(filePath);
				db = new SQL.Database();
				this.createSchema(db);
			}
		} catch {
			this.logger?.appendLine("SQLite cache: no existing DB found, creating new");
			db = new SQL.Database();
			this.createSchema(db);
		}

		this.db = db;
		this.loadStringsIntoMemory();
	}

	private createSchema(db: Database): void {
		db.run(`
			CREATE TABLE files (
				uri   TEXT PRIMARY KEY,
				hash  TEXT NOT NULL
			);

			CREATE TABLE strings (
				id      INTEGER PRIMARY KEY,
				content TEXT NOT NULL UNIQUE
			);

			CREATE TABLE locations (
				string_id  INTEGER NOT NULL REFERENCES strings(id),
				file_uri   TEXT NOT NULL REFERENCES files(uri) ON DELETE CASCADE,
				segments   TEXT NOT NULL
			);

			CREATE INDEX idx_locations_string_id ON locations(string_id);
			CREATE INDEX idx_locations_file_uri ON locations(file_uri);

			PRAGMA user_version = ${CACHE_SCHEMA_VERSION};
		`);
		this.dirty = true;
	}

	private loadStringsIntoMemory(): void {
		if (!this.db) return;

		this.contentToId.clear();
		this.allContents = [];

		const stmt = this.db.prepare("SELECT id, content FROM strings");
		while (stmt.step()) {
			const row = stmt.get();
			const id = row[0] as number;
			const content = row[1] as string;
			this.contentToId.set(content, id);
			this.allContents.push(content);
		}
		stmt.free();

		this.logger?.appendLine(`SQLite cache: loaded ${this.allContents.length} strings into memory`);
	}

	/**
	 * Validate cached files against the workspace and re-parse stale entries.
	 */
	private async validateAndSync(
		allFileUris: string[],
		parseFile: (uri: string) => Promise<{
			strings: SourceString[];
			contentHash: string;
		} | null>,
		onProgress?: (parsed: number, total: number) => void,
	): Promise<void> {
		if (!this.db) return;

		const allFileSet = new Set(allFileUris);

		// Find cached files that no longer exist in the workspace
		const cachedUris: string[] = [];
		const stmt = this.db.prepare("SELECT uri FROM files");
		while (stmt.step()) {
			cachedUris.push(stmt.get()[0] as string);
		}
		stmt.free();

		const deletedUris = cachedUris.filter((uri) => !allFileSet.has(uri));
		if (deletedUris.length > 0) {
			this.removeFiles(deletedUris);
			this.logger?.appendLine(`SQLite cache: removed ${deletedUris.length} deleted files`);
		}

		// Validate remaining cached files by content hash
		const staleUris: string[] = [];
		const newUris: string[] = [];

		for (const uri of allFileUris) {
			const cachedHash = this.getCachedHash(uri);
			if (cachedHash === undefined) {
				newUris.push(uri);
				continue;
			}
			// Read and hash the file to check staleness
			const fsPath = fileUriToFsPath(uri);
			if (!fsPath) {
				staleUris.push(uri);
				continue;
			}
			try {
				const content = await readFile(fsPath, "utf-8");
				const hash = createHash("sha256").update(content).digest("hex");
				if (hash !== cachedHash) {
					staleUris.push(uri);
				}
			} catch {
				staleUris.push(uri);
			}
		}

		this.logger?.appendLine(
			`SQLite cache: ${cachedUris.length - deletedUris.length} cached, ${staleUris.length} stale, ${newUris.length} new`,
		);

		// Re-parse stale files
		if (staleUris.length > 0) {
			this.removeFiles(staleUris);
		}

		// Parse new and stale files
		const toParse = [...newUris, ...staleUris];
		let parsed = 0;
		for (const uri of toParse) {
			const result = await parseFile(uri);
			if (result) {
				this.upsertFile(uri, result.contentHash, result.strings);
				parsed++;
			}
			onProgress?.(parsed, toParse.length);
		}

		if (parsed > 0 || deletedUris.length > 0 || staleUris.length > 0) {
			this.cleanupOrphanedStrings();
			this.loadStringsIntoMemory();
		}

		this.logger?.appendLine(
			`SQLite cache: parsed ${parsed} files, total ${this.allContents.length} unique strings`,
		);
	}

	/**
	 * Process pending changed/deleted URIs.
	 */
	private async processPendingChanges(
		parseFile: (uri: string) => Promise<{
			strings: SourceString[];
			contentHash: string;
		} | null>,
	): Promise<void> {
		if (this.changedUris.size === 0 && this.deletedUris.size === 0) return;

		const changed = [...this.changedUris];
		const deleted = [...this.deletedUris];
		this.changedUris.clear();
		this.deletedUris.clear();

		if (deleted.length > 0) {
			this.removeFiles(deleted);
		}

		if (changed.length > 0) {
			this.removeFiles(changed);
			for (const uri of changed) {
				const result = await parseFile(uri);
				if (result) {
					this.upsertFile(uri, result.contentHash, result.strings);
				}
			}
		}

		if (changed.length > 0 || deleted.length > 0) {
			this.cleanupOrphanedStrings();
			this.loadStringsIntoMemory();
		}
	}

	/**
	 * Insert or update a file and its strings/locations in the database.
	 */
	private upsertFile(uri: string, contentHash: string, strings: SourceString[]): void {
		if (!this.db) return;

		this.db.run("BEGIN TRANSACTION");
		try {
			// Upsert file record
			this.db.run("INSERT OR REPLACE INTO files (uri, hash) VALUES (?, ?)", [uri, contentHash]);

			// Delete old locations for this file
			this.db.run("DELETE FROM locations WHERE file_uri = ?", [uri]);

			// Insert strings and locations
			const insertStringStmt = this.db.prepare(
				"INSERT OR IGNORE INTO strings (content) VALUES (?)",
			);
			const getStringIdStmt = this.db.prepare("SELECT id FROM strings WHERE content = ?");
			const insertLocationStmt = this.db.prepare(
				"INSERT INTO locations (string_id, file_uri, segments) VALUES (?, ?, ?)",
			);

			for (const str of strings) {
				// Insert string (ignore if duplicate due to UNIQUE constraint)
				insertStringStmt.run([str.content]);
				insertStringStmt.reset();

				// Get string ID
				getStringIdStmt.bind([str.content]);
				getStringIdStmt.step();
				const stringId = getStringIdStmt.get()[0] as number;
				getStringIdStmt.reset();

				// Insert location
				insertLocationStmt.run([stringId, uri, JSON.stringify(str.segments)]);
				insertLocationStmt.reset();
			}

			insertStringStmt.free();
			getStringIdStmt.free();
			insertLocationStmt.free();

			this.db.run("COMMIT");
			this.dirty = true;
		} catch (err) {
			this.db.run("ROLLBACK");
			throw err;
		}
	}

	/**
	 * Remove files and their locations from the database.
	 */
	private removeFiles(uris: string[]): void {
		if (!this.db || uris.length === 0) return;

		this.db.run("BEGIN TRANSACTION");
		try {
			for (const uri of uris) {
				this.db.run("DELETE FROM locations WHERE file_uri = ?", [uri]);
				this.db.run("DELETE FROM files WHERE uri = ?", [uri]);
			}
			this.db.run("COMMIT");
			this.dirty = true;
		} catch (err) {
			this.db.run("ROLLBACK");
			throw err;
		}
	}

	/**
	 * Remove strings that no longer have any location references.
	 */
	private cleanupOrphanedStrings(): void {
		if (!this.db) return;
		this.db.run("DELETE FROM strings WHERE id NOT IN (SELECT DISTINCT string_id FROM locations)");
	}

	private dbFilePath(workspaceFolderUris: string[]): string {
		const sorted = [...workspaceFolderUris].sort();
		const hash = createHash("sha256").update(sorted.join("\n")).digest("hex").slice(0, 16);
		return join(this.cacheDir, `${hash}.sqlite`);
	}

	private async deleteFile(filePath: string): Promise<void> {
		try {
			await rm(filePath);
		} catch {
			// Ignore — file may already be gone
		}
	}
}

/**
 * Convert a file:// URI string to a local filesystem path.
 * Returns `undefined` for non-file URIs.
 */
export function fileUriToFsPath(uri: string): string | undefined {
	if (!uri.startsWith("file://")) return undefined;
	try {
		const url = new URL(uri);
		let fsPath = decodeURIComponent(url.pathname);
		if (process.platform === "win32" && fsPath.startsWith("/")) {
			fsPath = fsPath.slice(1);
		}
		return fsPath;
	} catch {
		return undefined;
	}
}
