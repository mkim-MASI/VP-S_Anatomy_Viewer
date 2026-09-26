# Build verification notes

The generated JavaScript and JSON configuration were syntax-checked in the creation environment.

A full Tauri compile could not be performed here because the environment does not have the Rust toolchain installed. `npm install` was also unable to finish within the environment's network timeout. Therefore the project should be treated as a build-ready V4 source implementation, not a precompiled installer.

Recommended first local validation:

1. Install Rust/Tauri prerequisites.
2. Run `npm install`.
3. Run `npm run tauri dev` with 1-2 small bundled cases.
4. Test Add Dataset with one preprocessed case.
5. Test Add Dataset with one raw case.
6. Build with `npm run tauri build`.
