import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CacheEntry, StringCache } from "./string-cache.js";

export interface PersistentCacheLogger {
	appendLine(message: string): void;
}

/**
 * Current schema version. Bump on breaking changes to force a full re-parse.
 */
const CACHE_SCHEMA_VERSION = 1;

/**
 * Maximum age (in days) for workspace cache files before they are pruned.
 */
const MAX_CACHE_AGE_DAYS = 30;

/**
 * Serialized format of a single cache entry on disk.
 */
interface PersistedCacheEntry {
	contentHash: string;
	strings: CacheEntry["strings"];
}

/**
 * Serialized format of the entire cache file on disk.
 */
interface PersistedCacheFile {
	version: number;
	entries: Record<string, PersistedCacheEntry>;
}

/**
 * Compute a short identifier for a workspace based on its folder URIs.
 */
function workspaceHash(workspaceFolderUris: string[]): string {
	const sorted = [...workspaceFolderUris].sort();
	return createHash("sha256").update(sorted.join("\n")).digest("hex").slice(0, 16);
}

/**
 * Handles persisting and restoring the in-memory StringCache to/from disk.
 *
 * Cache files are stored as JSON in a `cache/` subdirectory under the
 * extension's global storage directory. Each workspace gets its own file,
 * identified by a hash of its folder URIs.
 */
export class PersistentCache {
	private readonly cacheDir: string;
	private readonly logger?: PersistentCacheLogger;

	constructor(globalStoragePath: string, logger?: PersistentCacheLogger) {
		this.cacheDir = join(globalStoragePath, "cache");
		this.logger = logger;
	}

	/**
	 * Load persisted cache entries and populate the in-memory StringCache.
	 *
	 * Only entries whose files still exist on disk with the same content hash
	 * are loaded. Stale or unreadable entries are silently skipped.
	 *
	 * @returns The number of valid entries loaded.
	 */
	async load(cache: StringCache, workspaceFolderUris: string[]): Promise<number> {
		const filePath = this.cacheFilePath(workspaceFolderUris);
		this.logger?.appendLine(`Persistent cache path: ${filePath}`);

		let data: PersistedCacheFile;
		try {
			const raw = await readFile(filePath, "utf-8");
			data = JSON.parse(raw) as PersistedCacheFile;
		} catch {
			this.logger?.appendLine("Persistent cache: no cache file found");
			return 0;
		}

		if (data.version !== CACHE_SCHEMA_VERSION) {
			this.logger?.appendLine(
				`Persistent cache: schema version mismatch (got ${data.version}, expected ${CACHE_SCHEMA_VERSION}) — discarding`,
			);
			await this.deleteFile(filePath);
			return 0;
		}

		let loaded = 0;
		const uris = Object.keys(data.entries);

		// Validate entries concurrently with a simple Promise.all
		const results = await Promise.all(
			uris.map(async (uri) => {
				const entry = data.entries[uri];
				if (!entry) return null;

				// Convert file:// URI to filesystem path for reading
				const fsPath = fileUriToFsPath(uri);
				if (!fsPath) return null;

				try {
					const content = await readFile(fsPath, "utf-8");
					const hash = createHash("sha256").update(content).digest("hex");
					if (hash === entry.contentHash) {
						return { uri, entry };
					}
				} catch {
					// File unreadable (deleted, moved, etc.) — skip
				}
				return null;
			}),
		);

		for (const result of results) {
			if (result) {
				cache.set(result.uri, result.entry.strings, result.entry.contentHash);
				loaded++;
			}
		}

		this.logger?.appendLine(`Persistent cache: loaded ${loaded}/${uris.length} entries`);
		// Loading from disk doesn't count as a modification needing re-save
		cache.clearDirty();
		return loaded;
	}

	/**
	 * Persist the current in-memory StringCache to disk.
	 */
	async save(cache: StringCache, workspaceFolderUris: string[]): Promise<void> {
		if (cache.size === 0) return;

		const entries: Record<string, PersistedCacheEntry> = {};
		for (const [uri, entry] of cache.entries()) {
			entries[uri] = {
				contentHash: entry.contentHash,
				strings: entry.strings,
			};
		}

		const data: PersistedCacheFile = {
			version: CACHE_SCHEMA_VERSION,
			entries,
		};

		const filePath = this.cacheFilePath(workspaceFolderUris);
		const tmpPath = `${filePath}.tmp`;
		await mkdir(this.cacheDir, { recursive: true });
		await writeFile(tmpPath, JSON.stringify(data), "utf-8");
		await rename(tmpPath, filePath);
		cache.clearDirty();
		this.logger?.appendLine(`Persistent cache: saved ${cache.size} entries to ${filePath}`);
	}

	/**
	 * Remove stale workspace cache files older than MAX_CACHE_AGE_DAYS.
	 */
	async pruneStale(): Promise<number> {
		let pruned = 0;
		const now = Date.now();
		const maxAgeMs = MAX_CACHE_AGE_DAYS * 24 * 60 * 60 * 1000;

		let files: string[];
		try {
			files = await readdir(this.cacheDir);
		} catch {
			return 0;
		}

		for (const file of files) {
			if (!file.endsWith(".json")) continue;
			const filePath = join(this.cacheDir, file);
			try {
				const fileStat = await stat(filePath);
				if (now - fileStat.mtimeMs > maxAgeMs) {
					await rm(filePath);
					pruned++;
				}
			} catch {
				// Ignore errors on individual files
			}
		}

		return pruned;
	}

	private cacheFilePath(workspaceFolderUris: string[]): string {
		return join(this.cacheDir, `${workspaceHash(workspaceFolderUris)}.json`);
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
function fileUriToFsPath(uri: string): string | undefined {
	if (!uri.startsWith("file://")) return undefined;
	try {
		const url = new URL(uri);
		// On Windows, URL.pathname starts with /C:/... — remove the leading slash
		let fsPath = decodeURIComponent(url.pathname);
		if (process.platform === "win32" && fsPath.startsWith("/")) {
			fsPath = fsPath.slice(1);
		}
		return fsPath;
	} catch {
		return undefined;
	}
}
