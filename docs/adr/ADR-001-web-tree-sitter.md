# ADR-001: Use web-tree-sitter (WASM) over native node bindings

## Status

Accepted

## Context

Tree-sitter provides two JavaScript/TypeScript bindings:

1. **node-tree-sitter** — native Node.js addon using N-API
2. **web-tree-sitter** — WebAssembly-based, runs anywhere WASM is supported

Our extension runs inside VSCode, which uses Electron. Native addons in Electron require:
- Rebuilding against the specific Electron ABI version
- Platform-specific prebuilt binaries (win32-x64, linux-x64, darwin-arm64, etc.)
- Careful handling of `node-gyp` build requirements on end-user machines

## Decision

Use **web-tree-sitter** (the WASM binding) for all tree-sitter parsing.

## Consequences

### Positive

- **No native compilation required**: `.wasm` files are platform-independent and work on all OS/arch combinations without rebuilding.
- **Simpler distribution**: The extension can bundle `.wasm` files directly; no need for platform-specific prebuilt binaries or `node-gyp`.
- **Easier CI/CD**: No native build step in the publish pipeline.
- **Future-proof**: The web-tree-sitter API is converging with node-tree-sitter; migration is possible if needed.

### Negative

- **Slightly slower**: WASM parsing is slower than native bindings, though the difference is small enough to be imperceptible for typical file sizes.
- **WASM file management**: Language `.wasm` files must be bundled with the extension and the `tree-sitter.wasm` runtime must be locatable at initialization time.
- **Memory management**: WASM objects (Trees, Parsers) should be explicitly deleted to avoid memory growth, though this is manageable with careful lifecycle handling.

## References

- [web-tree-sitter npm package](https://www.npmjs.com/package/web-tree-sitter)
- [Pulsar editor's experience with web-tree-sitter](https://blog.pulsar-edit.dev/posts/20240902-savetheclocktower-modern-tree-sitter-part-7/)
