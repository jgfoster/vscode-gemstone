# GemStone Smalltalk

Language support for GemStone Smalltalk in VS Code.

## Features
- Syntax highlighting for `.gs`, `.st`, and `.tpz`
- Language Server Protocol (LSP) features powered by the bundled server

## GCI Library Integration

The extension uses the GemStone C Interface (GCI) thread-safe library (`libgcits`) to
communicate with GemStone/S 64 databases. The native library is loaded at runtime via
[koffi](https://koffi.dev/), a Node.js FFI library.

The GCI wrapper lives in `client/src/gciLibrary.ts` and currently exposes:

- `GciTsVersion()` — returns the library product ID and version string (no session required)

### GCI Integration Tests

GCI tests are kept separate from the normal test suite because they require a platform-specific
native library on disk. They live in `client/src/__tests__/gci/` and have their own vitest config.

Run them by setting `GCI_LIBRARY_PATH` to your `libgcits` shared library:

```sh
GCI_LIBRARY_PATH=/path/to/libgcits-3.7.2-64.dylib npm run test:gci
```

The library filename should match the pattern `libgcits-<version>-64.<ext>` where `<ext>` is
`.dylib` (macOS), `.so` (Linux), or `.dll` (Windows).

## Development
- Build: `npm run compile`
- Watch: `npm run watch`
- Test: `npm test` (unit tests only — no external dependencies)
- Test GCI: `GCI_LIBRARY_PATH=/path/to/libgcits npm run test:gci`
- Package: `npm run package`

## Publish
1. Update `publisher` in `package.json` to your Marketplace publisher id.
2. Run `npm run compile` and `vsce publish`.

## License
MIT
