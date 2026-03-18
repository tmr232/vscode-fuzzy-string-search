import type { SourceString } from "../types.js";

/**
 * A cache entry storing parsed strings and the content hash used to detect staleness.
 */
export interface CacheEntry {
	/** SHA-256 hex digest of the file content at parse time. */
	contentHash: string;
	/** Parsed source strings. */
	strings: SourceString[];
}

/**
 * In-memory cache of parsed source strings keyed by file URI string.
 *
 * Each entry also stores the content hash of the file at parse time,
 * enabling persistent cache validation across restarts.
 */
export class StringCache {
	private readonly cache = new Map<string, CacheEntry>();
	/**
	 * URIs that failed to parse, mapped to their language ID.
	 * Kept only in memory — never persisted to disk.
	 */
	private readonly failedUris = new Map<string, string>();
	private _dirty = false;

	/**
	 * Whether the cache has been modified since the last call to {@link clearDirty}.
	 */
	get dirty(): boolean {
		return this._dirty;
	}

	/**
	 * Reset the dirty flag (e.g. after persisting to disk).
	 */
	clearDirty(): void {
		this._dirty = false;
	}

	/**
	 * Get cached strings for a file URI.
	 * Returns `undefined` if the file is not cached.
	 */
	get(uri: string): SourceString[] | undefined {
		return this.cache.get(uri)?.strings;
	}

	/**
	 * Get the full cache entry (strings + content hash) for a file URI.
	 * Returns `undefined` if the file is not cached.
	 */
	getEntry(uri: string): CacheEntry | undefined {
		return this.cache.get(uri);
	}

	/**
	 * Store parsed strings for a file URI along with the file's content hash.
	 */
	set(uri: string, strings: SourceString[], contentHash: string): void {
		this.cache.set(uri, { contentHash, strings });
		this._dirty = true;
	}

	/**
	 * Invalidate (remove) the cache entry for a file URI.
	 * Returns `true` if an entry was removed, `false` if no entry existed.
	 */
	invalidate(uri: string): boolean {
		this.failedUris.delete(uri);
		const deleted = this.cache.delete(uri);
		if (deleted) this._dirty = true;
		return deleted;
	}

	/**
	 * Record that a file URI failed to parse.
	 * This is kept in memory only and never persisted.
	 */
	setFailed(uri: string, languageId: string): void {
		this.failedUris.set(uri, languageId);
	}

	/**
	 * Get the language ID of a previously failed parse, or `undefined` if not failed.
	 */
	getFailed(uri: string): string | undefined {
		return this.failedUris.get(uri);
	}

	/**
	 * Clear all cached entries (including failed URIs).
	 */
	clear(): void {
		this.cache.clear();
		this.failedUris.clear();
	}

	/**
	 * Number of files currently cached.
	 */
	get size(): number {
		return this.cache.size;
	}

	/**
	 * Check whether a file URI has a cache entry.
	 */
	has(uri: string): boolean {
		return this.cache.has(uri);
	}

	/**
	 * Iterate over all cache entries.
	 */
	entries(): IterableIterator<[string, CacheEntry]> {
		return this.cache.entries();
	}
}
