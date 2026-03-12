import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type * as vscode from "vscode";
import type { StringCache } from "../cache/string-cache.js";
import { discoverFiles } from "../files/file-discovery.js";
import { getLanguageForFile } from "../languages/registry.js";
import type { MatchResult } from "../matching/fuzzy-matcher.js";
import { fuzzyMatch } from "../matching/fuzzy-matcher.js";
import { createParser, initTreeSitter, loadLanguage } from "../parsing/parser-manager.js";
import { collectStrings } from "../parsing/string-collector.js";
import type { SourceString } from "../types.js";

/**
 * Options for a search operation.
 */
export interface SearchOptions {
	/** Minimum score to include in results (0–100). Default: 60. */
	scoreCutoff?: number;
	/** Maximum number of results to return. Default: 100. */
	maxResults?: number;
	/** Glob pattern to restrict which files are searched. */
	includeGlob?: string;
	/** Glob pattern to exclude files from search. */
	excludeGlob?: string;
	/** Cancellation token for aborting the search. */
	token?: vscode.CancellationToken;
	/** Called each time results from a single file are ready. */
	onFileResults?: (results: MatchResult[]) => void;
}

const DEFAULT_SCORE_CUTOFF = 60;
const DEFAULT_MAX_RESULTS = 100;
const CONCURRENCY_LIMIT = 8;

/**
 * Parse a single file and return its source strings, using the cache when available.
 *
 * Returns `undefined` if the file's language is unsupported or parsing fails.
 */
async function getStringsForFile(
	uri: vscode.Uri,
	cache: StringCache,
	wasmDir: string,
): Promise<SourceString[] | undefined> {
	const uriString = uri.toString();
	const cached = cache.get(uriString);
	if (cached) return cached;

	const filePath = uri.fsPath;
	const langSupport = getLanguageForFile(filePath);
	if (!langSupport) return undefined;

	const wasmPath = join(wasmDir, langSupport.wasmFileName);
	const language = await loadLanguage(wasmPath);
	const parser = createParser(language);

	let source: string;
	try {
		source = await readFile(filePath, "utf-8");
	} catch {
		return undefined;
	}

	const strings = collectStrings(source, filePath, parser, langSupport);
	cache.set(uriString, strings);
	return strings;
}

/**
 * Process a batch of file URIs concurrently with a concurrency limit.
 *
 * Calls `processFn` for each URI and returns when all have finished.
 * If the token is cancelled, stops scheduling new work.
 */
async function processWithConcurrency(
	uris: vscode.Uri[],
	concurrency: number,
	token: vscode.CancellationToken | undefined,
	processFn: (uri: vscode.Uri) => Promise<void>,
): Promise<void> {
	let index = 0;
	const workers = Array.from({ length: Math.min(concurrency, uris.length) }, async () => {
		while (index < uris.length) {
			if (token?.isCancellationRequested) return;
			const uri = uris[index++];
			if (uri) {
				await processFn(uri);
			}
		}
	});
	await Promise.all(workers);
}

/**
 * Search for fuzzy string matches across workspace files.
 *
 * Pipeline: discover files → parse (with cache) → fuzzy match → sort → return.
 * Files are processed concurrently. Results can be streamed via `onFileResults`.
 */
export async function search(
	query: string,
	cache: StringCache,
	wasmDir: string,
	options?: SearchOptions,
): Promise<MatchResult[]> {
	if (query === "") return [];

	const scoreCutoff = options?.scoreCutoff ?? DEFAULT_SCORE_CUTOFF;
	const maxResults = options?.maxResults ?? DEFAULT_MAX_RESULTS;
	const token = options?.token;

	if (token?.isCancellationRequested) return [];

	await initTreeSitter(wasmDir);

	const files = await discoverFiles(options?.includeGlob, options?.excludeGlob, token);
	if (token?.isCancellationRequested) return [];

	const allResults: MatchResult[] = [];

	await processWithConcurrency(files, CONCURRENCY_LIMIT, token, async (uri) => {
		const strings = await getStringsForFile(uri, cache, wasmDir);
		if (!strings || strings.length === 0) return;

		const fileResults = fuzzyMatch(query, strings, { cutoff: scoreCutoff });
		if (fileResults.length === 0) return;

		allResults.push(...fileResults);
		options?.onFileResults?.(fileResults);
	});

	allResults.sort((a, b) => b.score - a.score);

	if (maxResults > 0 && allResults.length > maxResults) {
		return allResults.slice(0, maxResults);
	}
	return allResults;
}
