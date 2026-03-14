import type { Node } from "web-tree-sitter";
import type { ContentSegment } from "../types.js";
import type { LanguageSupport, StringExtractionResult } from "./language-support.js";

/**
 * Extract content from a single C/C++ string_literal node.
 *
 * C++ string_literal nodes in tree-sitter-cpp have children:
 *   - Opening token: `"`, `L"`, `u"`, `U"`, `u8"` (string prefix + quote)
 *   - `string_content` (text between quotes)
 *   - `escape_sequence` (e.g. `\n`, `\t`, `\\`)
 *   - Closing `"`
 *
 * Unlike Python, escape sequences are separate child nodes rather than
 * being embedded in string_content. We include them as-is (the raw escape
 * text like `\n`) since we're doing fuzzy text matching, not interpretation.
 */
function extractStringLiteralContent(node: Node): StringExtractionResult {
	const parts: string[] = [];
	const segments: ContentSegment[] = [];
	for (const child of node.children) {
		if (child.type === "string_content" || child.type === "escape_sequence") {
			parts.push(child.text);
			segments.push({
				contentLength: child.text.length,
				startLine: child.startPosition.row,
				startColumn: child.startPosition.column,
				endLine: child.endPosition.row,
				endColumn: child.endPosition.column,
			});
		}
		// Skip opening token (", L", u", U", u8") and closing "
	}
	return { content: parts.join(""), segments };
}

/**
 * Extract content from a raw_string_literal node.
 *
 * Raw string literals in tree-sitter-cpp have children:
 *   - `R"` (opening)
 *   - optional `raw_string_delimiter`
 *   - `(` (opening paren)
 *   - `raw_string_content` (the actual content, may be multiline)
 *   - `)` (closing paren)
 *   - optional `raw_string_delimiter`
 *   - `"` (closing quote)
 */
function extractRawStringContent(node: Node): StringExtractionResult {
	const parts: string[] = [];
	const segments: ContentSegment[] = [];
	for (const child of node.children) {
		if (child.type === "raw_string_content") {
			parts.push(child.text);
			segments.push({
				contentLength: child.text.length,
				startLine: child.startPosition.row,
				startColumn: child.startPosition.column,
				endLine: child.endPosition.row,
				endColumn: child.endPosition.column,
			});
		}
	}
	return { content: parts.join(""), segments };
}

/**
 * Extract content from either a string_literal or raw_string_literal node.
 */
function extractStringContent(node: Node): StringExtractionResult {
	if (node.type === "raw_string_literal") {
		return extractRawStringContent(node);
	}
	return extractStringLiteralContent(node);
}

/**
 * Extract content from a concatenated_string node (adjacent string literals).
 *
 * In C/C++, `"hello" "world"` is implicitly concatenated at compile time.
 * The tree-sitter `concatenated_string` node has `string_literal` and/or
 * `raw_string_literal` children. We extract each child and join them.
 */
function extractConcatenatedString(node: Node): StringExtractionResult {
	const parts: string[] = [];
	const segments: ContentSegment[] = [];
	for (const child of node.children) {
		if (child.type === "string_literal" || child.type === "raw_string_literal") {
			const result = extractStringContent(child);
			parts.push(result.content);
			segments.push(...result.segments);
		}
	}
	return { content: parts.join(""), segments };
}

export const cppLanguageSupport: LanguageSupport = {
	languageId: "cpp",
	fileExtensions: [".cpp", ".hpp", ".cc", ".cxx", ".hxx", ".c", ".h", ".hh", ".C", ".H"],
	vscodeLanguageIds: ["cpp", "c"],
	wasmFileName: "tree-sitter-cpp.wasm",
	stringNodeTypes: ["string_literal", "raw_string_literal"],
	concatenatedStringNodeTypes: ["concatenated_string"],
	extractStringContent,
	extractConcatenatedString,
};
