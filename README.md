# TotalSegmentator CT Viewer V4

A cross-platform Tauri + NiiVue desktop viewer with:

- bundled, read-only internal cases
- native **Add Dataset** folder picker
- import of already-preprocessed cases
- native Rust preprocessing of raw TotalSegmentator masks
- app-managed imported datasets
- axial / coronal / sagittal / multiplanar NiiVue views
- per-label show/hide, isolate, search, opacity, HU and label readout
- no Python, local HTTP server, or command line required for end users
- no CDN dependency at runtime (NiiVue is bundled by Vite)

## 1. Internal cases

Before building, copy curated cases into:

```text
src-tauri/resources/internal_cases/
├── s0591/
│   └── preproc/
│       ├── ct.nii.gz
│       ├── labels.json
│       └── segmentations_multilabel.nii.gz
└── s0763/
    └── preproc/
        ├── ct.nii.gz
        ├── labels.json
        └── segmentations_multilabel.nii.gz
```

They are bundled into the application and are read-only at runtime.

## 2. External datasets accepted by Add Dataset

### Already preprocessed

```text
MyStudy/
├── case001/preproc/
│   ├── ct.nii.gz
│   ├── labels.json
│   └── segmentations_multilabel.nii.gz
└── case002/preproc/...
```

### Raw TotalSegmentator-style

```text
MyStudy/
├── case001/
│   ├── ct.nii.gz
│   └── segmentations/
│       ├── aorta.nii.gz
│       ├── liver.nii.gz
│       └── ...
└── case002/...
```

Raw masks are sorted by filename, assigned integer labels, validated against the CT dimensions, and combined into `segmentations_multilabel.nii.gz`. The app stores a copy of the CT, multilabel segmentation, and generated `labels.json` in its application-data directory. It never edits the source dataset.

## 3. Developer prerequisites

Install:

- Node.js / npm
- Rust via rustup
- Tauri 2 OS prerequisites: https://v2.tauri.app/start/prerequisites/

Then from this directory:

```bash
npm install
npm run tauri dev
```

## 4. Build installers

```bash
npm run tauri build
```

Build Windows installers on Windows and macOS `.app` / `.dmg` bundles on macOS. Before public distribution, change the placeholder bundle identifier in `src-tauri/tauri.conf.json` and configure platform code signing/notarization.

## Notes

- Imported data are stored under Tauri's application-data directory in `imported_datasets/`.
- Removing an imported dataset removes only the app-managed copy.
- The asset protocol is deliberately scoped to bundled internal cases and imported app-data cases.
- The current raw importer validates dimensions. A future production-hardening step would also compare affine/orientation matrices before combining masks.
