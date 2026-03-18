import * as vscode from "vscode";
import { PersistentCache } from "./cache/persistent-cache.js";
import { StringCache } from "./cache/string-cache.js";
import { getAllLanguages } from "./languages/registry.js";
import { SearchPanelProvider, VIEW_ID } from "./views/search-panel.js";

export const stringCache = new StringCache();
export const outputChannel = vscode.window.createOutputChannel("Fuzzy String Search");
let persistentCache: PersistentCache | undefined;
let saveInterval: ReturnType<typeof setInterval> | undefined;
let hasPerformedInitialSave = false;

/**
 * Interval (in milliseconds) between periodic cache saves.
 */
const SAVE_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

function getWorkspaceFolderUris(): string[] {
	return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.toString());
}

/**
 * Save the persistent cache if the in-memory cache has been modified.
 */
async function saveIfDirty(): Promise<void> {
	if (!persistentCache || !stringCache.dirty) return;
	const folderUris = getWorkspaceFolderUris();
	try {
		await persistentCache.save(stringCache, folderUris);
	} catch (err) {
		outputChannel.appendLine(`Failed to save persistent cache: ${err}`);
	}
}

export function activate(context: vscode.ExtensionContext): void {
	context.subscriptions.push(outputChannel);

	const registeredLanguages = getAllLanguages().map((l) => l.languageId);
	outputChannel.appendLine(`Activating — registered languages: ${registeredLanguages.join(", ")}`);

	// Set up persistent cache
	persistentCache = new PersistentCache(context.globalStorageUri.fsPath, outputChannel);

	// Load persisted cache in the background (non-blocking)
	const folderUris = getWorkspaceFolderUris();
	persistentCache.load(stringCache, folderUris).catch((err) => {
		outputChannel.appendLine(`Failed to load persistent cache: ${err}`);
	});

	// Prune stale cache files in the background
	persistentCache.pruneStale().catch(() => {});

	// Periodically save the cache if it has been modified
	saveInterval = setInterval(() => {
		saveIfDirty().catch(() => {});
	}, SAVE_INTERVAL_MS);

	// Register the search panel webview
	const searchPanelProvider = new SearchPanelProvider(
		context.extensionUri,
		stringCache,
		context.workspaceState,
		outputChannel,
		() => {
			if (!hasPerformedInitialSave) {
				hasPerformedInitialSave = true;
				saveIfDirty().catch(() => {});
			}
		},
	);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(VIEW_ID, searchPanelProvider),
	);

	// Invalidate cache when a document is saved (covers both internal edits and external tools that trigger a save)
	context.subscriptions.push(
		vscode.workspace.onDidSaveTextDocument((document) => {
			outputChannel.appendLine(`Cache invalidated (save): ${document.uri.fsPath}`);
			stringCache.invalidate(document.uri.toString());
		}),
	);

	// Invalidate cache when files are deleted
	context.subscriptions.push(
		vscode.workspace.onDidDeleteFiles((event) => {
			for (const uri of event.files) {
				outputChannel.appendLine(`Cache invalidated (delete): ${uri.fsPath}`);
				stringCache.invalidate(uri.toString());
			}
		}),
	);

	// Watch for external file changes using a FileSystemWatcher.
	// This covers edits made outside VSCode (e.g. git checkout, other editors).
	const extensions = getAllLanguages().flatMap((lang) =>
		lang.fileExtensions.map((ext) => ext.replace(/^\./, "")),
	);
	if (extensions.length > 0) {
		const globPattern =
			extensions.length === 1 ? `**/*.${extensions[0]}` : `**/*.{${extensions.join(",")}}`;

		const watcher = vscode.workspace.createFileSystemWatcher(globPattern);

		watcher.onDidChange((uri) => {
			outputChannel.appendLine(`Cache invalidated (external change): ${uri.fsPath}`);
			stringCache.invalidate(uri.toString());
		});
		watcher.onDidDelete((uri) => {
			stringCache.invalidate(uri.toString());
		});
		watcher.onDidCreate((_uri) => {
			// New files don't have a cache entry; nothing to invalidate.
			// The search engine will parse them on next search.
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
	stringCache.clear();
}
