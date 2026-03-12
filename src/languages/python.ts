import type { Node } from "web-tree-sitter";
import type { LanguageSupport } from "./language-support.js";

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
 */
function extractStringContent(node: Node): string {
	const parts: string[] = [];
	for (const child of node.children) {
		if (child.type === "string_content") {
			parts.push(child.text);
		} else if (child.type === "interpolation") {
			parts.push("{}");
		}
		// Skip string_start, string_end, and any other node types
	}
	return parts.join("");
}

/**
 * Extract content from a concatenated_string node (adjacent string literals).
 *
 * In Python, `"hello" "world"` is implicitly concatenated. The tree-sitter
 * `concatenated_string` node has `string` children (and possibly `comment`
 * children for inline comments between the parts). We extract each string
 * child and join them.
 */
function extractConcatenatedString(node: Node): string {
	const parts: string[] = [];
	for (const child of node.children) {
		if (child.type === "string") {
			parts.push(extractStringContent(child));
		}
		// Skip comment nodes and other non-string children
	}
	return parts.join("");
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
