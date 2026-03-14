import type { Node } from "web-tree-sitter";
import type { ContentSegment } from "../types.js";
import type { LanguageSupport, StringExtractionResult } from "./language-support.js";

/**
 * Extract content from a single Python string node.
 *
 * Python string nodes in tree-sitter-python (v0.25+) have children:
 *   string_start ("'" or '"' or '"""' etc., possibly with prefix like f, r, b)
 *   string_content (text between quotes)
 *   interpolation (f-string `{expr}` — zero or more)
 *   string_end (closing quote)
 *
 * We extract `string_content` children as-is and replace `interpolation` nodes
 * with `{}`, matching the reference Python project's behavior.
 *
 * Each extracted piece is tracked as a {@link ContentSegment} so that character
 * offsets within the assembled content can be mapped back to source positions.
 */
function extractStringContent(node: Node): StringExtractionResult {
	const parts: string[] = [];
	const segments: ContentSegment[] = [];
	for (const child of node.children) {
		if (child.type === "string_content") {
			parts.push(child.text);
			segments.push({
				contentLength: child.text.length,
				startLine: child.startPosition.row,
				startColumn: child.startPosition.column,
				endLine: child.endPosition.row,
				endColumn: child.endPosition.column,
			});
		} else if (child.type === "interpolation") {
			parts.push("{}");
			segments.push({
				contentLength: 2,
				startLine: child.startPosition.row,
				startColumn: child.startPosition.column,
				endLine: child.endPosition.row,
				endColumn: child.endPosition.column,
			});
		}
		// Skip string_start, string_end, and any other node types
	}
	return { content: parts.join(""), segments };
}

/**
 * Extract content from a concatenated_string node (adjacent string literals).
 *
 * In Python, `"hello" "world"` is implicitly concatenated. The tree-sitter
 * `concatenated_string` node has `string` children (and possibly `comment`
 * children for inline comments between the parts). We extract each string
 * child and join them.
 */
function extractConcatenatedString(node: Node): StringExtractionResult {
	const parts: string[] = [];
	const segments: ContentSegment[] = [];
	for (const child of node.children) {
		if (child.type === "string") {
			const result = extractStringContent(child);
			parts.push(result.content);
			segments.push(...result.segments);
		}
		// Skip comment nodes and other non-string children
	}
	return { content: parts.join(""), segments };
}

export const pythonLanguageSupport: LanguageSupport = {
	languageId: "python",
	fileExtensions: [".py", ".pyi"],
	vscodeLanguageIds: ["python"],
	wasmFileName: "tree-sitter-python.wasm",
	stringNodeTypes: ["string"],
	concatenatedStringNodeTypes: ["concatenated_string"],
	extractStringContent,
	extractConcatenatedString,
};
