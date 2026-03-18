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
			const { content, segments } = language.extractConcatenatedString(node);
			results.push({
				content,
				filePath,
				startLine: node.startPosition.row,
				startColumn: node.startPosition.column,
				endLine: node.endPosition.row,
				endColumn: node.endPosition.column,
				segments,
			});
			// Don't descend into children — we already extracted the full content
		} else if (stringTypes.has(nodeType)) {
			const { content, segments } = language.extractStringContent(node);
			results.push({
				content,
				filePath,
				startLine: node.startPosition.row,
				startColumn: node.startPosition.column,
				endLine: node.endPosition.row,
				endColumn: node.endPosition.column,
				segments,
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
 * Detailed timing breakdown for a single collectStrings call (milliseconds).
 */
export interface CollectTimings {
	/** Milliseconds spent in tree-sitter parsing. */
	parseMs: number;
	/** Milliseconds spent walking the AST and collecting strings. */
	collectMs: number;
}

/**
 * Result of collectStrings, including extracted strings and timing breakdown.
 */
export interface CollectResult {
	strings: SourceString[];
	timings: CollectTimings;
}

/**
 * Parse source code and collect all string literals.
 *
 * @param source - The source code text to parse.
 * @param filePath - Absolute path to the file (used in returned SourceString objects).
 * @param parser - An initialized tree-sitter Parser with the language already set.
 * @param language - The LanguageSupport for the file's language.
 * @returns Extracted SourceString objects and timing breakdown.
 */
export function collectStrings(
	source: string,
	filePath: string,
	parser: Parser,
	language: LanguageSupport,
): CollectResult {
	const parseStart = performance.now();
	const tree = parser.parse(source);
	const parseMs = performance.now() - parseStart;

	if (!tree) return { strings: [], timings: { parseMs, collectMs: 0 } };

	const collectStart = performance.now();
	const cursor = tree.walk();
	const strings = collectFromCursor(cursor, language, filePath);
	const collectMs = performance.now() - collectStart;

	return { strings, timings: { parseMs, collectMs } };
}
