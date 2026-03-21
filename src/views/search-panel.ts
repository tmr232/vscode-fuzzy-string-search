import { join, relative } from "node:path";
import * as vscode from "vscode";
import type { SqliteCache } from "../cache/sqlite-cache.js";
import { countFilesByLanguage } from "../files/file-discovery.js";
import { getAllLanguages } from "../languages/registry.js";
import {
	contentOffsetToPosition,
	findAlignment,
	formatAlignedMatch,
} from "../matching/alignment.js";
import type { SearchMatch } from "../search/search-engine.js";
import { search } from "../search/search-engine.js";

export const VIEW_ID = "fuzzyStringSearch.searchPanel";

interface SearchMessage {
	type: "search";
	query: string;
	scoreCutoff: number;
	minLengthRatio: number;
	includeGlob: string;
	excludeGlob: string;
	currentFileOnly: boolean;
	enabledLanguageIds: string[];
}

interface OpenFileMessage {
	type: "openFile";
	filePath: string;
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
}

interface SetLanguagesMessage {
	type: "setLanguages";
	enabledLanguageIds: string[];
}

interface RequestFileCountsMessage {
	type: "requestFileCounts";
}

type IncomingMessage =
	| SearchMessage
	| OpenFileMessage
	| SetLanguagesMessage
	| RequestFileCountsMessage;

const ENABLED_LANGUAGES_KEY = "fuzzyStringSearch.enabledLanguageIds";

export class SearchPanelProvider implements vscode.WebviewViewProvider {
	private view?: vscode.WebviewView;
	private searchCts?: vscode.CancellationTokenSource;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly cache: SqliteCache,
		private readonly workspaceState: vscode.Memento,
		private readonly outputChannel: vscode.OutputChannel,
		private readonly onSearchComplete?: () => void,
	) {}

	/**
	 * Get the list of enabled language IDs from workspace state.
	 * Defaults to all registered languages if not previously set.
	 */
	private getEnabledLanguageIds(): string[] {
		const allIds = getAllLanguages().map((l) => l.languageId);
		const stored = this.workspaceState.get<string[]>(ENABLED_LANGUAGES_KEY);
		if (!stored) return allIds;
		// Include any newly registered languages not yet in the stored list
		const storedSet = new Set(stored);
		for (const id of allIds) {
			if (!storedSet.has(id)) {
				stored.push(id);
			}
		}
		return stored;
	}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	): void {
		this.view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
		};

		const config = vscode.workspace.getConfiguration("fuzzyStringSearch");
		const defaultCutoff = config.get<number>("defaultScoreCutoff", 60);
		const maxResults = config.get<number>("maxResults", 100);

		const allLanguages = getAllLanguages().map((l) => ({
			id: l.languageId,
			enabled: this.getEnabledLanguageIds().includes(l.languageId),
		}));

		webviewView.webview.html = getWebviewHtml(defaultCutoff, allLanguages);

		webviewView.webview.onDidReceiveMessage((message: IncomingMessage) => {
			if (message.type === "search") {
				this.handleSearch(message, maxResults);
			} else if (message.type === "openFile") {
				this.handleOpenFile(message);
			} else if (message.type === "setLanguages") {
				this.outputChannel.appendLine(
					`Languages changed: ${message.enabledLanguageIds.join(", ")}`,
				);
				this.workspaceState.update(ENABLED_LANGUAGES_KEY, message.enabledLanguageIds);
			} else if (message.type === "requestFileCounts") {
				this.sendFileCounts();
			}
		});
	}

	private async sendFileCounts(): Promise<void> {
		const counts = await countFilesByLanguage();
		const fileCounts: Record<string, number> = {};
		for (const [id, count] of counts) {
			fileCounts[id] = count;
		}
		this.postMessage({ type: "fileCounts", fileCounts });
	}

	private handleSearch(message: SearchMessage, maxResults: number): void {
		if (this.searchCts) {
			this.searchCts.cancel();
			this.searchCts.dispose();
		}
		this.searchCts = new vscode.CancellationTokenSource();
		const token = this.searchCts.token;

		const query = message.query.trim();
		if (query === "") {
			this.postMessage({ type: "results", results: [], done: true });
			return;
		}

		this.postMessage({ type: "searching" });

		const wasmDir = join(this.extensionUri.fsPath, "wasm");
		const workspaceFolders = vscode.workspace.workspaceFolders;
		const workspaceRoot = workspaceFolders?.[0]?.uri.fsPath;

		let fileUris: vscode.Uri[] | undefined;
		if (message.currentFileOnly) {
			const activeUri = vscode.window.activeTextEditor?.document.uri;
			if (activeUri) {
				fileUris = [activeUri];
			} else {
				this.postMessage({ type: "results", results: [], done: true });
				return;
			}
		}

		const workspaceFolderUris = (vscode.workspace.workspaceFolders ?? []).map((f) =>
			f.uri.toString(),
		);

		search(query, this.cache, wasmDir, workspaceFolderUris, {
			scoreCutoff: message.scoreCutoff,
			minLengthRatio: message.minLengthRatio,
			maxResults,
			includeGlob: message.includeGlob || undefined,
			excludeGlob: message.excludeGlob || undefined,
			enabledLanguageIds: message.enabledLanguageIds,
			token,
			fileUris,
			logger: this.outputChannel,
			onProgress: (parsed, total) => {
				this.postMessage({ type: "progress", parsed, total });
			},
		})
			.then(({ results: allResults, timings, parseFailures }) => {
				if (token.isCancellationRequested) return;
				this.postMessage({
					type: "results",
					results: formatResults(allResults, workspaceRoot, query),
					timings,
					parseFailures,
				});
				this.onSearchComplete?.();
			})
			.catch((err: unknown) => {
				if (token.isCancellationRequested) return;
				const errorMessage = err instanceof Error ? err.message : String(err);
				this.outputChannel.appendLine(`Search error: ${errorMessage}`);
				this.postMessage({ type: "error", message: errorMessage });
			});
	}

	private handleOpenFile(message: OpenFileMessage): void {
		const uri = vscode.Uri.file(message.filePath);
		const range = new vscode.Range(
			message.startLine,
			message.startColumn,
			message.endLine,
			message.endColumn,
		);
		vscode.window.showTextDocument(uri, {
			selection: range,
			preserveFocus: false,
		});
	}

	private postMessage(message: unknown): void {
		this.view?.webview.postMessage(message);
	}
}

interface FormattedResult {
	filePath: string;
	relativePath: string;
	content: string;
	score: number;
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
}

function deriveRangeFromSegments(segments: import("../types.js").ContentSegment[]) {
	const first = segments[0];
	const last = segments[segments.length - 1];
	if (!first || !last) {
		return { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 };
	}
	return {
		startLine: first.startLine,
		startColumn: first.startColumn,
		endLine: last.endLine,
		endColumn: last.endColumn,
	};
}

function formatResults(
	results: SearchMatch[],
	workspaceRoot: string | undefined,
	query: string,
): FormattedResult[] {
	return results.map((r) => {
		const alignment = findAlignment(query, r.content);
		const range = deriveRangeFromSegments(r.segments);

		let { startLine, startColumn, endLine, endColumn } = range;

		if (alignment && r.segments.length > 0) {
			const startPos = contentOffsetToPosition(alignment.start, r.segments, r.content);
			const endPos = contentOffsetToPosition(alignment.end, r.segments, r.content);
			if (startPos) {
				startLine = startPos.line;
				startColumn = startPos.column;
			}
			if (endPos) {
				endLine = endPos.line;
				endColumn = endPos.column;
			}
		}

		return {
			filePath: r.filePath,
			relativePath: workspaceRoot ? relative(workspaceRoot, r.filePath) : r.filePath,
			content: formatAlignedMatch(r.content, query),
			score: r.score,
			startLine,
			startColumn,
			endLine,
			endColumn,
		};
	});
}

interface LanguageInfo {
	id: string;
	enabled: boolean;
}

function getWebviewHtml(defaultCutoff: number, languages: LanguageInfo[]): string {
	const languageCheckboxes = languages
		.map(
			(l) =>
				`<div class="checkbox-group">
			<input type="checkbox" class="lang-checkbox" data-lang-id="${l.id}" ${l.enabled ? "checked" : ""} />
			<label>${l.id} <span class="lang-count" data-count-id="${l.id}"></span><span class="lang-failures" data-failures-id="${l.id}"></span></label>
		</div>`,
		)
		.join("\n\t\t");
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
	* { box-sizing: border-box; margin: 0; padding: 0; }
	body {
		font-family: var(--vscode-font-family);
		font-size: var(--vscode-font-size);
		color: var(--vscode-foreground);
		padding: 8px;
	}
	.input-group { margin-bottom: 6px; }
	.input-group label {
		display: block;
		font-size: 11px;
		text-transform: uppercase;
		color: var(--vscode-descriptionForeground);
		margin-bottom: 2px;
	}
	input[type="text"], input[type="number"] {
		width: 100%;
		padding: 4px 6px;
		border: 1px solid var(--vscode-input-border);
		background: var(--vscode-input-background);
		color: var(--vscode-input-foreground);
		font-family: var(--vscode-font-family);
		font-size: var(--vscode-font-size);
		outline: none;
	}
	input:focus {
		border-color: var(--vscode-focusBorder);
	}
	.toggle-link {
		font-size: 11px;
		color: var(--vscode-textLink-foreground);
		cursor: pointer;
		margin-bottom: 6px;
		display: inline-block;
	}
	.toggle-link:hover {
		color: var(--vscode-textLink-activeForeground);
	}
	.advanced { display: none; }
	.advanced.visible { display: block; }
	.checkbox-group {
		margin-bottom: 6px;
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.checkbox-group input[type="checkbox"] {
		appearance: none;
		width: 14px;
		height: 14px;
		border: 1px solid var(--vscode-checkbox-border);
		background: var(--vscode-checkbox-background);
		border-radius: 3px;
		cursor: pointer;
		position: relative;
		margin: 0;
	}
	.checkbox-group input[type="checkbox"]:focus {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}
	.checkbox-group input[type="checkbox"]:checked {
		background: var(--vscode-checkbox-selectBackground, var(--vscode-checkbox-background));
		border-color: var(--vscode-checkbox-selectBorder, var(--vscode-checkbox-border));
	}
	.checkbox-group input[type="checkbox"]:checked::after {
		content: '✓';
		position: absolute;
		top: -1px;
		left: 1px;
		font-size: 12px;
		line-height: 14px;
		color: var(--vscode-checkbox-foreground);
	}
	.checkbox-group label {
		font-size: 11px;
		color: var(--vscode-descriptionForeground);
		cursor: pointer;
	}
	.lang-count {
		opacity: 0.7;
	}
	.lang-failures {
		color: var(--vscode-errorForeground);
	}
	.parse-failures {
		color: var(--vscode-errorForeground);
		font-size: 11px;
	}
	.status {
		font-size: 11px;
		color: var(--vscode-descriptionForeground);
		margin: 6px 0;
	}
	.timings {
		font-size: 10px;
		color: var(--vscode-descriptionForeground);
		margin-bottom: 4px;
	}
	.results { margin-top: 4px; }
	.file-group-header {
		padding: 4px 6px;
		font-size: 11px;
		font-weight: bold;
		color: var(--vscode-descriptionForeground);
		background: var(--vscode-sideBar-background);
		border-bottom: 1px solid var(--vscode-panel-border);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.result-item {
		padding: 4px 6px;
		cursor: pointer;
		border-bottom: 1px solid var(--vscode-panel-border);
	}
	.result-item:hover {
		background: var(--vscode-list-hoverBackground);
	}
	.result-file {
		font-size: 11px;
		color: var(--vscode-descriptionForeground);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.result-content {
		font-family: var(--vscode-editor-font-family);
		font-size: var(--vscode-editor-font-size);
		white-space: pre-wrap;
		word-break: break-word;
	}
	.result-score {
		font-size: 11px;
		color: var(--vscode-descriptionForeground);
		float: right;
	}
</style>
</head>
<body>
	<div class="input-group">
		<input type="text" id="query" placeholder="Search strings…" />
	</div>
	<div class="checkbox-group">
		<input type="checkbox" id="currentFileOnly" />
		<label for="currentFileOnly">Current file only</label>
	</div>
	<div class="checkbox-group">
		<input type="checkbox" id="groupByFile" />
		<label for="groupByFile">Group by file</label>
	</div>
	<span class="toggle-link" id="toggleLanguages">⋯ languages</span>
	<div class="advanced" id="languagesSection">
		${languageCheckboxes}
	</div>
	<span class="toggle-link" id="toggleAdvanced">⋯ filters</span>
	<div class="advanced" id="advancedSection">
		<div class="input-group">
			<label>Score cutoff</label>
			<input type="number" id="scoreCutoff" value="${defaultCutoff}" min="0" max="100" />
		</div>
		<div class="input-group">
			<label>Min length ratio (%)</label>
			<input type="number" id="minLengthRatio" value="50" min="0" max="100" />
		</div>
		<div class="input-group">
			<label>Files to include</label>
			<input type="text" id="includeGlob" placeholder="e.g. **/*.py" />
		</div>
		<div class="input-group">
			<label>Files to exclude</label>
			<input type="text" id="excludeGlob" placeholder="e.g. **/tests/**" />
		</div>
	</div>
	<div class="status" id="status"></div>
	<div class="timings" id="timings"></div>
	<div class="results" id="results"></div>

<script>
	const vscode = acquireVsCodeApi();
	const queryInput = document.getElementById('query');
	const scoreCutoffInput = document.getElementById('scoreCutoff');
	const minLengthRatioInput = document.getElementById('minLengthRatio');
	const includeGlobInput = document.getElementById('includeGlob');
	const excludeGlobInput = document.getElementById('excludeGlob');
	const currentFileOnlyInput = document.getElementById('currentFileOnly');
	const groupByFileInput = document.getElementById('groupByFile');
	const statusEl = document.getElementById('status');
	const timingsEl = document.getElementById('timings');
	const resultsEl = document.getElementById('results');
	const toggleAdvanced = document.getElementById('toggleAdvanced');
	const advancedSection = document.getElementById('advancedSection');
	const toggleLanguages = document.getElementById('toggleLanguages');
	const languagesSection = document.getElementById('languagesSection');
	const langCheckboxes = document.querySelectorAll('.lang-checkbox');

	let debounceTimer = null;

	const DEBOUNCE_MS = 300;

	function getEnabledLanguageIds() {
		return Array.from(langCheckboxes)
			.filter(cb => cb.checked)
			.map(cb => cb.dataset.langId);
	}

	// Restore persisted state
	const savedState = vscode.getState();
	if (savedState) {
		if (savedState.query) queryInput.value = savedState.query;
		if (savedState.scoreCutoff) scoreCutoffInput.value = savedState.scoreCutoff;
		if (savedState.minLengthRatio) minLengthRatioInput.value = savedState.minLengthRatio;
		if (savedState.includeGlob) includeGlobInput.value = savedState.includeGlob;
		if (savedState.excludeGlob) excludeGlobInput.value = savedState.excludeGlob;
		if (savedState.currentFileOnly) currentFileOnlyInput.checked = savedState.currentFileOnly;
		if (savedState.groupByFile) groupByFileInput.checked = savedState.groupByFile;
		if (savedState.results && savedState.results.length > 0) {
			renderResults(savedState.results, savedState.parseFailures);
		}
		if (savedState.timings) {
			renderTimings(savedState.timings);
		}
		if (savedState.enabledLanguageIds) {
			const enabled = new Set(savedState.enabledLanguageIds);
			for (const cb of langCheckboxes) {
				cb.checked = enabled.has(cb.dataset.langId);
			}
		}
	}

	function saveState(results, timings, parseFailures) {
		vscode.setState({
			query: queryInput.value,
			scoreCutoff: scoreCutoffInput.value,
			minLengthRatio: minLengthRatioInput.value,
			includeGlob: includeGlobInput.value,
			excludeGlob: excludeGlobInput.value,
			currentFileOnly: currentFileOnlyInput.checked,
			groupByFile: groupByFileInput.checked,
			enabledLanguageIds: getEnabledLanguageIds(),
			results: results || [],
			timings: timings || null,
			parseFailures: parseFailures || null,
		});
	}

	let fileCountsRequested = false;
	toggleLanguages.addEventListener('click', () => {
		languagesSection.classList.toggle('visible');
		toggleLanguages.textContent = languagesSection.classList.contains('visible')
			? '⋯ hide languages'
			: '⋯ languages';
		if (languagesSection.classList.contains('visible') && !fileCountsRequested) {
			fileCountsRequested = true;
			vscode.postMessage({ type: 'requestFileCounts' });
		}
	});

	toggleAdvanced.addEventListener('click', () => {
		advancedSection.classList.toggle('visible');
		toggleAdvanced.textContent = advancedSection.classList.contains('visible')
			? '⋯ hide filters'
			: '⋯ filters';
	});

	function triggerSearch() {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			const enabledLanguageIds = getEnabledLanguageIds();
			vscode.postMessage({
				type: 'search',
				query: queryInput.value,
				scoreCutoff: parseInt(scoreCutoffInput.value, 10) || 60,
				minLengthRatio: parseInt(minLengthRatioInput.value, 10) || 50,
				includeGlob: includeGlobInput.value,
				excludeGlob: excludeGlobInput.value,
				currentFileOnly: currentFileOnlyInput.checked,
				enabledLanguageIds,
			});
			vscode.postMessage({
				type: 'setLanguages',
				enabledLanguageIds,
			});
		}, DEBOUNCE_MS);
	}

	queryInput.addEventListener('input', triggerSearch);
	scoreCutoffInput.addEventListener('change', triggerSearch);
	minLengthRatioInput.addEventListener('change', triggerSearch);
	includeGlobInput.addEventListener('input', triggerSearch);
	excludeGlobInput.addEventListener('input', triggerSearch);
	currentFileOnlyInput.addEventListener('change', triggerSearch);
	for (const cb of langCheckboxes) {
		cb.addEventListener('change', triggerSearch);
	}
	groupByFileInput.addEventListener('change', () => {
		const state = vscode.getState();
		if (state && state.results && state.results.length > 0) {
			renderResults(state.results, state.parseFailures);
			saveState(state.results, state.timings, state.parseFailures);
		}
	});

	function escapeHtml(text) {
		const div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	}

	function renderTimings(timings) {
		if (!timings || timings.collectSec == null) { timingsEl.textContent = ''; return; }
		timingsEl.textContent =
			'collect: ' + timings.collectSec.toFixed(2) + 's · ' +
			'match: ' + timings.matchSec.toFixed(2) + 's · ' +
			'total: ' + timings.totalSec.toFixed(2) + 's';
	}

	function createResultItem(r) {
		const item = document.createElement('div');
		item.className = 'result-item';
		item.innerHTML =
			'<div class="result-file">' +
				'<span class="result-score">' + r.score + '</span>' +
				escapeHtml(r.relativePath) + ':' + (r.startLine + 1) +
			'</div>' +
			'<div class="result-content">' + escapeHtml(r.content) + '</div>';
		item.addEventListener('click', () => {
			vscode.postMessage({
				type: 'openFile',
				filePath: r.filePath,
				startLine: r.startLine,
				startColumn: r.startColumn,
				endLine: r.endLine,
				endColumn: r.endColumn,
			});
		});
		return item;
	}

	function updateParseFailures(parseFailures) {
		// Update per-language failure counts
		const failureSpans = document.querySelectorAll('.lang-failures');
		for (const span of failureSpans) {
			const langId = span.dataset.failuresId;
			const count = parseFailures && parseFailures[langId];
			span.textContent = count ? ' ⚠ ' + count + ' failed' : '';
		}
	}

	function renderResults(results, parseFailures) {
		resultsEl.innerHTML = '';

		// Overall failure summary
		const totalFailed = parseFailures
			? Object.values(parseFailures).reduce((a, b) => a + b, 0)
			: 0;
		const failureSuffix = totalFailed > 0
			? ' · ' + totalFailed + ' file' + (totalFailed === 1 ? '' : 's') + ' failed to parse'
			: '';

		if (results.length === 0) {
			statusEl.innerHTML = 'No results' + (failureSuffix
				? '<span class="parse-failures">' + failureSuffix + '</span>'
				: '');
			updateParseFailures(parseFailures);
			return;
		}
		statusEl.innerHTML = results.length + ' result' + (results.length === 1 ? '' : 's')
			+ (failureSuffix ? '<span class="parse-failures">' + failureSuffix + '</span>' : '');
		updateParseFailures(parseFailures);

		if (groupByFileInput.checked) {
			const groups = new Map();
			for (const r of results) {
				const key = r.relativePath;
				if (!groups.has(key)) groups.set(key, []);
				groups.get(key).push(r);
			}

			for (const [filePath, fileResults] of groups) {
				const header = document.createElement('div');
				header.className = 'file-group-header';
				header.textContent = filePath + ' (' + fileResults.length + ')';
				resultsEl.appendChild(header);

				for (const r of fileResults) {
					resultsEl.appendChild(createResultItem(r));
				}
			}
		} else {
			for (const r of results) {
				resultsEl.appendChild(createResultItem(r));
			}
		}
	}

	window.addEventListener('message', (event) => {
		const message = event.data;
		if (message.type === 'searching') {
			statusEl.textContent = 'Searching…';
			timingsEl.textContent = '';
			resultsEl.innerHTML = '';
		} else if (message.type === 'progress') {
			statusEl.textContent = 'Collecting strings from ' + message.parsed + '/' + message.total + ' files';
		} else if (message.type === 'results') {
			renderResults(message.results, message.parseFailures);
			renderTimings(message.timings);
			saveState(message.results, message.timings, message.parseFailures);
		} else if (message.type === 'error') {
			statusEl.textContent = 'Error: ' + message.message;
			timingsEl.textContent = '';
			resultsEl.innerHTML = '';
		} else if (message.type === 'fileCounts') {
			for (const [langId, count] of Object.entries(message.fileCounts)) {
				const span = document.querySelector('.lang-count[data-count-id="' + langId + '"]');
				if (span) span.textContent = '(' + count + ')';
			}
		}
	});
</script>
</body>
</html>`;
}
