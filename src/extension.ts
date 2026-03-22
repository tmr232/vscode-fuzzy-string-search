import { join } from "node:path";
import * as vscode from "vscode";
import { initSqlJs } from "./cache/sql-init.js";
import { SqliteCache } from "./cache/sqlite-cache.js";
import { getAllLanguages } from "./languages/registry.js";
import { SearchPanelProvider, VIEW_ID } from "./views/search-panel.js";

export const outputChannel = vscode.window.createOutputChannel("Fuzzy String Search");
let sqliteCache: SqliteCache | undefined;
let saveInterval: ReturnType<typeof setInterval> | undefined;

/**
 * Interval (in milliseconds) between periodic cache saves.
 */
const SAVE_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

function getWorkspaceFolderUris(): string[] {
	return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.toString());
}

/**
 * Save the SQLite cache if it has unsaved changes.
 */
async function saveIfDirty(): Promise<void> {
	if (!sqliteCache?.isDirty) return;
	const folderUris = getWorkspaceFolderUris();
	try {
		await sqliteCache.save(folderUris);
	} catch (err) {
		outputChannel.appendLine(`Failed to save SQLite cache: ${err}`);
	}
}

export function activate(context: vscode.ExtensionContext): void {
	context.subscriptions.push(outputChannel);

	const registeredLanguages = getAllLanguages().map((l) => l.languageId);
	outputChannel.appendLine(`Activating — registered languages: ${registeredLanguages.join(", ")}`);

	// Initialize sql.js WASM runtime (once, before any DB work)
	const wasmDir = join(context.extensionUri.fsPath, "wasm");
	initSqlJs(wasmDir);

	// Create SQLite cache (lazy — no DB work until first search)
	sqliteCache = new SqliteCache(context.globalStorageUri.fsPath, outputChannel);

	// Periodically save the cache if it has been modified
	saveInterval = setInterval(() => {
		saveIfDirty().catch(() => {});
	}, SAVE_INTERVAL_MS);

	// Register the search panel webview
	const searchPanelProvider = new SearchPanelProvider(
		context.extensionUri,
		sqliteCache,
		context.workspaceState,
		outputChannel,
		() => {
			saveIfDirty().catch(() => {});
		},
	);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(VIEW_ID, searchPanelProvider),
	);

	// Invalidate cache when a document is saved
	context.subscriptions.push(
		vscode.workspace.onDidSaveTextDocument((document) => {
			outputChannel.appendLine(`Cache invalidated (save): ${document.uri.fsPath}`);
			sqliteCache?.markChanged(document.uri.toString());
		}),
	);

	// Invalidate cache when files are deleted
	context.subscriptions.push(
		vscode.workspace.onDidDeleteFiles((event) => {
			for (const uri of event.files) {
				outputChannel.appendLine(`Cache invalidated (delete): ${uri.fsPath}`);
				sqliteCache?.markDeleted(uri.toString());
			}
		}),
	);

	// Watch for external file changes using a FileSystemWatcher
	const extensions = getAllLanguages().flatMap((lang) =>
		lang.fileExtensions.map((ext) => ext.replace(/^\./, "")),
	);
	if (extensions.length > 0) {
		const globPattern =
			extensions.length === 1 ? `**/*.${extensions[0]}` : `**/*.{${extensions.join(",")}}`;

		const watcher = vscode.workspace.createFileSystemWatcher(globPattern);

		watcher.onDidChange((uri) => {
			outputChannel.appendLine(`Cache invalidated (external change): ${uri.fsPath}`);
			sqliteCache?.markChanged(uri.toString());
		});
		watcher.onDidDelete((uri) => {
			sqliteCache?.markDeleted(uri.toString());
		});
		watcher.onDidCreate((_uri) => {
			// New files don't have a cache entry; nothing to invalidate.
			// The search engine will pick them up on next search.
		});

		context.subscriptions.push(watcher);
	}
}

export function deactivate(): void {
	if (saveInterval) {
		clearInterval(saveInterval);
		saveInterval = undefined;
	}
	// Best-effort save — VS Code allows a short grace period for deactivation
	saveIfDirty().catch(() => {});
	sqliteCache?.dispose();
	sqliteCache = undefined;
}
