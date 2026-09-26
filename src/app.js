import { Niivue, SLICE_TYPE } from '@niivue/niivue';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';


/* ============================================================
   GLOBALS
   ============================================================ */

const $ = s => document.querySelector(s);

const nv = new Niivue({
  show3Dcrosshair: true,
  backColor: [0, 0, 0, 1],
  crosshairColor: [1, 0, 0, 1],
  isRadiologicalConvention: false
});

await nv.attachTo('gl');

window.nv = nv;


let datasets = [];
let currentDataset = null;

let cases = [];
let currentCaseIndex = -1;

let labels = [];
let byId = new Map();

let visible = new Set();
let colors = new Map();

let seg = null;

let isLoading = false;


/* ============================================================
   COLOR PALETTE
   ============================================================ */

function palette(i) {

  const h = (i * 137.508) % 360;

  const s = 0.72;
  const l = 0.58;

  const c =
    (1 - Math.abs(2 * l - 1)) * s;

  const hp = h / 60;

  const x =
    c *
    (1 - Math.abs((hp % 2) - 1));

  let r;
  let g;
  let b;


  if (hp < 1) {

    [r, g, b] =
      [c, x, 0];

  }

  else if (hp < 2) {

    [r, g, b] =
      [x, c, 0];

  }

  else if (hp < 3) {

    [r, g, b] =
      [0, c, x];

  }

  else if (hp < 4) {

    [r, g, b] =
      [0, x, c];

  }

  else if (hp < 5) {

    [r, g, b] =
      [x, 0, c];

  }

  else {

    [r, g, b] =
      [c, 0, x];

  }


  const m =
    l - c / 2;


  return [

    Math.round(
      (r + m) * 255
    ),

    Math.round(
      (g + m) * 255
    ),

    Math.round(
      (b + m) * 255
    ),

    255
  ];
}


/* ============================================================
   RESET VIEW
   ============================================================ */

function resetView() {

  if (
    nv.scene?.pan2Dxyzmm
  ) {

    nv.scene.pan2Dxyzmm =
      [0, 0, 0, 1];

  }

  nv.drawScene();
}


/* ============================================================
   BUSY / LOADING STATE
   ============================================================ */

function setBusy(
  on,
  title = 'Working…',
  detail = ''
) {

  isLoading = on;

  $('#loading')
    .classList
    .toggle(
      'hidden',
      !on
    );


  $('#loading-title')
    .textContent =
      title;


  $('#loading-detail')
    .textContent =
      detail;


  $('#dataset-select')
    .disabled =
      on;


  $('#case-select')
    .disabled =
      on;


  updateNav();
}


/* ============================================================
   NAVIGATION STATE
   ============================================================ */

function updateNav() {

  $('#prev-case').disabled =
    isLoading ||
    currentCaseIndex <= 0;


  $('#next-case').disabled =
    isLoading ||
    currentCaseIndex >=
      cases.length - 1;
}


/* ============================================================
   DATASETS
   ============================================================ */

async function refreshDatasets(
  preferred = null
) {

  datasets =
    await invoke(
      'list_datasets'
    );


  const select =
    $('#dataset-select');


  select.innerHTML =
    '';


  for (
    const dataset
    of datasets
  ) {

    const option =
      document.createElement(
        'option'
      );


    option.value =
      dataset.id;


    option.textContent =
      `${
        dataset.kind === 'internal'
          ? 'Included'
          : 'My Data'
      } · ${dataset.name} (${dataset.case_count})`;


    select.append(
      option
    );
  }


  if (!datasets.length) {

    select.innerHTML =
      '<option>No datasets</option>';

    cases = [];

    return;
  }


  const id =
    preferred &&
    datasets.some(
      d =>
        d.id === preferred
    )

      ? preferred

      : (
          currentDataset &&
          datasets.some(
            d =>
              d.id ===
              currentDataset
          )

            ? currentDataset

            : datasets[0].id
        );


  select.value =
    id;


  await selectDataset(
    id
  );


  renderManager();
}


/* ============================================================
   SELECT DATASET
   ============================================================ */

async function selectDataset(
  id
) {

  currentDataset =
    id;


  cases =
    await invoke(
      'list_cases',
      {
        datasetId: id
      }
    );


  const select =
    $('#case-select');


  select.innerHTML =
    '';


  cases.forEach(
    (caseInfo, index) => {

      const option =
        document.createElement(
          'option'
        );


      option.value =
        String(index);


      option.textContent =
        caseInfo.id;


      select.append(
        option
      );
    }
  );


  currentCaseIndex =
    -1;


  if (cases.length) {

    await loadCase(0);

  }

  else {

    $('#status').textContent =
      'This dataset has no cases.';

    updateNav();

  }
}


/* ============================================================
   APPLY SEGMENTATION LUT
   ============================================================ */

function applyLut() {

  if (
    !seg ||
    !labels.length
  ) {
    return;
  }


  const n =
    Math.max(
      ...labels.map(
        x =>
          Number(x.id)
      )
    ) + 1;


  const R =
    new Uint8ClampedArray(n);

  const G =
    new Uint8ClampedArray(n);

  const B =
    new Uint8ClampedArray(n);

  const A =
    new Uint8ClampedArray(n);

  const I =
    Array.from(
      {
        length: n
      },
      (_, i) => i
    );


  for (
    const label
    of labels
  ) {

    const id =
      Number(
        label.id
      );


    const color =
      colors.get(id);


    R[id] =
      color[0];

    G[id] =
      color[1];

    B[id] =
      color[2];


    A[id] =
      visible.has(id)
        ? 255
        : 0;
  }


  const lut = {
    R,
    G,
    B,
    A,
    I
  };


  if (
    typeof seg.setColormapLabel
    === 'function'
  ) {

    seg.setColormapLabel(
      lut
    );

  }

  else {

    seg.colormapLabel =
      lut;

  }


  nv.updateGLVolume();

  nv.drawScene();

  updateLabelCount();
}


/* ============================================================
   LABEL COUNT
   ============================================================ */

function updateLabelCount() {

  const numberNonEmpty =
    labels.filter(
      x =>
        Number(x.voxels) > 0
    ).length;


  $('#label-count')
    .textContent =
      `${visible.size}/${numberNonEmpty} shown`;
}


/* ============================================================
   LABEL LIST
   ============================================================ */

function renderLabels(
  query = ''
) {

  query =
    query
      .trim()
      .toLowerCase();


  const host =
    $('#labels');


  host.innerHTML =
    '';


  for (
    const label
    of labels
  ) {

    if (
      query &&
      !label.name
        .toLowerCase()
        .includes(query)
    ) {
      continue;
    }


    const id =
      Number(
        label.id
      );


    const voxels =
      Number(
        label.voxels || 0
      );


    const row =
      document.createElement(
        'label'
      );


    row.className =
      'label ' +
      (
        voxels
          ? ''
          : 'empty'
      );


    /* Checkbox */

    const checkbox =
      document.createElement(
        'input'
      );


    checkbox.type =
      'checkbox';


    checkbox.checked =
      visible.has(id);


    checkbox.disabled =
      !voxels;


    checkbox.onchange =
      () => {

        if (
          checkbox.checked
        ) {

          visible.add(id);

        }

        else {

          visible.delete(id);

        }


        applyLut();
      };


    /* Color */

    const swatch =
      document.createElement(
        'span'
      );


    swatch.className =
      'swatch';


    const color =
      colors.get(id);


    swatch.style.background =
      `rgb(${color[0]},${color[1]},${color[2]})`;


    /* Name */

    const name =
      document.createElement(
        'span'
      );


    name.className =
      'name';


    name.textContent =
      label.name +
      (
        voxels
          ? ''
          : ' (empty)'
      );


    if (voxels) {

      name.onclick =
        event => {

          event.preventDefault();


          visible =
            new Set(
              [id]
            );


          renderLabels(
            $('#search').value
          );


          applyLut();
        };
    }


    /* Voxel count */

    const voxelText =
      document.createElement(
        'span'
      );


    voxelText.className =
      'voxels';


    voxelText.textContent =
      voxels.toLocaleString();


    row.append(
      checkbox,
      swatch,
      name,
      voxelText
    );


    host.append(
      row
    );
  }
}


/* ============================================================
   CASE INFORMATION
   ============================================================ */

function updateCaseInfo(
  caseInfo
) {

  const dataset =
    datasets.find(
      x =>
        x.id ===
        currentDataset
    );


  $('#info-dataset')
    .textContent =
      dataset?.name ||
      '—';


  $('#info-case')
    .textContent =
      caseInfo.id;


  const ct =
    nv.volumes[0];


  let dimensions =
    null;


  let spacing =
    null;


  if (
    ct?.dims?.length >= 4
  ) {

    dimensions = [
      +ct.dims[1],
      +ct.dims[2],
      +ct.dims[3]
    ];

  }


  if (
    ct?.pixDims?.length >= 4
  ) {

    spacing = [

      Math.abs(
        +ct.pixDims[1]
      ),

      Math.abs(
        +ct.pixDims[2]
      ),

      Math.abs(
        +ct.pixDims[3]
      )
    ];

  }


  $('#ct-dimensions')
    .textContent =
      dimensions
        ? dimensions.join(
            ' × '
          )
        : '—';


  $('#ct-spacing')
    .textContent =
      spacing

        ? (
            spacing
              .map(
                x =>
                  x.toFixed(2)
              )
              .join(' × ')
            +
            ' mm'
          )

        : '—';


  $('#z-fov')
    .textContent =
      dimensions &&
      spacing

        ? (
            dimensions[2] *
            spacing[2]
          ).toFixed(1)
          + ' mm'

        : '—';


  $('#case-label-count')
    .textContent =
      `${
        labels.filter(
          x =>
            +x.voxels > 0
        ).length
      } / ${labels.length}`;
}


/* ============================================================
   LOAD CASE

   Files are read by the Rust backend and transferred to the
   frontend as byte arrays.

   They are then converted to browser File objects and loaded
   through NiiVue's File loading path.

   This avoids asset:// entirely.
   ============================================================ */

async function loadCase(
  index
) {

  if (
    isLoading ||
    index < 0 ||
    index >= cases.length
  ) {
    return;
  }


  const caseInfo =
    cases[index];


  setBusy(
    true,
    `Loading ${caseInfo.id}…`,
    'Reading CT and segmentation'
  );


  $('#status')
    .style
    .color =
      '';


  try {

    /* --------------------------------------------------------
       Labels
       -------------------------------------------------------- */

    labels =
      caseInfo.labels;


    byId =
      new Map(
        labels.map(
          x => [
            +x.id,
            x
          ]
        )
      );


    /* --------------------------------------------------------
       Read CT
       -------------------------------------------------------- */

    $('#loading-detail')
      .textContent =
        'Reading CT from disk…';


    const ctBytes =
      await invoke(
        'read_binary_file',
        {
          path:
            caseInfo.ct_path
        }
      );


    /* --------------------------------------------------------
       Read segmentation
       -------------------------------------------------------- */

    $('#loading-detail')
      .textContent =
        'Reading segmentation from disk…';


    const segmentationBytes =
      await invoke(
        'read_binary_file',
        {
          path:
            caseInfo.seg_path
        }
      );


    /* --------------------------------------------------------
       Convert to Uint8Array
       -------------------------------------------------------- */

    const ctArray =
      new Uint8Array(
        ctBytes
      );


    const segmentationArray =
      new Uint8Array(
        segmentationBytes
      );


    /* --------------------------------------------------------
       Convert to browser File objects
       -------------------------------------------------------- */

    const ctFile =
      new File(
        [ctArray],
        'ct.nii.gz',
        {
          type:
            'application/octet-stream'
        }
      );


    const segmentationFile =
      new File(
        [segmentationArray],
        'segmentations_multilabel.nii.gz',
        {
          type:
            'application/octet-stream'
        }
      );


    console.log(
      'CT file:',
      ctFile.size,
      'bytes'
    );


    console.log(
      'Segmentation file:',
      segmentationFile.size,
      'bytes'
    );


    /* --------------------------------------------------------
       Remove currently loaded volumes
       -------------------------------------------------------- */

    $('#loading-detail')
      .textContent =
        'Preparing viewer…';


    while (
      nv.volumes.length > 0
    ) {

      nv.removeVolume(
        nv.volumes[0]
      );

    }


    /* --------------------------------------------------------
       Load CT
       -------------------------------------------------------- */

    $('#loading-detail')
      .textContent =
        'Loading CT…';


    await nv.loadFromFile(
      ctFile
    );


    const ct =
      nv.volumes[0];


    if (!ct) {

      throw new Error(
        'CT did not load into NiiVue'
      );

    }


    /* --------------------------------------------------------
       Configure CT
       -------------------------------------------------------- */

    ct.colormap =
      'gray';


    ct.cal_min =
      -1000;


    ct.cal_max =
      1000;


    /* --------------------------------------------------------
       Load segmentation
       -------------------------------------------------------- */

    $('#loading-detail')
      .textContent =
        'Loading segmentation…';


    await nv.loadFromFile(
      segmentationFile
    );


    seg =
      nv.volumes[1];


    if (!seg) {

      throw new Error(
        'Segmentation did not load into NiiVue'
      );

    }


    /* --------------------------------------------------------
       Configure segmentation
       -------------------------------------------------------- */

    seg.colormap =
      'warm';


    seg.opacity =
      +$('#opacity').value;


    seg.cal_min =
      1;


    seg.cal_max =
      Math.max(
        1,
        labels.length
      );


    /* --------------------------------------------------------
       Refresh NiiVue
       -------------------------------------------------------- */

    nv.updateGLVolume();

    nv.drawScene();


    /* --------------------------------------------------------
       Update application state
       -------------------------------------------------------- */

    currentCaseIndex =
      index;


    colors =
      new Map(
        labels.map(
          x => [
            +x.id,
            palette(
              +x.id
            )
          ]
        )
      );


    visible =
      new Set(
        labels
          .filter(
            x =>
              +x.voxels > 0
          )
          .map(
            x =>
              +x.id
          )
      );


    /* --------------------------------------------------------
       UI
       -------------------------------------------------------- */

    $('#case-select')
      .value =
        String(index);


    $('#case-position')
      .textContent =
        `${index + 1} / ${cases.length}`;


    $('#search')
      .value =
        '';


    renderLabels();

    applyLut();

    updateCaseInfo(
      caseInfo
    );


    setView(3);

    resetView();


    $('#status')
      .textContent =
        `Loaded ${caseInfo.id}`;

  }

  catch (error) {

    console.error(
      'CASE LOAD ERROR:',
      error
    );


    const message =
      error?.stack ||
      error?.message ||
      String(error);


    $('#status')
      .textContent =
        `ERROR: ${
          error?.message ||
          error
        }`;


    $('#status')
      .style
      .color =
        '#ff8080';


    alert(
      `Failed to load ${caseInfo.id}\n\n` +
      `ERROR:\n${message}`
    );

  }

  finally {

    setBusy(
      false
    );

  }
}


/* ============================================================
   VIEW
   ============================================================ */

function setView(
  view
) {

  const type =
    view === 0

      ? SLICE_TYPE.AXIAL

      : view === 1

        ? SLICE_TYPE.CORONAL

        : view === 2

          ? SLICE_TYPE.SAGITTAL

          : SLICE_TYPE.MULTIPLANAR;


  nv.setSliceType(
    type
  );


  document
    .querySelectorAll(
      '[data-view]'
    )
    .forEach(
      button => {

        button
          .classList
          .toggle(
            'active',
            +button.dataset.view ===
              view
          );

      }
    );
}


/* ============================================================
   ADD DATASET
   ============================================================ */

async function addDataset() {

  const folder =
    await open({
      directory: true,
      multiple: false,
      title:
        'Choose a TotalSegmentator dataset folder'
    });


  if (!folder) {
    return;
  }


  setBusy(
    true,
    'Importing dataset…',
    'Validating cases and creating multilabel segmentations. This can take several minutes.'
  );


  try {

    const result =
      await invoke(
        'import_dataset',
        {
          sourcePath:
            folder
        }
      );


    await refreshDatasets(
      result.dataset_id
    );


    $('#status')
      .textContent =
        `Imported ${result.imported_cases} case(s)${
          result.skipped_cases
            ? `, skipped ${result.skipped_cases}`
            : ''
        }.`;

  }

  catch (error) {

    console.error(
      error
    );


    $('#status')
      .textContent =
        `Import failed: ${error}`;


    $('#status')
      .style
      .color =
        '#ff8080';

  }

  finally {

    setBusy(
      false
    );

  }
}


/* ============================================================
   DATASET MANAGER
   ============================================================ */

function renderManager() {

  const host =
    $('#dataset-list');


  host.innerHTML =
    '';


  for (
    const dataset
    of datasets
  ) {

    const row =
      document.createElement(
        'div'
      );


    row.className =
      'dataset-row';


    const info =
      document.createElement(
        'div'
      );


    info.innerHTML =
      `<b>${dataset.name}</b>` +
      `<small>${
        dataset.kind === 'internal'
          ? 'Included with application · read only'
          : 'Imported dataset'
      } · ${dataset.case_count} case(s)</small>`;


    row.append(
      info
    );


    if (
      dataset.kind ===
      'imported'
    ) {

      const button =
        document.createElement(
          'button'
        );


      button.type =
        'button';


      button.textContent =
        'Remove';


      button.onclick =
        async () => {

          if (
            !confirm(
              `Remove the app copy of “${dataset.name}”?\n\n` +
              `Your original files will not be changed.`
            )
          ) {
            return;
          }


          await invoke(
            'remove_dataset',
            {
              datasetId:
                dataset.id
            }
          );


          await refreshDatasets();

          renderManager();
        };


      row.append(
        button
      );
    }


    host.append(
      row
    );
  }
}


/* ============================================================
   BUTTONS / CONTROLS
   ============================================================ */

$('#add-dataset')
  .onclick =
    addDataset;


$('#manage-datasets')
  .onclick =
    () => {

      $('#manager')
        .showModal();

      renderManager();
    };


$('#dataset-select')
  .onchange =
    event =>
      selectDataset(
        event.target.value
      );


$('#case-select')
  .onchange =
    event =>
      loadCase(
        +event.target.value
      );


$('#prev-case')
  .onclick =
    () =>
      loadCase(
        currentCaseIndex - 1
      );


$('#next-case')
  .onclick =
    () =>
      loadCase(
        currentCaseIndex + 1
      );


$('#search')
  .oninput =
    event =>
      renderLabels(
        event.target.value
      );


$('#all')
  .onclick =
    () => {

      visible =
        new Set(
          labels
            .filter(
              x =>
                +x.voxels > 0
            )
            .map(
              x =>
                +x.id
            )
        );


      renderLabels(
        $('#search').value
      );


      applyLut();
    };


$('#none')
  .onclick =
    () => {

      visible.clear();


      renderLabels(
        $('#search').value
      );


      applyLut();
    };


$('#opacity')
  .oninput =
    event => {

      const opacity =
        +event.target.value;


      $('#opacity-value')
        .textContent =
          `${Math.round(
            opacity * 100
          )}%`;


      if (seg) {

        seg.opacity =
          opacity;


        nv.updateGLVolume();

        nv.drawScene();

      }
    };


$('#reset')
  .onclick =
    resetView;


document
  .querySelectorAll(
    '[data-view]'
  )
  .forEach(
    button => {

      button.onclick =
        () =>
          setView(
            +button.dataset.view
          );

    }
  );


/* ============================================================
   CROSSHAIR / VOXEL INFORMATION
   ============================================================ */

nv.onLocationChange =
  data => {

    try {

      /* ------------------------------------------------------
         Position
         ------------------------------------------------------ */

      if (
        data.mm &&
        data.mm.length >= 3
      ) {

        const x =
          Number(
            data.mm[0]
          );


        const y =
          Number(
            data.mm[1]
          );


        const z =
          Number(
            data.mm[2]
          );


        $('#position')
          .textContent =
            `${x.toFixed(1)}, ` +
            `${y.toFixed(1)}, ` +
            `${z.toFixed(1)} mm`;

      }

      else {

        $('#position')
          .textContent =
            '—';

      }


      /* ------------------------------------------------------
         Values
         ------------------------------------------------------ */

      const values =
        data.values;


      if (
        values &&
        values.length >= 2
      ) {

        function extractValue(
          value
        ) {

          if (
            typeof value ===
            'number'
          ) {

            return value;

          }


          if (
            !value ||
            typeof value !==
            'object'
          ) {

            return NaN;

          }


          const candidates = [

            value.value,

            value.val,

            value.intensity,

            value.calibratedValue,

            value.rawValue
          ];


          for (
            const candidate
            of candidates
          ) {

            const number =
              Number(
                candidate
              );


            if (
              Number.isFinite(
                number
              )
            ) {

              return number;

            }
          }


          return NaN;
        }


        /* ----------------------------------------------------
           CT HU
           ---------------------------------------------------- */

        const hu =
          extractValue(
            values[0]
          );


        if (
          Number.isFinite(
            hu
          )
        ) {

          $('#ct-value')
            .textContent =
              `${Math.round(
                hu
              )} HU`;

        }

        else {

          $('#ct-value')
            .textContent =
              '—';

        }


        /* ----------------------------------------------------
           Segmentation
           ---------------------------------------------------- */

        const segmentationValue =
          extractValue(
            values[1]
          );


        const labelId =
          Math.round(
            segmentationValue
          );


        if (
          Number.isFinite(
            labelId
          ) &&
          labelId > 0
        ) {

          const label =
            byId.get(
              labelId
            );


          $('#seg-value')
            .textContent =
              label
                ? label.name
                : `Label ${labelId}`;

        }

        else if (
          Number.isFinite(
            labelId
          )
        ) {

          $('#seg-value')
            .textContent =
              'background';

        }

        else {

          $('#seg-value')
            .textContent =
              '—';

        }

      }

      else {

        $('#ct-value')
          .textContent =
            '—';


        $('#seg-value')
          .textContent =
            '—';

      }

    }

    catch (error) {

      console.warn(
        'Could not update crosshair info:',
        error
      );

    }
  };


/* ============================================================
   KEYBOARD SHORTCUTS
   ============================================================ */

document.addEventListener(
  'keydown',
  async event => {

    if (
      event.target instanceof
        HTMLInputElement

      ||

      event.target instanceof
        HTMLSelectElement
    ) {
      return;
    }


    if (
      event.key === '['
    ) {

      event.preventDefault();


      await loadCase(
        currentCaseIndex - 1
      );

    }

    else if (
      event.key === ']'
    ) {

      event.preventDefault();


      await loadCase(
        currentCaseIndex + 1
      );

    }

    else if (
      '1234'.includes(
        event.key
      )
    ) {

      setView(
        +event.key - 1
      );

    }

    else if (
      event.key
        .toLowerCase() ===
      'r'
    ) {

      resetView();

    }
  }
);


/* ============================================================
   START APPLICATION
   ============================================================ */

try {

  await refreshDatasets();


  $('#status')
    .textContent =
      datasets.length
        ? 'Ready'
        : 'No datasets. Use “Add Dataset”.';

}

catch (error) {

  console.error(
    error
  );


  $('#status')
    .textContent =
      `Startup failed: ${error}`;


  $('#status')
    .style
    .color =
      '#ff8080';

}
