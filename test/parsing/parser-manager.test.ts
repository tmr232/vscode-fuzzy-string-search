import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	createParser,
	initTreeSitter,
	loadLanguage,
	resetParserManager,
} from "../../src/parsing/parser-manager.js";

const WASM_DIR = resolve(__dirname, "../../wasm");
const PYTHON_WASM = resolve(WASM_DIR, "tree-sitter-python.wasm");

describe("parser-manager", () => {
	afterEach(() => {
		resetParserManager();
	});

	it("should initialize tree-sitter without error", async () => {
		await expect(initTreeSitter(WASM_DIR)).resolves.toBeUndefined();
	});

	it("should be safe to call init multiple times", async () => {
		await initTreeSitter(WASM_DIR);
		await expect(initTreeSitter(WASM_DIR)).resolves.toBeUndefined();
	});

	it("should load a language WASM file", async () => {
		await initTreeSitter(WASM_DIR);
		const language = await loadLanguage(PYTHON_WASM);
		expect(language).toBeDefined();
	});

	it("should cache loaded languages", async () => {
		await initTreeSitter(WASM_DIR);
		const lang1 = await loadLanguage(PYTHON_WASM);
		const lang2 = await loadLanguage(PYTHON_WASM);
		expect(lang1).toBe(lang2);
	});

	it("should create a parser with a language", async () => {
		await initTreeSitter(WASM_DIR);
		const language = await loadLanguage(PYTHON_WASM);
		const parser = createParser(language);
		expect(parser).toBeDefined();
	});

	it("should parse Python source code", async () => {
		await initTreeSitter(WASM_DIR);
		const language = await loadLanguage(PYTHON_WASM);
		const parser = createParser(language);

		const tree = parser.parse('x = "hello world"');
		expect(tree).not.toBeNull();
		expect(tree?.rootNode.type).toBe("module");
		expect(tree?.rootNode.childCount).toBeGreaterThan(0);
	});

	it("should find string nodes in parsed Python", async () => {
		await initTreeSitter(WASM_DIR);
		const language = await loadLanguage(PYTHON_WASM);
		const parser = createParser(language);

		const tree = parser.parse('message = "hello world"');
		expect(tree).not.toBeNull();

		const rootNode = tree?.rootNode;
		expect(rootNode).toBeDefined();
		const stringNodes = rootNode?.descendantsOfType("string") ?? [];
		expect(stringNodes.length).toBe(1);
		expect(stringNodes[0]?.text).toBe('"hello world"');
	});
});
