/**
 * Download language .wasm files from their npm packages into the wasm/ directory.
 *
 * Usage: bun run scripts/download-wasm.ts [language...]
 *   e.g. bun run scripts/download-wasm.ts python
 *        bun run scripts/download-wasm.ts           (downloads all known languages)
 */

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

interface LanguageMapping {
	npmPackage: string;
	wasmFile: string;
}

const LANGUAGE_MAP: Record<string, LanguageMapping> = {
	python: {
		npmPackage: "tree-sitter-python",
		wasmFile: "tree-sitter-python.wasm",
	},
	cpp: {
		npmPackage: "tree-sitter-cpp",
		wasmFile: "tree-sitter-cpp.wasm",
	},
};

const WASM_DIR = resolve(dirname(import.meta.dirname), "wasm");

function copyWasm(language: string): void {
	const mapping = LANGUAGE_MAP[language];
	if (!mapping) {
		console.error(`Unknown language: ${language}`);
		console.error(`Known languages: ${Object.keys(LANGUAGE_MAP).join(", ")}`);
		process.exit(1);
	}

	const srcPath = resolve(
		dirname(import.meta.dirname),
		"node_modules",
		mapping.npmPackage,
		mapping.wasmFile,
	);

	if (!existsSync(srcPath)) {
		console.error(`WASM file not found at ${srcPath}`);
		console.error(`Have you installed the npm package? Run: bun add ${mapping.npmPackage}`);
		process.exit(1);
	}

	mkdirSync(WASM_DIR, { recursive: true });

	const destPath = join(WASM_DIR, mapping.wasmFile);
	copyFileSync(srcPath, destPath);
	console.log(`Copied ${mapping.wasmFile} → wasm/`);
}

function copyTreeSitterRuntime(): void {
	const srcPath = resolve(
		dirname(import.meta.dirname),
		"node_modules",
		"web-tree-sitter",
		"web-tree-sitter.wasm",
	);

	if (!existsSync(srcPath)) {
		console.error("web-tree-sitter.wasm not found. Is web-tree-sitter installed?");
		process.exit(1);
	}

	mkdirSync(WASM_DIR, { recursive: true });

	const destPath = join(WASM_DIR, "web-tree-sitter.wasm");
	copyFileSync(srcPath, destPath);
	console.log("Copied web-tree-sitter.wasm → wasm/");
}

const args = process.argv.slice(2);
const languages = args.length > 0 ? args : Object.keys(LANGUAGE_MAP);

copyTreeSitterRuntime();

for (const lang of languages) {
	copyWasm(lang);
}

console.log("Done.");
