import * as vscode from "vscode";
import { getAllLanguages } from "../languages/registry.js";

/**
 * Build a glob include pattern matching all file extensions for supported languages.
 */
function buildIncludePattern(): string {
	const extensions = getAllLanguages().flatMap((lang) =>
		lang.fileExtensions.map((ext) => ext.replace(/^\./, "")),
	);
	if (extensions.length === 0) return "";
	if (extensions.length === 1) return `**/*.${extensions[0]}`;
	return `**/*.{${extensions.join(",")}}`;
}

/**
 * Discover workspace files whose language is supported by the registry.
 *
 * Respects `.gitignore` by default (VSCode's `workspace.findFiles` does this).
 *
 * @param include - Optional glob pattern to restrict files (overrides the default
 *   pattern derived from registered language extensions).
 * @param exclude - Optional glob pattern to exclude files.
 * @param token - Optional cancellation token.
 * @returns Array of file URIs for supported files.
 */
export async function discoverFiles(
	include?: string,
	exclude?: string,
	token?: vscode.CancellationToken,
): Promise<vscode.Uri[]> {
	const includePattern = include ?? buildIncludePattern();
	if (includePattern === "") return [];

	const excludePattern = exclude ?? undefined;

	return vscode.workspace.findFiles(includePattern, excludePattern, undefined, token);
}
