import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Parser, SyntaxNode } from "web-tree-sitter";
import { cppLanguageSupport } from "../../src/languages/cpp.js";
import {
	createParser,
	initTreeSitter,
	loadLanguage,
	resetParserManager,
} from "../../src/parsing/parser-manager.js";

const WASM_DIR = resolve(__dirname, "../../wasm");
const CPP_WASM = resolve(WASM_DIR, "tree-sitter-cpp.wasm");

describe("C++ string extraction", () => {
	let parser: Parser;

	beforeEach(async () => {
		await initTreeSitter(WASM_DIR);
		const language = await loadLanguage(CPP_WASM);
		parser = createParser(language);
	});

	afterEach(() => {
		resetParserManager();
	});

	function getNodesOfType(source: string, type: string): SyntaxNode[] {
		const tree = parser.parse(source);
		expect(tree).not.toBeNull();
		return tree?.rootNode.descendantsOfType(type) ?? [];
	}

	function getFirstNodeOfType(source: string, type: string): SyntaxNode {
		const nodes = getNodesOfType(source, type);
		expect(nodes.length).toBeGreaterThanOrEqual(1);
		return nodes[0];
	}

	describe("extractStringContent — segments for string_literal", () => {
		it("should produce one segment for simple string", () => {
			const node = getFirstNodeOfType('const char* s = "hello";', "string_literal");
			const result = cppLanguageSupport.extractStringContent(node);
			expect(result.content).toBe("hello");
			expect(result.segments).toHaveLength(1);
			expect(result.segments[0].contentLength).toBe(5);
		});

		it("should produce segments for each part around escape sequences", () => {
			const node = getFirstNodeOfType('const char* s = "a\\nb";', "string_literal");
			const result = cppLanguageSupport.extractStringContent(node);
			expect(result.content).toBe("a\\nb");
			expect(result.segments).toHaveLength(3); // "a", "\n", "b"
		});

		it("should produce no segments for empty string", () => {
			const node = getFirstNodeOfType('const char* s = "";', "string_literal");
			const result = cppLanguageSupport.extractStringContent(node);
			expect(result.content).toBe("");
			expect(result.segments).toHaveLength(0);
		});
	});

	describe("extractStringContent — segments for raw_string_literal", () => {
		it("should produce one segment for raw string", () => {
			const node = getFirstNodeOfType('const char* s = R"(hello)";', "raw_string_literal");
			const result = cppLanguageSupport.extractStringContent(node);
			expect(result.content).toBe("hello");
			expect(result.segments).toHaveLength(1);
			expect(result.segments[0].contentLength).toBe(5);
		});

		it("should handle empty raw string", () => {
			const node = getFirstNodeOfType('const char* s = R"()";', "raw_string_literal");
			const result = cppLanguageSupport.extractStringContent(node);
			expect(result.content).toBe("");
			expect(result.segments).toHaveLength(1);
			expect(result.segments[0].contentLength).toBe(0);
		});
	});

	describe("extractConcatenatedString — segments", () => {
		it("should produce segments from each string child", () => {
			const node = getFirstNodeOfType('const char* s = "hello " "world";', "concatenated_string");
			const result = cppLanguageSupport.extractConcatenatedString(node);
			expect(result.content).toBe("hello world");
			expect(result.segments).toHaveLength(2);
			expect(result.segments[0].contentLength).toBe(6); // "hello "
			expect(result.segments[1].contentLength).toBe(5); // "world"
		});
	});

	describe("extractConcatenatedString — with comments", () => {
		it("should skip line comments and produce correct segments", () => {
			const source = `const char* s = "hello " // comment\n"world";`;
			const node = getFirstNodeOfType(source, "concatenated_string");
			const result = cppLanguageSupport.extractConcatenatedString(node);
			expect(result.content).toBe("hello world");
			expect(result.segments).toHaveLength(2);
			expect(result.segments[0].contentLength).toBe(6);
			expect(result.segments[1].contentLength).toBe(5);
		});

		it("should skip block comments and produce correct segments", () => {
			const node = getFirstNodeOfType(
				'const char* s = "hello " /* comment */ "world";',
				"concatenated_string",
			);
			const result = cppLanguageSupport.extractConcatenatedString(node);
			expect(result.content).toBe("hello world");
			expect(result.segments).toHaveLength(2);
		});
	});

	describe("extractStringContent — prefix stripping", () => {
		it("should strip L prefix", () => {
			const node = getFirstNodeOfType('wchar_t* s = L"text";', "string_literal");
			expect(cppLanguageSupport.extractStringContent(node).content).toBe("text");
		});

		it("should strip u prefix", () => {
			const node = getFirstNodeOfType('char16_t* s = u"text";', "string_literal");
			expect(cppLanguageSupport.extractStringContent(node).content).toBe("text");
		});

		it("should strip U prefix", () => {
			const node = getFirstNodeOfType('char32_t* s = U"text";', "string_literal");
			expect(cppLanguageSupport.extractStringContent(node).content).toBe("text");
		});

		it("should strip u8 prefix", () => {
			const node = getFirstNodeOfType('char8_t* s = u8"text";', "string_literal");
			expect(cppLanguageSupport.extractStringContent(node).content).toBe("text");
		});
	});

	describe("extractStringContent — edge cases", () => {
		it("should handle string with only whitespace", () => {
			const node = getFirstNodeOfType('const char* s = "   ";', "string_literal");
			expect(cppLanguageSupport.extractStringContent(node).content).toBe("   ");
		});

		it("should handle multiple escape sequences", () => {
			const node = getFirstNodeOfType('const char* s = "\\n\\t\\\\";', "string_literal");
			expect(cppLanguageSupport.extractStringContent(node).content).toBe("\\n\\t\\\\");
		});

		it("should handle raw string with parentheses in content", () => {
			const node = getFirstNodeOfType(
				'const char* s = R"delim(has () inside)delim";',
				"raw_string_literal",
			);
			expect(cppLanguageSupport.extractStringContent(node).content).toBe("has () inside");
		});
	});
});
