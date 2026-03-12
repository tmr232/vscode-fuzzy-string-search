import { readFileSync } from "node:fs";
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
import { collectStrings } from "../../src/parsing/string-collector.js";

const WASM_DIR = resolve(__dirname, "../../wasm");
const PYTHON_WASM = resolve(WASM_DIR, "tree-sitter-python.wasm");
const FIXTURE_DIR = resolve(__dirname, "../fixtures");

describe("collectStrings", () => {
	let parser: Parser;

	beforeEach(async () => {
		await initTreeSitter(WASM_DIR);
		const language = await loadLanguage(PYTHON_WASM);
		parser = createParser(language);
	});

	afterEach(() => {
		resetParserManager();
	});

	it("should collect simple string literals", () => {
		const source = 'x = "hello world"';
		const results = collectStrings(source, "/test.py", parser, pythonLanguageSupport);

		expect(results).toHaveLength(1);
		expect(results[0].content).toBe("hello world");
		expect(results[0].filePath).toBe("/test.py");
	});

	it("should collect multiple strings from a file", () => {
		const source = `x = "first"\ny = "second"\nz = "third"`;
		const results = collectStrings(source, "/test.py", parser, pythonLanguageSupport);

		expect(results).toHaveLength(3);
		expect(results.map((s) => s.content)).toEqual(["first", "second", "third"]);
	});

	it("should collect triple-quoted strings", () => {
		const source = 'x = """triple quoted"""';
		const results = collectStrings(source, "/test.py", parser, pythonLanguageSupport);

		expect(results).toHaveLength(1);
		expect(results[0].content).toBe("triple quoted");
	});

	it("should collect f-strings with interpolation replaced", () => {
		const source = 'x = f"hello {name}"';
		const results = collectStrings(source, "/test.py", parser, pythonLanguageSupport);

		expect(results).toHaveLength(1);
		expect(results[0].content).toBe("hello {}");
	});

	it("should collect concatenated strings as a single result", () => {
		const source = 'x = ("hello " "world")';
		const results = collectStrings(source, "/test.py", parser, pythonLanguageSupport);

		expect(results).toHaveLength(1);
		expect(results[0].content).toBe("hello world");
	});

	it("should not produce separate entries for children of concatenated strings", () => {
		const source = 'x = ("a" "b" "c")';
		const results = collectStrings(source, "/test.py", parser, pythonLanguageSupport);

		expect(results).toHaveLength(1);
		expect(results[0].content).toBe("abc");
	});

	it("should handle concatenated strings with inline comments", () => {
		const source = `x = (
    "first"  # inline comment
    "second"
)`;
		const results = collectStrings(source, "/test.py", parser, pythonLanguageSupport);

		expect(results).toHaveLength(1);
		expect(results[0].content).toBe("firstsecond");
	});

	it("should include correct position information", () => {
		const source = 'x = "hello"';
		const results = collectStrings(source, "/test.py", parser, pythonLanguageSupport);

		expect(results).toHaveLength(1);
		expect(results[0].startLine).toBe(0);
		expect(results[0].startColumn).toBe(4);
		expect(results[0].endLine).toBe(0);
		expect(results[0].endColumn).toBe(11);
	});

	it("should handle multiline triple-quoted strings with correct positions", () => {
		const source = 'x = """line one\nline two\nline three"""';
		const results = collectStrings(source, "/test.py", parser, pythonLanguageSupport);

		expect(results).toHaveLength(1);
		expect(results[0].content).toBe("line one\nline two\nline three");
		expect(results[0].startLine).toBe(0);
		expect(results[0].endLine).toBe(2);
	});

	it("should collect strings nested inside function calls and assignments", () => {
		const source = `
def foo():
    print("inside function")
    return "return value"
`;
		const results = collectStrings(source, "/test.py", parser, pythonLanguageSupport);

		expect(results).toHaveLength(2);
		expect(results.map((s) => s.content)).toEqual(["inside function", "return value"]);
	});

	it("should return empty array for source with no strings", () => {
		const source = "x = 42\ny = True\n";
		const results = collectStrings(source, "/test.py", parser, pythonLanguageSupport);

		expect(results).toHaveLength(0);
	});

	it("should return empty array for empty source", () => {
		const results = collectStrings("", "/test.py", parser, pythonLanguageSupport);

		expect(results).toHaveLength(0);
	});

	it("should collect all strings from the sample.py fixture", () => {
		const samplePath = resolve(FIXTURE_DIR, "sample.py");
		const source = readFileSync(samplePath, "utf-8");
		const results = collectStrings(source, samplePath, parser, pythonLanguageSupport);

		const contents = results.map((s) => s.content);

		// Simple strings
		expect(contents).toContain("hello world");
		expect(contents).toContain("single quotes");
		expect(contents).toContain("triple quoted string");
		expect(contents).toContain("triple single quoted");

		// f-strings with interpolation replaced
		expect(contents).toContain("hello {}");
		expect(contents).toContain("a {} b {} c");

		// raw and byte strings
		expect(contents).toContain("raw\\nstring");
		expect(contents).toContain("byte string");

		// concatenated strings (single entry each)
		expect(contents).toContain("hello world");
		expect(contents).toContain("firstsecond");

		// f-string with interpolation
		expect(contents).toContain("outer {} end");

		// empty string
		expect(contents).toContain("");

		// multiline
		expect(contents).toContain("line one\nline two\nline three");
	});

	it("should handle strings in class definitions", () => {
		const source = `
class MyClass:
    """docstring"""
    name = "default"
`;
		const results = collectStrings(source, "/test.py", parser, pythonLanguageSupport);

		expect(results).toHaveLength(2);
		expect(results.map((s) => s.content)).toEqual(["docstring", "default"]);
	});

	it("should handle nested f-string content correctly", () => {
		const source = 'x = f"start {a + b} middle {c} end"';
		const results = collectStrings(source, "/test.py", parser, pythonLanguageSupport);

		expect(results).toHaveLength(1);
		expect(results[0].content).toBe("start {} middle {} end");
	});
});
