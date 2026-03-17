import type { Node } from "web-tree-sitter";
import type { ContentSegment } from "../types.js";
import type { LanguageSupport, StringExtractionResult } from "./language-support.js";

/**
 * Extract content from a string or template_string node.
 *
 * Both regular strings (`"..."`, `'...'`) and template strings (`` `...` ``)
 * share the same child node types in tree-sitter-typescript:
 *   - `string_fragment` — literal text
 *   - `escape_sequence` — backslash escapes (e.g. `\n`, `\\`)
 *   - `template_substitution` — `${...}` interpolation (template strings only)
 *
 * We extract `string_fragment` and `escape_sequence` children as-is, and
 * replace `template_substitution` nodes with `{}` (matching the Python
 * f-string handling in the reference project).
 */
function extractStringContent(node: Node): StringExtractionResult {
	const parts: string[] = [];
	const segments: ContentSegment[] = [];
	for (const child of node.children) {
		if (child.type === "string_fragment" || child.type === "escape_sequence") {
			parts.push(child.text);
			segments.push({
				contentLength: child.text.length,
				startLine: child.startPosition.row,
				startColumn: child.startPosition.column,
				endLine: child.endPosition.row,
				endColumn: child.endPosition.column,
			});
		} else if (child.type === "template_substitution") {
			parts.push("{}");
			segments.push({
				contentLength: 2,
				startLine: child.startPosition.row,
				startColumn: child.startPosition.column,
				endLine: child.endPosition.row,
				endColumn: child.endPosition.column,
			});
		}
		// Skip opening/closing quotes and backticks (anonymous nodes)
	}
	return { content: parts.join(""), segments };
}

/**
 * JS/TS does not have implicit string concatenation, so this is a no-op.
 */
function extractConcatenatedString(_node: Node): StringExtractionResult {
	return { content: "", segments: [] };
}

export const typescriptLanguageSupport: LanguageSupport = {
	languageId: "typescript",
	fileExtensions: [".ts", ".mts", ".cts"],
	vscodeLanguageIds: ["typescript"],
	wasmFileName: "tree-sitter-typescript.wasm",
	stringNodeTypes: ["string", "template_string"],
	concatenatedStringNodeTypes: [],
	extractStringContent,
	extractConcatenatedString,
};

export const tsxLanguageSupport: LanguageSupport = {
	languageId: "tsx",
	fileExtensions: [".tsx"],
	vscodeLanguageIds: ["typescriptreact"],
	wasmFileName: "tree-sitter-tsx.wasm",
	stringNodeTypes: ["string", "template_string"],
	concatenatedStringNodeTypes: [],
	extractStringContent,
	extractConcatenatedString,
};

export const javascriptLanguageSupport: LanguageSupport = {
	languageId: "javascript",
	fileExtensions: [".js", ".mjs", ".cjs"],
	vscodeLanguageIds: ["javascript"],
	wasmFileName: "tree-sitter-typescript.wasm",
	stringNodeTypes: ["string", "template_string"],
	concatenatedStringNodeTypes: [],
	extractStringContent,
	extractConcatenatedString,
};

export const jsxLanguageSupport: LanguageSupport = {
	languageId: "jsx",
	fileExtensions: [".jsx"],
	vscodeLanguageIds: ["javascriptreact"],
	wasmFileName: "tree-sitter-tsx.wasm",
	stringNodeTypes: ["string", "template_string"],
	concatenatedStringNodeTypes: [],
	extractStringContent,
	extractConcatenatedString,
};
