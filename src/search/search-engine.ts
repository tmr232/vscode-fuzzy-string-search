import { createHash } from "node:crypto";
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
 * Timing information for a search operation (wall-clock seconds).
 */
export interface SearchTimings {
	/** Seconds spent discovering files. */
	discoverySec: number;
	/** Seconds spent collecting strings (parsing). */
	collectSec: number;
	/** Seconds spent fuzzy matching. */
	matchSec: number;
	/** Total wall-clock seconds. */
	totalSec: number;
}

/**
 * Logger interface for the search engine.
 */
export interface SearchLogger {
	appendLine(message: string): void;
}

/**
 * Options for a search operation.
 */
export interface SearchOptions {
	/** Minimum score to include in results (0–100). Default: 60. */
	scoreCutoff?: number;
	/** Maximum number of results to return. Default: 100. */
	maxResults?: number;
	/** Minimum length ratio (0–100): result must be at least this % of query length. Default: 50. */
	minLengthRatio?: number;
	/** Glob pattern to restrict which files are searched. */
	includeGlob?: string;
	/** Glob pattern to exclude files from search. */
	excludeGlob?: string;
	/** Cancellation token for aborting the search. */
	token?: vscode.CancellationToken;
	/** Restrict search to a specific set of file URIs instead of discovering files. */
	fileUris?: vscode.Uri[];
	/** Restrict search to specific language IDs (e.g. ["python", "typescript"]). */
	enabledLanguageIds?: string[];
	/** Called after each file is parsed during the collect phase. */
	onProgress?: (parsed: number, total: number) => void;
	/** Logger for errors and warnings (e.g. a VSCode OutputChannel). */
	logger?: SearchLogger;
}

/**
 * Result of a search operation, including results and timing information.
 */
export interface SearchResult {
	results: MatchResult[];
	timings: SearchTimings;
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
	enabledLanguageIds?: string[],
	logger?: SearchLogger,
): Promise<SourceString[] | undefined> {
	const uriString = uri.toString();
	const cached = cache.get(uriString);
	if (cached) return cached;

	const filePath = uri.fsPath;
	const langSupport = getLanguageForFile(filePath);
	if (!langSupport) return undefined;
	if (enabledLanguageIds && !enabledLanguageIds.includes(langSupport.languageId)) return undefined;

	const wasmPath = join(wasmDir, langSupport.wasmFileName);

	let source: string;
	try {
		source = await readFile(filePath, "utf-8");
	} catch {
		return undefined;
	}

	try {
		const language = await loadLanguage(wasmPath);
		const parser = createParser(language);
		const strings = collectStrings(source, filePath, parser, langSupport);
		const contentHash = createHash("sha256").update(source).digest("hex");
		cache.set(uriString, strings, contentHash);
		return strings;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger?.appendLine(`Failed to parse ${filePath}: ${message}`);
		return undefined;
	}
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
): Promise<SearchResult> {
	const emptyResult: SearchResult = {
		results: [],
		timings: { discoverySec: 0, collectSec: 0, matchSec: 0, totalSec: 0 },
	};
	if (query === "") return emptyResult;

	const scoreCutoff = options?.scoreCutoff ?? DEFAULT_SCORE_CUTOFF;
	const maxResults = options?.maxResults ?? DEFAULT_MAX_RESULTS;
	const token = options?.token;

	if (token?.isCancellationRequested) return emptyResult;

	const toSec = (ms: number) => ms / 1000;
	const totalStart = performance.now();

	await initTreeSitter(wasmDir);

	const discoveryStart = performance.now();
	const files =
		options?.fileUris ??
		(await discoverFiles(
			options?.includeGlob,
			options?.excludeGlob,
			token,
			options?.enabledLanguageIds,
		));
	const discoverySec = toSec(performance.now() - discoveryStart);
	if (token?.isCancellationRequested) return emptyResult;

	const allResults: MatchResult[] = [];
	const allStrings: SourceString[] = [];

	let parsed = 0;
	const onProgress = options?.onProgress;
	const totalFiles = files.length;

	const collectStart = performance.now();
	await processWithConcurrency(files, CONCURRENCY_LIMIT, token, async (uri) => {
		const strings = await getStringsForFile(
			uri,
			cache,
			wasmDir,
			options?.enabledLanguageIds,
			options?.logger,
		);
		parsed++;
		onProgress?.(parsed, totalFiles);
		if (!strings || strings.length === 0) return;
		allStrings.push(...strings);
	});
	const collectSec = toSec(performance.now() - collectStart);

	const matchStart = performance.now();
	if (allStrings.length > 0) {
		const fileResults = fuzzyMatch(query, allStrings, {
			cutoff: scoreCutoff,
			minLengthRatio: options?.minLengthRatio,
		});
		allResults.push(...fileResults);
	}
	const matchSec = toSec(performance.now() - matchStart);

	allResults.sort((a, b) => b.score - a.score);

	const results =
		maxResults > 0 && allResults.length > maxResults ? allResults.slice(0, maxResults) : allResults;

	const totalSec = toSec(performance.now() - totalStart);

	return {
		results,
		timings: { discoverySec, collectSec, matchSec, totalSec },
	};
}
