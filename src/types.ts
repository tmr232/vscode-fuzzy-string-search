/**
 * A contiguous segment of extracted content mapped back to its source position.
 *
 * Each segment represents a piece of the assembled `content` string and records
 * where that piece lives in the original source file. For simple strings there
 * is a single segment; for f-strings (with interpolation placeholders) and
 * concatenated strings there are multiple segments.
 */
export interface ContentSegment {
	/** Number of characters this segment contributes to the content string. */
	contentLength: number;
	/** 0-indexed start line in the source file. */
	startLine: number;
	/** 0-indexed start column in the source file. */
	startColumn: number;
	/** 0-indexed end line in the source file. */
	endLine: number;
	/** 0-indexed end column in the source file. */
	endColumn: number;
}

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
	/** Mapping from content character ranges back to source file positions. */
	segments: ContentSegment[];
}
