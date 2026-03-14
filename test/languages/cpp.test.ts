import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Parser } from "web-tree-sitter";
import { cppLanguageSupport } from "../../src/languages/cpp.js";
import {
	createParser,
	initTreeSitter,
	loadLanguage,
	resetParserManager,
} from "../../src/parsing/parser-manager.js";

const WASM_DIR = resolve(__dirname, "../../wasm");
const CPP_WASM = resolve(WASM_DIR, "tree-sitter-cpp.wasm");

describe("CppLanguageSupport", () => {
	let parser: Parser;

	beforeEach(async () => {
		await initTreeSitter(WASM_DIR);
		const language = await loadLanguage(CPP_WASM);
		parser = createParser(language);
	});

	afterEach(() => {
		resetParserManager();
	});

	function getFirstNodeOfType(source: string, type: string) {
		const tree = parser.parse(source);
		expect(tree).not.toBeNull();
		const nodes = tree?.rootNode.descendantsOfType(type) ?? [];
		expect(nodes.length).toBeGreaterThanOrEqual(1);
		return nodes[0];
	}

	describe("extractStringContent — string_literal", () => {
		it("should extract simple double-quoted string content", () => {
			const node = getFirstNodeOfType('const char* s = "hello world";', "string_literal");
			expect(cppLanguageSupport.extractStringContent(node).content).toBe("hello world");
		});

		it("should handle empty strings", () => {
			const node = getFirstNodeOfType('const char* s = "";', "string_literal");
			expect(cppLanguageSupport.extractStringContent(node).content).toBe("");
		});

		it("should include escape sequences as-is", () => {
			const node = getFirstNodeOfType('const char* s = "line1\\nline2";', "string_literal");
			expect(cppLanguageSupport.extractStringContent(node).content).toBe("line1\\nline2");
		});

		it("should handle L prefix (wide string)", () => {
			const node = getFirstNodeOfType('const wchar_t* s = L"wide string";', "string_literal");
			expect(cppLanguageSupport.extractStringContent(node).content).toBe("wide string");
		});

		it("should handle u prefix (char16_t)", () => {
			const node = getFirstNodeOfType('const char16_t* s = u"char16";', "string_literal");
			expect(cppLanguageSupport.extractStringContent(node).content).toBe("char16");
		});

		it("should handle U prefix (char32_t)", () => {
			const node = getFirstNodeOfType('const char32_t* s = U"char32";', "string_literal");
			expect(cppLanguageSupport.extractStringContent(node).content).toBe("char32");
		});

		it("should handle u8 prefix (char8_t)", () => {
			const node = getFirstNodeOfType('const char8_t* s = u8"char8";', "string_literal");
			expect(cppLanguageSupport.extractStringContent(node).content).toBe("char8");
		});

		it("should handle string with unicode", () => {
			const node = getFirstNodeOfType('const char* s = "café ☕";', "string_literal");
			expect(cppLanguageSupport.extractStringContent(node).content).toBe("café ☕");
		});
	});

	describe("extractStringContent — raw_string_literal", () => {
		it("should extract raw string content", () => {
			const node = getFirstNodeOfType('const char* s = R"(raw string)";', "raw_string_literal");
			expect(cppLanguageSupport.extractStringContent(node).content).toBe("raw string");
		});

		it("should extract raw string with delimiter", () => {
			const node = getFirstNodeOfType(
				'const char* s = R"delim(raw with delim)delim";',
				"raw_string_literal",
			);
			expect(cppLanguageSupport.extractStringContent(node).content).toBe("raw with delim");
		});

		it("should handle multiline raw strings", () => {
			const source = `const char* s = R"(line one
line two
line three)";`;
			const node = getFirstNodeOfType(source, "raw_string_literal");
			expect(cppLanguageSupport.extractStringContent(node).content).toBe(
				"line one\nline two\nline three",
			);
		});

		it("should handle empty raw string", () => {
			const node = getFirstNodeOfType('const char* s = R"()";', "raw_string_literal");
			expect(cppLanguageSupport.extractStringContent(node).content).toBe("");
		});
	});

	describe("extractConcatenatedString", () => {
		it("should join adjacent string literals", () => {
			const node = getFirstNodeOfType('const char* s = "hello " "world";', "concatenated_string");
			expect(cppLanguageSupport.extractConcatenatedString(node).content).toBe("hello world");
		});

		it("should join three adjacent string literals", () => {
			const node = getFirstNodeOfType('const char* s = "a" "b" "c";', "concatenated_string");
			expect(cppLanguageSupport.extractConcatenatedString(node).content).toBe("abc");
		});

		it("should skip line comments between parts", () => {
			const source = `const char* s = "hello " // comment\n"world";`;
			const node = getFirstNodeOfType(source, "concatenated_string");
			expect(cppLanguageSupport.extractConcatenatedString(node).content).toBe("hello world");
		});

		it("should skip block comments between parts", () => {
			const node = getFirstNodeOfType(
				'const char* s = "hello " /* comment */ "world";',
				"concatenated_string",
			);
			expect(cppLanguageSupport.extractConcatenatedString(node).content).toBe("hello world");
		});

		it("should skip multiple comments between multiple parts", () => {
			const source = `const char* s = "a" /* c1 */ "b" // c2\n"c";`;
			const node = getFirstNodeOfType(source, "concatenated_string");
			expect(cppLanguageSupport.extractConcatenatedString(node).content).toBe("abc");
		});

		it("should handle mixed regular and raw string literals", () => {
			const node = getFirstNodeOfType(
				'const char* s = "hello " R"(world)";',
				"concatenated_string",
			);
			expect(cppLanguageSupport.extractConcatenatedString(node).content).toBe("hello world");
		});
	});

	describe("metadata", () => {
		it("should have correct language id", () => {
			expect(cppLanguageSupport.languageId).toBe("cpp");
		});

		it("should include C++ file extensions", () => {
			expect(cppLanguageSupport.fileExtensions).toContain(".cpp");
			expect(cppLanguageSupport.fileExtensions).toContain(".hpp");
			expect(cppLanguageSupport.fileExtensions).toContain(".cc");
			expect(cppLanguageSupport.fileExtensions).toContain(".cxx");
			expect(cppLanguageSupport.fileExtensions).toContain(".hxx");
		});

		it("should include C file extensions", () => {
			expect(cppLanguageSupport.fileExtensions).toContain(".c");
			expect(cppLanguageSupport.fileExtensions).toContain(".h");
		});

		it("should have both cpp and c vscode language ids", () => {
			expect(cppLanguageSupport.vscodeLanguageIds).toContain("cpp");
			expect(cppLanguageSupport.vscodeLanguageIds).toContain("c");
		});

		it("should have correct wasm filename", () => {
			expect(cppLanguageSupport.wasmFileName).toBe("tree-sitter-cpp.wasm");
		});

		it("should list string node types", () => {
			expect(cppLanguageSupport.stringNodeTypes).toContain("string_literal");
			expect(cppLanguageSupport.stringNodeTypes).toContain("raw_string_literal");
		});

		it("should list concatenated string node types", () => {
			expect(cppLanguageSupport.concatenatedStringNodeTypes).toContain("concatenated_string");
		});
	});
});
