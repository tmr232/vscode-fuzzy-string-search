The idea is to build an extension for VSCode that allows fuzzy-matching against strings in the source-code.

The matching logic should be similar to C:\\Code\\github.com\\tmr232\\source-strings\\

The algorithm on a per-file bases:

1. Parse the file using tree-sitter
2. Find all the strings in the file, including template or format strings.
3. Fuzzy-match the user query against the strings
4. Present the results to the user, sorted by match score, with a user-defined score-cutoff.

As far as the extension goes, it should have a side panel similar to the VSCode search panel.
The user inputs should be the query, the score-cutoff, and the files to include/exclude.
Naturally, git-ignored files should be ignored by default.

Package management should be done using `bun`.
Bun should also be used for all `npm` or `npx` commands,
and `bun run` prefered over `bunx` as we should add all our dependencies to the project.

Tests should be written using vitest.

Tree-sitter uses wasm, which naturally has to be packaged into the extension.
For tree-sitter-language packages that don't come with the wasm, it should be downloaded
from the matching github-releases page. This should be automated via a script.

Formatting and linting should be done using biome.js and oxlint. We want both linters to run clean.

pre-commit hooks should be set up using prek (https://prek.j178.dev/).
They should include:

- biome and js, for formatting and linting
- https://github.com/tmr232/precommit-ad-blocker/ with the default config
- Zizmor https://github.com/zizmorcore/zizmor-pre-commit to ensure the security of our github actions
- https://github.com/tmr232/ratchet-pre-commit to properly pin the versions of all github actions

The project should inclued github actions for building, testing, and publishing the extension.
Publishing should be done both the the VSCode marketplace, and to open-vsx.

fuzzy-matching should be implemented using https://www.npmjs.com/package/fuzzball

As for supported languages, the priorities are:

1. Python
2. C++
3. Other languages

For the MVP, we only need to support Python.
But the code should be structured in a way that allows adding new languages with minimal changes to the
existing code.
Probably an interface for language support, and a single place to register it.

Tests should include both string extraction (including concatenating strings where relevant)
and string matching (to ensure it actually works).

If possible, processing files should be done in parallel to get a fast response.
That said, it should not block the UI, and should be interruptible (results show up as
they are found, so the user can always say "I have enough, stop!").

A temporary cache of strings-per-file should be saved, to make future searches faster.
When a file is modified the cache for that file needs to be cleared.

Mapping of file-types to tree-sitter languages is critical to ensure parsing is done using the right language.

The project should maintain an architecture-decision-record keeping track of decisions made.
Changes should be documented in a changelog.
Choices and instructions relevant to LLM agents should be kept in skills and AGENTS.md, to ensure they function optimally.
