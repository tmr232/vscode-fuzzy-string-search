import { join } from "node:path";
import type { Language } from "web-tree-sitter";
import { Language as LanguageClass, Parser } from "web-tree-sitter";

let initialized = false;
const languageCache = new Map<string, Language>();

/**
 * Initialize the tree-sitter WASM runtime.
 * Must be called before any parsing. Safe to call multiple times.
 *
 * @param wasmDir - Absolute path to directory containing tree-sitter.wasm
 *   (defaults to the `wasm/` directory inside the extension root).
 */
export async function initTreeSitter(wasmDir?: string): Promise<void> {
	if (initialized) return;

	const locateFile = wasmDir
		? (scriptName: string, _scriptDirectory: string) => join(wasmDir, scriptName)
		: undefined;

	await Parser.init(locateFile ? { locateFile } : undefined);
	initialized = true;
}

/**
 * Load a tree-sitter language from a .wasm file.
 * Results are cached — each .wasm is loaded only once.
 *
 * @param wasmPath - Absolute path to the language .wasm file
 *   (e.g. `/path/to/wasm/tree-sitter-python.wasm`).
 */
export async function loadLanguage(wasmPath: string): Promise<Language> {
	const cached = languageCache.get(wasmPath);
	if (cached) return cached;

	const language = await LanguageClass.load(wasmPath);
	languageCache.set(wasmPath, language);
	return language;
}

/**
 * Create a new Parser instance with the given language set.
 */
export function createParser(language: Language): Parser {
	const parser = new Parser();
	parser.setLanguage(language);
	return parser;
}

/**
 * Reset module state. Intended for tests only.
 */
export function resetParserManager(): void {
	initialized = false;
	languageCache.clear();
}
