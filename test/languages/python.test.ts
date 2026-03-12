import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Parser } from "web-tree-sitter";
import { pythonLanguageSupport } from "../../src/languages/python.js";
import {
	createParser,
	initTreeSitter,
	loadLanguage,
	resetParserManager,
} from "../../src/parsing/parser-manager.js";

const WASM_DIR = resolve(__dirname, "../../wasm");
const PYTHON_WASM = resolve(WASM_DIR, "tree-sitter-python.wasm");

describe("PythonLanguageSupport", () => {
	let parser: Parser;

	beforeEach(async () => {
		await initTreeSitter(WASM_DIR);
		const language = await loadLanguage(PYTHON_WASM);
		parser = createParser(language);
	});

	afterEach(() => {
		resetParserManager();
	});

	function getFirstStringNode(source: string) {
		const tree = parser.parse(source);
		expect(tree).not.toBeNull();
		const nodes = tree?.rootNode.descendantsOfType("string") ?? [];
		expect(nodes).toHaveLength(1);
		return nodes[0];
	}

	function getFirstConcatNode(source: string) {
		const tree = parser.parse(source);
		expect(tree).not.toBeNull();
		const nodes = tree?.rootNode.descendantsOfType("concatenated_string") ?? [];
		expect(nodes).toHaveLength(1);
		return nodes[0];
	}

	describe("extractStringContent", () => {
		it("should extract double-quoted string content", () => {
			const node = getFirstStringNode('x = "hello world"');
			expect(node).toBeDefined();
			expect(pythonLanguageSupport.extractStringContent(node)).toBe("hello world");
		});

		it("should extract single-quoted string content", () => {
			const node = getFirstStringNode("x = 'single quotes'");
			expect(node).toBeDefined();
			expect(pythonLanguageSupport.extractStringContent(node)).toBe("single quotes");
		});

		it("should extract triple-quoted string content", () => {
			const node = getFirstStringNode('x = """triple quoted"""');
			expect(node).toBeDefined();
			expect(pythonLanguageSupport.extractStringContent(node)).toBe("triple quoted");
		});

		it("should extract triple single-quoted string content", () => {
			const node = getFirstStringNode("x = '''triple single'''");
			expect(node).toBeDefined();
			expect(pythonLanguageSupport.extractStringContent(node)).toBe("triple single");
		});

		it("should replace f-string interpolations with {}", () => {
			const node = getFirstStringNode('x = f"hello {name}"');
			expect(node).toBeDefined();
			expect(pythonLanguageSupport.extractStringContent(node)).toBe("hello {}");
		});

		it("should handle multiple interpolations in f-strings", () => {
			const node = getFirstStringNode('x = f"a {x} b {y} c"');
			expect(node).toBeDefined();
			expect(pythonLanguageSupport.extractStringContent(node)).toBe("a {} b {} c");
		});

		it("should handle raw strings (strip r prefix)", () => {
			const node = getFirstStringNode('x = r"raw\\nstring"');
			expect(node).toBeDefined();
			expect(pythonLanguageSupport.extractStringContent(node)).toBe("raw\\nstring");
		});

		it("should handle byte strings (strip b prefix)", () => {
			const node = getFirstStringNode('x = b"byte string"');
			expect(node).toBeDefined();
			expect(pythonLanguageSupport.extractStringContent(node)).toBe("byte string");
		});

		it("should handle empty strings", () => {
			const node = getFirstStringNode('x = ""');
			expect(node).toBeDefined();
			expect(pythonLanguageSupport.extractStringContent(node)).toBe("");
		});

		it("should handle multiline triple-quoted strings", () => {
			const source = 'x = """line one\nline two\nline three"""';
			const node = getFirstStringNode(source);
			expect(node).toBeDefined();
			expect(pythonLanguageSupport.extractStringContent(node)).toBe(
				"line one\nline two\nline three",
			);
		});
	});

	describe("extractConcatenatedString", () => {
		it("should join adjacent string literals", () => {
			const node = getFirstConcatNode('x = ("hello " "world")');
			expect(node).toBeDefined();
			expect(pythonLanguageSupport.extractConcatenatedString(node)).toBe("hello world");
		});

		it("should join strings with inline comments between them", () => {
			const source = `x = (
    "first"  # inline comment
    "second"
)`;
			const node = getFirstConcatNode(source);
			expect(node).toBeDefined();
			expect(pythonLanguageSupport.extractConcatenatedString(node)).toBe("firstsecond");
		});

		it("should handle concatenation of three strings", () => {
			const node = getFirstConcatNode('x = ("a" "b" "c")');
			expect(node).toBeDefined();
			expect(pythonLanguageSupport.extractConcatenatedString(node)).toBe("abc");
		});
	});

	describe("metadata", () => {
		it("should have correct language id", () => {
			expect(pythonLanguageSupport.languageId).toBe("python");
		});

		it("should include .py and .pyi extensions", () => {
			expect(pythonLanguageSupport.fileExtensions).toContain(".py");
			expect(pythonLanguageSupport.fileExtensions).toContain(".pyi");
		});

		it("should have correct vscode language id", () => {
			expect(pythonLanguageSupport.vscodeLanguageIds).toContain("python");
		});

		it("should have correct wasm filename", () => {
			expect(pythonLanguageSupport.wasmFileName).toBe("tree-sitter-python.wasm");
		});

		it("should list string node types", () => {
			expect(pythonLanguageSupport.stringNodeTypes).toContain("string");
		});

		it("should list concatenated string node types", () => {
			expect(pythonLanguageSupport.concatenatedStringNodeTypes).toContain("concatenated_string");
		});
	});
});
