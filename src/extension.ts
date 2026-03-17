import * as vscode from "vscode";
import { PersistentCache } from "./cache/persistent-cache.js";
import { StringCache } from "./cache/string-cache.js";
import { getAllLanguages } from "./languages/registry.js";
import { SearchPanelProvider, VIEW_ID } from "./views/search-panel.js";

export const stringCache = new StringCache();
export const outputChannel = vscode.window.createOutputChannel("Fuzzy String Search");
let persistentCache: PersistentCache | undefined;

function getWorkspaceFolderUris(): string[] {
	return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.toString());
}

export function activate(context: vscode.ExtensionContext): void {
	context.subscriptions.push(outputChannel);

	// Set up persistent cache
	persistentCache = new PersistentCache(context.globalStorageUri.fsPath);

	// Load persisted cache in the background (non-blocking)
	const folderUris = getWorkspaceFolderUris();
	persistentCache.load(stringCache, folderUris).then(
		(loaded) => {
			if (loaded > 0) {
				outputChannel.appendLine(`Restored ${loaded} files from persistent cache`);
			}
		},
		(err) => {
			outputChannel.appendLine(`Failed to load persistent cache: ${err}`);
		},
	);

	// Prune stale cache files in the background
	persistentCache.pruneStale().catch(() => {});

	// Register the search panel webview
	const searchPanelProvider = new SearchPanelProvider(
		context.extensionUri,
		stringCache,
		context.workspaceState,
		outputChannel,
	);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(VIEW_ID, searchPanelProvider),
	);

	// Invalidate cache when a document is saved (covers both internal edits and external tools that trigger a save)
	context.subscriptions.push(
		vscode.workspace.onDidSaveTextDocument((document) => {
			stringCache.invalidate(document.uri.toString());
		}),
	);

	// Invalidate cache when files are deleted
	context.subscriptions.push(
		vscode.workspace.onDidDeleteFiles((event) => {
			for (const uri of event.files) {
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
	if (persistentCache) {
		const folderUris = getWorkspaceFolderUris();
		// Save is fire-and-forget — VS Code allows a short grace period for deactivation
		persistentCache.save(stringCache, folderUris).catch((err) => {
			outputChannel.appendLine(`Failed to save persistent cache: ${err}`);
		});
	}
	stringCache.clear();
}
