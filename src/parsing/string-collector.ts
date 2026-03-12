import type { Parser, TreeCursor } from "web-tree-sitter";
import type { LanguageSupport } from "../languages/language-support.js";
import type { SourceString } from "../types.js";

/**
 * Walk a tree-sitter AST using a TreeCursor (visitor pattern) and collect
 * all string literals recognized by the given language support.
 *
 * When a string or concatenated-string node is found, the visitor extracts
 * its content and **does not descend** into its children (matching the
 * reference source-strings Python project's behavior).
 */
function collectFromCursor(
	cursor: TreeCursor,
	language: LanguageSupport,
	filePath: string,
): SourceString[] {
	const results: SourceString[] = [];

	const stringTypes = new Set(language.stringNodeTypes);
	const concatTypes = new Set(language.concatenatedStringNodeTypes);

	const initialNodeId = cursor.nodeId;
	while (true) {
		const node = cursor.currentNode;
		const nodeType = node.type;

		if (concatTypes.has(nodeType)) {
			results.push({
				content: language.extractConcatenatedString(node),
				filePath,
				startLine: node.startPosition.row,
				startColumn: node.startPosition.column,
				endLine: node.endPosition.row,
				endColumn: node.endPosition.column,
			});
			// Don't descend into children — we already extracted the full content
		} else if (stringTypes.has(nodeType)) {
			results.push({
				content: language.extractStringContent(node),
				filePath,
				startLine: node.startPosition.row,
				startColumn: node.startPosition.column,
				endLine: node.endPosition.row,
				endColumn: node.endPosition.column,
			});
			// Don't descend into children
		} else if (cursor.gotoFirstChild()) {
			continue;
		}

		// Move to next sibling or back up
		if (cursor.nodeId === initialNodeId) break;

		if (cursor.gotoNextSibling()) continue;

		while (cursor.gotoParent() && !cursor.gotoNextSibling()) {
			// keep going up
		}

		if (cursor.nodeId === initialNodeId) break;
	}

	return results;
}

/**
 * Parse source code and collect all string literals.
 *
 * @param source - The source code text to parse.
 * @param filePath - Absolute path to the file (used in returned SourceString objects).
 * @param parser - An initialized tree-sitter Parser with the language already set.
 * @param language - The LanguageSupport for the file's language.
 * @returns Array of extracted SourceString objects.
 */
export function collectStrings(
	source: string,
	filePath: string,
	parser: Parser,
	language: LanguageSupport,
): SourceString[] {
	const tree = parser.parse(source);
	if (!tree) return [];

	const cursor = tree.walk();
	return collectFromCursor(cursor, language, filePath);
}
