import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Parser } from "web-tree-sitter";
import {
	javascriptLanguageSupport,
	jsxLanguageSupport,
	tsxLanguageSupport,
	typescriptLanguageSupport,
} from "../../src/languages/typescript.js";
import {
	createParser,
	initTreeSitter,
	loadLanguage,
	resetParserManager,
} from "../../src/parsing/parser-manager.js";

const WASM_DIR = resolve(__dirname, "../../wasm");
const TS_WASM = resolve(WASM_DIR, "tree-sitter-typescript.wasm");

describe("TypeScriptLanguageSupport", () => {
	let parser: Parser;

	beforeEach(async () => {
		await initTreeSitter(WASM_DIR);
		const language = await loadLanguage(TS_WASM);
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

	function getFirstTemplateNode(source: string) {
		const tree = parser.parse(source);
		expect(tree).not.toBeNull();
		const nodes = tree?.rootNode.descendantsOfType("template_string") ?? [];
		expect(nodes).toHaveLength(1);
		return nodes[0];
	}

	describe("extractStringContent — regular strings", () => {
		it("should extract double-quoted string content", () => {
			const node = getFirstStringNode('const x = "hello world";');
			expect(node).toBeDefined();
			expect(typescriptLanguageSupport.extractStringContent(node).content).toBe("hello world");
		});

		it("should extract single-quoted string content", () => {
			const node = getFirstStringNode("const x = 'single quoted';");
			expect(node).toBeDefined();
			expect(typescriptLanguageSupport.extractStringContent(node).content).toBe("single quoted");
		});

		it("should include escape sequences as-is", () => {
			const node = getFirstStringNode('const x = "line one\\nline two";');
			expect(node).toBeDefined();
			expect(typescriptLanguageSupport.extractStringContent(node).content).toBe(
				"line one\\nline two",
			);
		});

		it("should handle empty strings", () => {
			const node = getFirstStringNode('const x = "";');
			expect(node).toBeDefined();
			expect(typescriptLanguageSupport.extractStringContent(node).content).toBe("");
		});
	});

	describe("extractStringContent — template strings", () => {
		it("should extract simple template string content", () => {
			const node = getFirstTemplateNode("const x = `template string`;");
			expect(node).toBeDefined();
			expect(typescriptLanguageSupport.extractStringContent(node).content).toBe("template string");
		});

		it("should replace interpolation with {}", () => {
			// biome-ignore lint/suspicious/noTemplateCurlyInString: source code to parse
			const node = getFirstTemplateNode("const x = `hello ${name}!`;");
			expect(node).toBeDefined();
			expect(typescriptLanguageSupport.extractStringContent(node).content).toBe("hello {}!");
		});

		it("should handle multiple interpolations", () => {
			// biome-ignore lint/suspicious/noTemplateCurlyInString: source code to parse
			const node = getFirstTemplateNode("const x = `${greeting}, ${name}!`;");
			expect(node).toBeDefined();
			expect(typescriptLanguageSupport.extractStringContent(node).content).toBe("{}, {}!");
		});

		it("should handle empty template string", () => {
			const node = getFirstTemplateNode("const x = ``;");
			expect(node).toBeDefined();
			expect(typescriptLanguageSupport.extractStringContent(node).content).toBe("");
		});

		it("should handle multiline template string", () => {
			const node = getFirstTemplateNode("const x = `line one\nline two`;");
			expect(node).toBeDefined();
			expect(typescriptLanguageSupport.extractStringContent(node).content).toBe(
				"line one\nline two",
			);
		});
	});

	describe("extractStringContent — segments", () => {
		it("should produce one segment for a simple string", () => {
			const node = getFirstStringNode('const x = "hello";');
			expect(node).toBeDefined();
			const result = typescriptLanguageSupport.extractStringContent(node);
			expect(result.segments).toHaveLength(1);
			expect(result.segments[0].contentLength).toBe(5);
		});

		it("should produce segments for template with interpolation", () => {
			// biome-ignore lint/suspicious/noTemplateCurlyInString: source code to parse
			const node = getFirstTemplateNode("const x = `a ${b} c`;");
			expect(node).toBeDefined();
			const result = typescriptLanguageSupport.extractStringContent(node);
			expect(result.content).toBe("a {} c");
			expect(result.segments.length).toBeGreaterThanOrEqual(3);
		});
	});

	describe("extractConcatenatedString", () => {
		it("should return empty content (JS/TS has no implicit concatenation)", () => {
			const tree = parser.parse('const x = "a";');
			const node = tree?.rootNode;
			expect(node).toBeDefined();
			if (node) {
				expect(typescriptLanguageSupport.extractConcatenatedString(node).content).toBe("");
			}
		});
	});

	describe("metadata", () => {
		it("typescriptLanguageSupport has correct metadata", () => {
			expect(typescriptLanguageSupport.languageId).toBe("typescript");
			expect(typescriptLanguageSupport.fileExtensions).toContain(".ts");
			expect(typescriptLanguageSupport.fileExtensions).toContain(".mts");
			expect(typescriptLanguageSupport.fileExtensions).toContain(".cts");
			expect(typescriptLanguageSupport.vscodeLanguageIds).toContain("typescript");
			expect(typescriptLanguageSupport.wasmFileName).toBe("tree-sitter-typescript.wasm");
			expect(typescriptLanguageSupport.stringNodeTypes).toContain("string");
			expect(typescriptLanguageSupport.stringNodeTypes).toContain("template_string");
			expect(typescriptLanguageSupport.concatenatedStringNodeTypes).toEqual([]);
		});

		it("tsxLanguageSupport has correct metadata", () => {
			expect(tsxLanguageSupport.languageId).toBe("tsx");
			expect(tsxLanguageSupport.fileExtensions).toContain(".tsx");
			expect(tsxLanguageSupport.vscodeLanguageIds).toContain("typescriptreact");
			expect(tsxLanguageSupport.wasmFileName).toBe("tree-sitter-tsx.wasm");
		});

		it("javascriptLanguageSupport has correct metadata", () => {
			expect(javascriptLanguageSupport.languageId).toBe("javascript");
			expect(javascriptLanguageSupport.fileExtensions).toContain(".js");
			expect(javascriptLanguageSupport.fileExtensions).toContain(".mjs");
			expect(javascriptLanguageSupport.fileExtensions).toContain(".cjs");
			expect(javascriptLanguageSupport.vscodeLanguageIds).toContain("javascript");
			expect(javascriptLanguageSupport.wasmFileName).toBe("tree-sitter-typescript.wasm");
		});

		it("jsxLanguageSupport has correct metadata", () => {
			expect(jsxLanguageSupport.languageId).toBe("jsx");
			expect(jsxLanguageSupport.fileExtensions).toContain(".jsx");
			expect(jsxLanguageSupport.vscodeLanguageIds).toContain("javascriptreact");
			expect(jsxLanguageSupport.wasmFileName).toBe("tree-sitter-tsx.wasm");
		});
	});
});
