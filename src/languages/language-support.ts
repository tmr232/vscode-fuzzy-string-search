import type { Node } from "web-tree-sitter";
import type { ContentSegment } from "../types.js";

/**
 * Result of extracting string content from a tree-sitter node.
 */
export interface StringExtractionResult {
	/** The assembled string content. */
	content: string;
	/** Mapping from content character ranges back to source file positions. */
	segments: ContentSegment[];
}

/**
 * Interface for language-specific string extraction from tree-sitter ASTs.
 *
 * Each supported language implements this interface and registers it
 * in the language registry. Adding a new language requires only:
 * 1. A new file in `src/languages/` implementing this interface
 * 2. Registering it in `src/languages/registry.ts`
 * 3. Downloading the corresponding `.wasm` file
 */
export interface LanguageSupport {
	/** Unique identifier for the language (e.g. "python"). */
	readonly languageId: string;

	/** File extensions associated with this language (e.g. [".py", ".pyi"]). */
	readonly fileExtensions: string[];

	/** VSCode language identifiers that map to this language (e.g. ["python"]). */
	readonly vscodeLanguageIds: string[];

	/** Filename of the tree-sitter WASM file (e.g. "tree-sitter-python.wasm"). */
	readonly wasmFileName: string;

	/**
	 * Tree-sitter node types that represent individual string literals
	 * (e.g. ["string"] for Python).
	 */
	readonly stringNodeTypes: string[];

	/**
	 * Tree-sitter node types that represent concatenated/adjacent string literals
	 * (e.g. ["concatenated_string"] for Python).
	 */
	readonly concatenatedStringNodeTypes: string[];

	/**
	 * Extract the text content from a single string literal node,
	 * stripping quotes, prefixes, and replacing interpolations with `{}`.
	 */
	extractStringContent(node: Node): StringExtractionResult;

	/**
	 * Extract the text content from a concatenated string node,
	 * joining adjacent string literals into a single string.
	 */
	extractConcatenatedString(node: Node): StringExtractionResult;
}
