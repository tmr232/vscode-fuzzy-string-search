import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Parser, SyntaxNode } from "web-tree-sitter";
import { pythonLanguageSupport } from "../../src/languages/python.js";
import {
	createParser,
	initTreeSitter,
	loadLanguage,
	resetParserManager,
} from "../../src/parsing/parser-manager.js";

const WASM_DIR = resolve(__dirname, "../../wasm");
const PYTHON_WASM = resolve(WASM_DIR, "tree-sitter-python.wasm");

describe("Python string extraction", () => {
	let parser: Parser;

	beforeEach(async () => {
		await initTreeSitter(WASM_DIR);
		const language = await loadLanguage(PYTHON_WASM);
		parser = createParser(language);
	});

	afterEach(() => {
		resetParserManager();
	});

	function getStringNodes(source: string): SyntaxNode[] {
		const tree = parser.parse(source);
		expect(tree).not.toBeNull();
		return tree?.rootNode.descendantsOfType("string") ?? [];
	}

	function getFirstStringNode(source: string): SyntaxNode {
		const nodes = getStringNodes(source);
		expect(nodes.length).toBeGreaterThanOrEqual(1);
		return nodes[0];
	}

	function getFirstConcatNode(source: string): SyntaxNode {
		const tree = parser.parse(source);
		expect(tree).not.toBeNull();
		const nodes = tree?.rootNode.descendantsOfType("concatenated_string") ?? [];
		expect(nodes.length).toBeGreaterThanOrEqual(1);
		return nodes[0];
	}

	describe("extractStringContent — quote stripping", () => {
		it("should strip double quotes", () => {
			const node = getFirstStringNode('x = "content"');
			expect(pythonLanguageSupport.extractStringContent(node).content).toBe("content");
		});

		it("should strip single quotes", () => {
			const node = getFirstStringNode("x = 'content'");
			expect(pythonLanguageSupport.extractStringContent(node).content).toBe("content");
		});

		it("should strip triple double quotes", () => {
			const node = getFirstStringNode('x = """content"""');
			expect(pythonLanguageSupport.extractStringContent(node).content).toBe("content");
		});

		it("should strip triple single quotes", () => {
			const node = getFirstStringNode("x = '''content'''");
			expect(pythonLanguageSupport.extractStringContent(node).content).toBe("content");
		});
	});

	describe("extractStringContent — prefix handling", () => {
		it("should handle f prefix", () => {
			const node = getFirstStringNode('x = f"text"');
			expect(pythonLanguageSupport.extractStringContent(node).content).toBe("text");
		});

		it("should handle r prefix (raw string)", () => {
			const node = getFirstStringNode('x = r"raw\\ntext"');
			expect(pythonLanguageSupport.extractStringContent(node).content).toBe("raw\\ntext");
		});

		it("should handle b prefix (byte string)", () => {
			const node = getFirstStringNode('x = b"bytes"');
			expect(pythonLanguageSupport.extractStringContent(node).content).toBe("bytes");
		});

		it("should handle uppercase B prefix", () => {
			const node = getFirstStringNode('x = B"bytes"');
			expect(pythonLanguageSupport.extractStringContent(node).content).toBe("bytes");
		});

		it("should handle rb prefix", () => {
			const node = getFirstStringNode('x = rb"rawbytes"');
			expect(pythonLanguageSupport.extractStringContent(node).content).toBe("rawbytes");
		});

		it("should handle uppercase F prefix", () => {
			const node = getFirstStringNode('x = F"text"');
			expect(pythonLanguageSupport.extractStringContent(node).content).toBe("text");
		});
	});

	describe("extractStringContent — interpolation placeholders", () => {
		it("should replace single interpolation with {}", () => {
			const node = getFirstStringNode('x = f"hello {name}"');
			expect(pythonLanguageSupport.extractStringContent(node).content).toBe("hello {}");
		});

		it("should replace multiple interpolations with {}", () => {
			const node = getFirstStringNode('x = f"{a} and {b}"');
			expect(pythonLanguageSupport.extractStringContent(node).content).toBe("{} and {}");
		});

		it("should handle interpolation at start", () => {
			const node = getFirstStringNode('x = f"{val} end"');
			expect(pythonLanguageSupport.extractStringContent(node).content).toBe("{} end");
		});

		it("should handle interpolation at end", () => {
			const node = getFirstStringNode('x = f"start {val}"');
			expect(pythonLanguageSupport.extractStringContent(node).content).toBe("start {}");
		});

		it("should handle complex expressions in interpolation", () => {
			const node = getFirstStringNode('x = f"result: {a + b * c}"');
			expect(pythonLanguageSupport.extractStringContent(node).content).toBe("result: {}");
		});

		it("should handle only interpolation, no static text", () => {
			const node = getFirstStringNode('x = f"{value}"');
			expect(pythonLanguageSupport.extractStringContent(node).content).toBe("{}");
		});
	});

	describe("extractStringContent — edge cases", () => {
		it("should handle empty string", () => {
			const node = getFirstStringNode('x = ""');
			expect(pythonLanguageSupport.extractStringContent(node).content).toBe("");
		});

		it("should handle string with only whitespace", () => {
			const node = getFirstStringNode('x = "   "');
			expect(pythonLanguageSupport.extractStringContent(node).content).toBe("   ");
		});

		it("should handle string with escape sequences", () => {
			const node = getFirstStringNode('x = "line1\\nline2\\ttab"');
			expect(pythonLanguageSupport.extractStringContent(node).content).toBe("line1\\nline2\\ttab");
		});

		it("should handle string with unicode", () => {
			const node = getFirstStringNode('x = "café ☕ 日本語"');
			expect(pythonLanguageSupport.extractStringContent(node).content).toBe("café ☕ 日本語");
		});

		it("should handle multiline content in triple-quoted string", () => {
			const node = getFirstStringNode('x = """line1\nline2\nline3"""');
			expect(pythonLanguageSupport.extractStringContent(node).content).toBe("line1\nline2\nline3");
		});
	});

	describe("extractConcatenatedString", () => {
		it("should join two adjacent strings", () => {
			const node = getFirstConcatNode('x = ("hello " "world")');
			expect(pythonLanguageSupport.extractConcatenatedString(node).content).toBe("hello world");
		});

		it("should join three adjacent strings", () => {
			const node = getFirstConcatNode('x = ("a" "b" "c")');
			expect(pythonLanguageSupport.extractConcatenatedString(node).content).toBe("abc");
		});

		it("should skip inline comments between parts", () => {
			const source = `x = (
    "part1"  # comment
    "part2"
)`;
			const node = getFirstConcatNode(source);
			expect(pythonLanguageSupport.extractConcatenatedString(node).content).toBe("part1part2");
		});

		it("should handle mixed quote styles", () => {
			const node = getFirstConcatNode("x = (\"double\" 'single')");
			expect(pythonLanguageSupport.extractConcatenatedString(node).content).toBe("doublesingle");
		});

		it("should handle f-string parts in concatenation", () => {
			const node = getFirstConcatNode('x = ("prefix " f"hello {name}")');
			expect(pythonLanguageSupport.extractConcatenatedString(node).content).toBe("prefix hello {}");
		});

		it("should handle concatenation with triple-quoted parts", () => {
			const node = getFirstConcatNode('x = ("simple" """triple""")');
			expect(pythonLanguageSupport.extractConcatenatedString(node).content).toBe("simpletriple");
		});
	});
});
