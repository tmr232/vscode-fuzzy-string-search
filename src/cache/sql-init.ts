import { join } from "node:path";
import initSqlJsModule, { type SqlJsStatic } from "sql.js";

let sqlJsPromise: Promise<SqlJsStatic> | undefined;

/**
 * Initialize the sql.js WASM runtime.
 * Must be called before creating any SqliteCache. Safe to call multiple times —
 * the WASM module is loaded only once.
 *
 * @param wasmDir - Absolute path to directory containing sql-wasm.wasm.
 *   Required when running inside the VSCode extension (bundled WASM).
 *   Omit in tests (sql.js resolves its own WASM automatically).
 */
export function initSqlJs(wasmDir?: string): Promise<SqlJsStatic> {
	if (!sqlJsPromise) {
		const locateFile = wasmDir ? (file: string) => join(wasmDir, file) : undefined;
		sqlJsPromise = initSqlJsModule(locateFile ? { locateFile } : undefined);
	}
	return sqlJsPromise;
}

/**
 * Get the cached sql.js module. Throws if `initSqlJs` hasn't been called yet.
 */
export async function getSqlJs(): Promise<SqlJsStatic> {
	if (!sqlJsPromise) {
		throw new Error("sql.js not initialized — call initSqlJs() first");
	}
	return sqlJsPromise;
}

/**
 * Reset module state. Intended for tests only.
 */
export function resetSqlJs(): void {
	sqlJsPromise = undefined;
}
