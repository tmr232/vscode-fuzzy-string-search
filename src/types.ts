/**
 * Represents a string literal found in source code.
 */
export interface SourceString {
	/** The extracted string content (with quotes stripped, prefixes removed). */
	content: string;
	/** Absolute file path where the string was found. */
	filePath: string;
	/** 0-indexed start line. */
	startLine: number;
	/** 0-indexed start column. */
	startColumn: number;
	/** 0-indexed end line. */
	endLine: number;
	/** 0-indexed end column. */
	endColumn: number;
}
