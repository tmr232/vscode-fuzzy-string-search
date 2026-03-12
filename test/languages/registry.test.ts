import { describe, expect, it } from "vitest";
import {
	getAllLanguages,
	getLanguageById,
	getLanguageByVscodeId,
	getLanguageForFile,
} from "../../src/languages/registry.js";

describe("language registry", () => {
	describe("getLanguageForFile", () => {
		it("should return Python for .py files", () => {
			const lang = getLanguageForFile("example.py");
			expect(lang?.languageId).toBe("python");
		});

		it("should return Python for .pyi files", () => {
			const lang = getLanguageForFile("stubs.pyi");
			expect(lang?.languageId).toBe("python");
		});

		it("should be case-insensitive for extensions", () => {
			const lang = getLanguageForFile("Example.PY");
			expect(lang?.languageId).toBe("python");
		});

		it("should return undefined for unsupported extensions", () => {
			expect(getLanguageForFile("file.rs")).toBeUndefined();
		});

		it("should return undefined for files without an extension", () => {
			expect(getLanguageForFile("Makefile")).toBeUndefined();
		});

		it("should handle full paths", () => {
			const lang = getLanguageForFile("/home/user/project/main.py");
			expect(lang?.languageId).toBe("python");
		});
	});

	describe("getLanguageByVscodeId", () => {
		it("should return Python for 'python' vscode id", () => {
			const lang = getLanguageByVscodeId("python");
			expect(lang?.languageId).toBe("python");
		});

		it("should return undefined for unknown vscode id", () => {
			expect(getLanguageByVscodeId("rust")).toBeUndefined();
		});
	});

	describe("getLanguageById", () => {
		it("should return Python for 'python' id", () => {
			const lang = getLanguageById("python");
			expect(lang?.languageId).toBe("python");
		});

		it("should return undefined for unknown id", () => {
			expect(getLanguageById("unknown")).toBeUndefined();
		});
	});

	describe("getAllLanguages", () => {
		it("should return at least Python", () => {
			const all = getAllLanguages();
			expect(all.length).toBeGreaterThanOrEqual(1);
			expect(all.some((l) => l.languageId === "python")).toBe(true);
		});
	});
});
