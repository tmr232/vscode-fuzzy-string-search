import type { LanguageSupport } from "./language-support.js";
import { pythonLanguageSupport } from "./python.js";

const languagesById = new Map<string, LanguageSupport>();
const languagesByExtension = new Map<string, LanguageSupport>();
const languagesByVscodeId = new Map<string, LanguageSupport>();

function register(lang: LanguageSupport): void {
	languagesById.set(lang.languageId, lang);
	for (const ext of lang.fileExtensions) {
		languagesByExtension.set(ext, lang);
	}
	for (const id of lang.vscodeLanguageIds) {
		languagesByVscodeId.set(id, lang);
	}
}

// Register all supported languages
register(pythonLanguageSupport);

/**
 * Look up language support by file path (using its extension).
 * Returns `undefined` if the file's language is not supported.
 */
export function getLanguageForFile(filePath: string): LanguageSupport | undefined {
	const dotIndex = filePath.lastIndexOf(".");
	if (dotIndex === -1) return undefined;
	const ext = filePath.slice(dotIndex).toLowerCase();
	return languagesByExtension.get(ext);
}

/**
 * Look up language support by VSCode language identifier.
 * Returns `undefined` if the language is not supported.
 */
export function getLanguageByVscodeId(vscodeLanguageId: string): LanguageSupport | undefined {
	return languagesByVscodeId.get(vscodeLanguageId);
}

/**
 * Look up language support by its language ID (e.g. "python").
 * Returns `undefined` if the language is not supported.
 */
export function getLanguageById(languageId: string): LanguageSupport | undefined {
	return languagesById.get(languageId);
}

/**
 * Get all registered languages.
 */
export function getAllLanguages(): LanguageSupport[] {
	return [...languagesById.values()];
}
