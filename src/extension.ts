import * as vscode from "vscode";
import { StringCache } from "./cache/string-cache.js";
import { getAllLanguages } from "./languages/registry.js";

export const stringCache = new StringCache();

export function activate(context: vscode.ExtensionContext): void {
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
	stringCache.clear();
}
