# Third-Party Software Notices

VP&S Anatomy Viewer incorporates third-party open-source software.

The CC0 dedication applicable to original VP&S Anatomy Viewer code
does not alter or replace the licenses of these components.

## Primary Components

### NiiVue

Version: 0.65.0
License: BSD 2-Clause License

NiiVue provides medical image visualization functionality used by
VP&S Anatomy Viewer.

Project:
https://github.com/niivue/niivue


### Tauri

License: MIT OR Apache License 2.0

VP&S Anatomy Viewer uses the Tauri framework to provide its native
desktop application environment.

Relevant components include:

- Tauri
- @tauri-apps/api
- @tauri-apps/plugin-dialog

Project:
https://tauri.app/


### nifti-rs

Version: 0.17.x

Used for reading and writing NIfTI medical imaging data.


### ndarray

Version: 0.16.x

Used for multidimensional array processing during segmentation
preprocessing.


### serde / serde_json

Used for serialization and deserialization between application
components and metadata files.


### uuid

Used to generate identifiers for imported datasets.


## JavaScript Runtime Dependencies

The application also incorporates transitive JavaScript dependencies,
including:

- @lukeed/csprng — MIT
- @lukeed/uuid — MIT
- @ungap/structured-clone — ISC
- @zarrita/storage — MIT
- array-equal — MIT
- fflate — MIT
- gl-matrix — MIT
- nifti-reader-js — MIT
- numcodecs — MIT
- reference-spec-reader — MIT
- unzipit — MIT
- uzip-module — MIT
- zarrita — MIT

Each third-party component remains subject to its own copyright
notices and license terms.

Where required by an applicable third-party license, the corresponding
copyright notice and license text should accompany redistributed
binary releases.

This file is informational and does not modify the license terms of
any third-party software.
