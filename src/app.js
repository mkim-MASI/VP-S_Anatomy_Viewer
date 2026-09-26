import { Niivue, SLICE_TYPE } from '@niivue/niivue';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

const $ = s => document.querySelector(s);
const nv = new Niivue({show3Dcrosshair:true,backColor:[0,0,0,1],crosshairColor:[1,0,0,1],isRadiologicalConvention:false});
await nv.attachTo('gl');
window.nv=nv;
let datasets=[], currentDataset=null, cases=[], currentCaseIndex=-1, labels=[], byId=new Map(), visible=new Set(), colors=new Map(), seg=null, isLoading=false;

function palette(i){const h=(i*137.508)%360,s=.72,l=.58,c=(1-Math.abs(2*l-1))*s,hp=h/60,x=c*(1-Math.abs((hp%2)-1));let r,g,b;if(hp<1)[r,g,b]=[c,x,0];else if(hp<2)[r,g,b]=[x,c,0];else if(hp<3)[r,g,b]=[0,c,x];else if(hp<4)[r,g,b]=[0,x,c];else if(hp<5)[r,g,b]=[x,0,c];else [r,g,b]=[c,0,x];const m=l-c/2;return [Math.round((r+m)*255),Math.round((g+m)*255),Math.round((b+m)*255),255]}
function resetView(){if(nv.scene?.pan2Dxyzmm)nv.scene.pan2Dxyzmm=[0,0,0,1];nv.drawScene()}
function setBusy(on,title='Working…',detail=''){isLoading=on;$('#loading').classList.toggle('hidden',!on);$('#loading-title').textContent=title;$('#loading-detail').textContent=detail;$('#dataset-select').disabled=on;$('#case-select').disabled=on;updateNav()}
function updateNav(){$('#prev-case').disabled=isLoading||currentCaseIndex<=0;$('#next-case').disabled=isLoading||currentCaseIndex>=cases.length-1}

async function refreshDatasets(preferred=null){datasets=await invoke('list_datasets');const sel=$('#dataset-select');sel.innerHTML='';for(const d of datasets){const o=document.createElement('option');o.value=d.id;o.textContent=`${d.kind==='internal'?'Included':'My Data'} · ${d.name} (${d.case_count})`;sel.append(o)}if(!datasets.length){sel.innerHTML='<option>No datasets</option>';cases=[];return}const id=preferred&&datasets.some(d=>d.id===preferred)?preferred:(currentDataset&&datasets.some(d=>d.id===currentDataset)?currentDataset:datasets[0].id);sel.value=id;await selectDataset(id);renderManager()}
async function selectDataset(id){currentDataset=id;cases=await invoke('list_cases',{datasetId:id});const sel=$('#case-select');sel.innerHTML='';cases.forEach((c,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=c.id;sel.append(o)});currentCaseIndex=-1;if(cases.length)await loadCase(0);else{$('#status').textContent='This dataset has no cases.';updateNav()}}

function applyLut(){if(!seg||!labels.length)return;const n=Math.max(...labels.map(x=>Number(x.id)))+1,R=new Uint8ClampedArray(n),G=new Uint8ClampedArray(n),B=new Uint8ClampedArray(n),A=new Uint8ClampedArray(n),I=Array.from({length:n},(_,i)=>i);for(const x of labels){const id=Number(x.id),c=colors.get(id);R[id]=c[0];G[id]=c[1];B[id]=c[2];A[id]=visible.has(id)?255:0}const lut={R,G,B,A,I};if(typeof seg.setColormapLabel==='function')seg.setColormapLabel(lut);else seg.colormapLabel=lut;nv.updateGLVolume();nv.drawScene();updateLabelCount()}
function updateLabelCount(){const n=labels.filter(x=>Number(x.voxels)>0).length;$('#label-count').textContent=`${visible.size}/${n} shown`}
function renderLabels(q=''){q=q.trim().toLowerCase();const host=$('#labels');host.innerHTML='';for(const x of labels){if(q&&!x.name.toLowerCase().includes(q))continue;const id=Number(x.id),voxels=Number(x.voxels||0),row=document.createElement('label');row.className='label '+(voxels?'':'empty');const cb=document.createElement('input');cb.type='checkbox';cb.checked=visible.has(id);cb.disabled=!voxels;cb.onchange=()=>{cb.checked?visible.add(id):visible.delete(id);applyLut()};const sw=document.createElement('span');sw.className='swatch';const c=colors.get(id);sw.style.background=`rgb(${c[0]},${c[1]},${c[2]})`;const name=document.createElement('span');name.className='name';name.textContent=x.name+(voxels?'':' (empty)');if(voxels)name.onclick=e=>{e.preventDefault();visible=new Set([id]);renderLabels($('#search').value);applyLut()};const v=document.createElement('span');v.className='voxels';v.textContent=voxels.toLocaleString();row.append(cb,sw,name,v);host.append(row)}}
function updateCaseInfo(c){const d=datasets.find(x=>x.id===currentDataset);$('#info-dataset').textContent=d?.name||'—';$('#info-case').textContent=c.id;const ct=nv.volumes[0];let dims=null,sp=null;if(ct?.dims?.length>=4)dims=[+ct.dims[1],+ct.dims[2],+ct.dims[3]];if(ct?.pixDims?.length>=4)sp=[Math.abs(+ct.pixDims[1]),Math.abs(+ct.pixDims[2]),Math.abs(+ct.pixDims[3])];$('#ct-dimensions').textContent=dims?dims.join(' × '):'—';$('#ct-spacing').textContent=sp?sp.map(x=>x.toFixed(2)).join(' × ')+' mm':'—';$('#z-fov').textContent=dims&&sp?(dims[2]*sp[2]).toFixed(1)+' mm':'—';$('#case-label-count').textContent=`${labels.filter(x=>+x.voxels>0).length} / ${labels.length}`}
async function loadCase(index){if(isLoading||index<0||index>=cases.length)return;const c=cases[index];setBusy(true,`Loading ${c.id}…`,'Reading CT and segmentation');$('#status').style.color='';try{labels=c.labels;byId=new Map(labels.map(x=>[+x.id,x]));const ctUrl=convertFileSrc(c.ct_path),segUrl=convertFileSrc(c.seg_path);await nv.loadVolumes([{url:ctUrl,name:'ct.nii.gz',colormap:'gray',cal_min:-1000,cal_max:1000},{url:segUrl,name:'segmentations_multilabel.nii.gz',colormap:'warm',opacity:+$('#opacity').value,cal_min:1,cal_max:Math.max(1,labels.length)}]);currentCaseIndex=index;seg=nv.volumes[1];colors=new Map(labels.map(x=>[+x.id,palette(+x.id)]));visible=new Set(labels.filter(x=>+x.voxels>0).map(x=>+x.id));$('#case-select').value=String(index);$('#case-position').textContent=`${index+1} / ${cases.length}`;$('#search').value='';renderLabels();applyLut();updateCaseInfo(c);setView(3);resetView();$('#status').textContent=`Loaded ${c.id}`}catch(e){console.error(e);$('#status').textContent=`ERROR: ${e?.message||e}`;$('#status').style.color='#ff8080'}finally{setBusy(false)}}
function setView(v){const t=v===0?SLICE_TYPE.AXIAL:v===1?SLICE_TYPE.CORONAL:v===2?SLICE_TYPE.SAGITTAL:SLICE_TYPE.MULTIPLANAR;nv.setSliceType(t);document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',+b.dataset.view===v))}

async function addDataset(){const folder=await open({directory:true,multiple:false,title:'Choose a TotalSegmentator dataset folder'});if(!folder)return;setBusy(true,'Importing dataset…','Validating cases and creating multilabel segmentations. This can take several minutes.');try{const result=await invoke('import_dataset',{sourcePath:folder});await refreshDatasets(result.dataset_id);$('#status').textContent=`Imported ${result.imported_cases} case(s)${result.skipped_cases?`, skipped ${result.skipped_cases}`:''}.`}catch(e){console.error(e);$('#status').textContent=`Import failed: ${e}`;$('#status').style.color='#ff8080'}finally{setBusy(false)}}
function renderManager(){const host=$('#dataset-list');host.innerHTML='';for(const d of datasets){const row=document.createElement('div');row.className='dataset-row';const info=document.createElement('div');info.innerHTML=`<b>${d.name}</b><small>${d.kind==='internal'?'Included with application · read only':'Imported dataset'} · ${d.case_count} case(s)</small>`;row.append(info);if(d.kind==='imported'){const b=document.createElement('button');b.type='button';b.textContent='Remove';b.onclick=async()=>{if(!confirm(`Remove the app copy of “${d.name}”?\n\nYour original files will not be changed.`))return;await invoke('remove_dataset',{datasetId:d.id});await refreshDatasets();renderManager()};row.append(b)}host.append(row)}}

$('#add-dataset').onclick=addDataset;$('#manage-datasets').onclick=()=>{$('#manager').showModal();renderManager()};$('#dataset-select').onchange=e=>selectDataset(e.target.value);$('#case-select').onchange=e=>loadCase(+e.target.value);$('#prev-case').onclick=()=>loadCase(currentCaseIndex-1);$('#next-case').onclick=()=>loadCase(currentCaseIndex+1);$('#search').oninput=e=>renderLabels(e.target.value);$('#all').onclick=()=>{visible=new Set(labels.filter(x=>+x.voxels>0).map(x=>+x.id));renderLabels($('#search').value);applyLut()};$('#none').onclick=()=>{visible.clear();renderLabels($('#search').value);applyLut()};$('#opacity').oninput=e=>{const o=+e.target.value;$('#opacity-value').textContent=`${Math.round(o*100)}%`;if(seg){seg.opacity=o;nv.updateGLVolume();nv.drawScene()}};$('#reset').onclick=resetView;document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>setView(+b.dataset.view));

/* ============================================================
   CROSSHAIR / VOXEL INFORMATION
   ============================================================ */

nv.onLocationChange = (data) => {

  try {

    /* --------------------------------------------------------
       POSITION
       -------------------------------------------------------- */

    if (
      data.mm &&
      data.mm.length >= 3
    ) {

      const x = Number(data.mm[0]);
      const y = Number(data.mm[1]);
      const z = Number(data.mm[2]);

      $('#position').textContent =
        `${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)} mm`;

    }

    else {

      $('#position').textContent = '—';

    }


    /* --------------------------------------------------------
       CT INTENSITY + SEGMENTATION VALUE
       -------------------------------------------------------- */

    const values = data.values;

    if (
      values &&
      values.length >= 2
    ) {

      /*
       * NiiVue 0.65 returns objects here.
       *
       * Log these once so we can see their exact structure:
       */
      console.log(
        'CT value object:',
        values[0]
      );

      console.log(
        'SEG value object:',
        values[1]
      );


      /* ------------------------------------------------------
         Extract numeric value from NiiVue value object.

         Different NiiVue versions use slightly different
         property names, so support the common possibilities.
         ------------------------------------------------------ */

      function extractValue(v) {

        if (
          typeof v === 'number'
        ) {
          return v;
        }

        if (
          !v ||
          typeof v !== 'object'
        ) {
          return NaN;
        }

        const candidates = [
          v.value,
          v.val,
          v.intensity,
          v.calibratedValue,
          v.rawValue
        ];

        for (
          const candidate
          of candidates
        ) {

          const n =
            Number(candidate);

          if (
            Number.isFinite(n)
          ) {
            return n;
          }

        }

        return NaN;
      }


      /* ------------------------------------------------------
         CT
         ------------------------------------------------------ */

      const hu =
        extractValue(
          values[0]
        );

      if (
        Number.isFinite(hu)
      ) {

        $('#ct-value').textContent =
          `${Math.round(hu)} HU`;

      }

      else {

        $('#ct-value').textContent =
          '—';

      }


      /* ------------------------------------------------------
         SEGMENTATION
         ------------------------------------------------------ */

      const segmentationValue =
        extractValue(
          values[1]
        );

      const labelId =
        Math.round(
          segmentationValue
        );


      if (
        Number.isFinite(labelId) &&
        labelId > 0
      ) {

        const label =
          byId.get(labelId);

        $('#seg-value').textContent =
          label
            ? label.name
            : `Label ${labelId}`;

      }

      else if (
        Number.isFinite(labelId)
      ) {

        $('#seg-value').textContent =
          'background';

      }

      else {

        $('#seg-value').textContent =
          '—';

      }

    }

    else {

      $('#ct-value').textContent =
        '—';

      $('#seg-value').textContent =
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

document.addEventListener('keydown',async e=>{if(e.target instanceof HTMLInputElement||e.target instanceof HTMLSelectElement)return;if(e.key==='['){e.preventDefault();await loadCase(currentCaseIndex-1)}else if(e.key===']'){e.preventDefault();await loadCase(currentCaseIndex+1)}else if('1234'.includes(e.key))setView(+e.key-1);else if(e.key.toLowerCase()==='r')resetView()});

try{await refreshDatasets();$('#status').textContent=datasets.length?'Ready':'No datasets. Use “Add Dataset”.'}catch(e){console.error(e);$('#status').textContent=`Startup failed: ${e}`;$('#status').style.color='#ff8080'}
