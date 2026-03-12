import type { SourceString } from "../types.js";

/**
 * In-memory cache of parsed source strings keyed by file URI string.
 *
 * Used to avoid re-parsing files that haven't changed between searches.
 */
export class StringCache {
	private readonly cache = new Map<string, SourceString[]>();

	/**
	 * Get cached strings for a file URI.
	 * Returns `undefined` if the file is not cached.
	 */
	get(uri: string): SourceString[] | undefined {
		return this.cache.get(uri);
	}

	/**
	 * Store parsed strings for a file URI.
	 */
	set(uri: string, strings: SourceString[]): void {
		this.cache.set(uri, strings);
	}

	/**
	 * Invalidate (remove) the cache entry for a file URI.
	 * Returns `true` if an entry was removed, `false` if no entry existed.
	 */
	invalidate(uri: string): boolean {
		return this.cache.delete(uri);
	}

	/**
	 * Clear all cached entries.
	 */
	clear(): void {
		this.cache.clear();
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
}
