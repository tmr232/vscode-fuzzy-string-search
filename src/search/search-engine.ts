import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type * as vscode from "vscode";
import type { SqliteCache } from "../cache/sqlite-cache.js";
import { fileUriToFsPath } from "../cache/sqlite-cache.js";
import { discoverFiles } from "../files/file-discovery.js";
import { getLanguageForFile } from "../languages/registry.js";
import { fuzzyMatch } from "../matching/fuzzy-matcher.js";
import { createParser, initTreeSitter, loadLanguage } from "../parsing/parser-manager.js";
import { collectStrings } from "../parsing/string-collector.js";
import type { ContentSegment, SourceString } from "../types.js";

/**
 * Timing information for a search operation (wall-clock seconds).
 */
export interface SearchTimings {
	/** Seconds spent discovering files. */
	discoverySec: number;
	/** Seconds spent collecting strings (parsing + cache sync). */
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
 * Per-language count of files that failed to parse during a search.
 */
export type ParseFailures = Record<string, number>;

/**
 * A search result with location information, ready for the UI.
 */
export interface SearchMatch {
	content: string;
	filePath: string;
	segments: ContentSegment[];
	score: number;
}

/**
 * Result of a search operation, including results and timing information.
 */
export interface SearchResult {
	results: SearchMatch[];
	timings: SearchTimings;
	/** Number of files that failed to read or parse, keyed by language ID. */
	parseFailures: ParseFailures;
}

const DEFAULT_SCORE_CUTOFF = 60;
const DEFAULT_MAX_RESULTS = 100;

/**
 * Create a file parser function for the SqliteCache.
 * This reads a file, parses it with tree-sitter, and returns SourceStrings + hash.
 */
function makeFileParser(
	wasmDir: string,
	cache: SqliteCache,
	enabledLanguageIds: string[] | undefined,
	logger: SearchLogger | undefined,
	parseFailures: ParseFailures,
) {
	return async (uri: string): Promise<{ strings: SourceString[]; contentHash: string } | null> => {
		const failedLang = cache.getFailed(uri);
		if (failedLang) {
			parseFailures[failedLang] = (parseFailures[failedLang] ?? 0) + 1;
			return null;
		}

		const fsPath = fileUriToFsPath(uri);
		if (!fsPath) return null;

		const langSupport = getLanguageForFile(fsPath);
		if (!langSupport) return null;
		if (enabledLanguageIds && !enabledLanguageIds.includes(langSupport.languageId)) return null;

		const wasmPath = join(wasmDir, langSupport.wasmFileName);

		let source: string;
		try {
			source = await readFile(fsPath, "utf-8");
		} catch {
			cache.setFailed(uri, langSupport.languageId);
			parseFailures[langSupport.languageId] = (parseFailures[langSupport.languageId] ?? 0) + 1;
			return null;
		}

		const contentHash = createHash("sha256").update(source).digest("hex");

		try {
			const language = await loadLanguage(wasmPath);
			const parser = createParser(language);
			const { strings } = collectStrings(source, fsPath, parser, langSupport);
			return { strings, contentHash };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logger?.appendLine(`Failed to parse ${fsPath}: ${message}`);
			cache.setFailed(uri, langSupport.languageId, contentHash);
			parseFailures[langSupport.languageId] = (parseFailures[langSupport.languageId] ?? 0) + 1;
			return null;
		}
	};
}

/**
 * Search for fuzzy string matches across workspace files.
 *
 * Pipeline: discover files → ensure cache ready → fuzzy match content strings
 *   → resolve locations for matched IDs → sort → return.
 */
export async function search(
	query: string,
	cache: SqliteCache,
	wasmDir: string,
	workspaceFolderUris: string[],
	options?: SearchOptions,
): Promise<SearchResult> {
	const emptyResult: SearchResult = {
		results: [],
		timings: { discoverySec: 0, collectSec: 0, matchSec: 0, totalSec: 0 },
		parseFailures: {},
	};
	if (query === "") return emptyResult;

	const scoreCutoff = options?.scoreCutoff ?? DEFAULT_SCORE_CUTOFF;
	const maxResults = options?.maxResults ?? DEFAULT_MAX_RESULTS;
	const token = options?.token;
	const logger = options?.logger;

	if (token?.isCancellationRequested) return emptyResult;

	logger?.appendLine(
		`Search started: query="${query}", scoreCutoff=${scoreCutoff}, maxResults=${maxResults}`,
	);

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

	logger?.appendLine(`Discovery: ${files.length} files found in ${discoverySec.toFixed(2)}s`);

	const parseFailures: ParseFailures = {};

	// Ensure the cache is ready (loads DB, validates, re-parses stale files)
	const collectStart = performance.now();
	const allFileUris = files.map((f) => f.toString());
	const parseFile = makeFileParser(
		wasmDir,
		cache,
		options?.enabledLanguageIds,
		logger,
		parseFailures,
	);
	await cache.ensureReady(
		workspaceFolderUris,
		wasmDir,
		allFileUris,
		parseFile,
		options?.onProgress,
	);
	const collectSec = toSec(performance.now() - collectStart);

	if (token?.isCancellationRequested) return emptyResult;

	// Determine which contents to match against
	const isScoped =
		options?.fileUris !== undefined ||
		options?.includeGlob !== undefined ||
		options?.excludeGlob !== undefined;

	const candidateContents = isScoped
		? cache.getContentsForFiles(allFileUris)
		: cache.getAllContents();

	logger?.appendLine(
		`Collection: ${candidateContents.length} unique strings, cache sync in ${collectSec.toFixed(2)}s`,
	);

	// Fuzzy match
	const matchStart = performance.now();
	const allMatches: SearchMatch[] = [];

	if (candidateContents.length > 0) {
		const scoredMatches = fuzzyMatch(query, candidateContents, {
			cutoff: scoreCutoff,
			minLengthRatio: options?.minLengthRatio,
		});

		// Resolve matched content strings to IDs
		const matchedIds: number[] = [];
		const scoreByContent = new Map<string, number>();
		for (const m of scoredMatches) {
			const id = cache.getIdForContent(m.content);
			if (id !== undefined) {
				matchedIds.push(id);
				scoreByContent.set(m.content, m.score);
			}
		}

		// Query locations for matched IDs
		if (matchedIds.length > 0) {
			const locations = cache.getLocationsForIds(matchedIds);

			// If scoped, filter locations to only the scoped files
			const scopeSet = isScoped ? new Set(allFileUris) : undefined;

			for (const loc of locations) {
				if (scopeSet && !scopeSet.has(loc.fileUri)) continue;

				const fsPath = fileUriToFsPath(loc.fileUri);
				if (!fsPath) continue;

				const score = scoreByContent.get(loc.content);
				if (score === undefined) continue;

				allMatches.push({
					content: loc.content,
					filePath: fsPath,
					segments: loc.segments,
					score,
				});
			}
		}
	}
	const matchSec = toSec(performance.now() - matchStart);

	allMatches.sort((a, b) => b.score - a.score);

	const results =
		maxResults > 0 && allMatches.length > maxResults ? allMatches.slice(0, maxResults) : allMatches;

	const totalSec = toSec(performance.now() - totalStart);

	logger?.appendLine(
		`Matching: ${allMatches.length} matches (returning ${results.length}) in ${matchSec.toFixed(2)}s — total ${totalSec.toFixed(2)}s`,
	);

	return {
		results,
		timings: { discoverySec, collectSec, matchSec, totalSec },
		parseFailures,
	};
}
