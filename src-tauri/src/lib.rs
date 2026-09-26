use ndarray::{ArrayD, Zip};
use nifti::{writer::WriterOptions, IntoNdArray, NiftiObject, ReaderOptions};
use serde::{Deserialize, Serialize};
use std::{fs, path::{Path, PathBuf}};
use tauri::{path::BaseDirectory, AppHandle, Manager};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
enum AppError {
    #[error("{0}")] Message(String),
    #[error(transparent)] Io(#[from] std::io::Error),
    #[error(transparent)] Json(#[from] serde_json::Error),
    #[error("NIfTI error: {0}")] Nifti(String),
}
impl serde::Serialize for AppError {
    fn serialize<S>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
type Result<T> = std::result::Result<T, AppError>;

#[derive(Clone, Serialize, Deserialize)]
struct LabelInfo { id:u16, name:String, voxels:u64 }
#[derive(Clone, Serialize)]
struct DatasetInfo { id:String, name:String, kind:String, case_count:usize }
#[derive(Clone, Serialize)]
struct CaseInfo { id:String, ct_path:String, seg_path:String, labels:Vec<LabelInfo> }
#[derive(Serialize)]
struct ImportResult { dataset_id:String, imported_cases:usize, skipped_cases:usize }
#[derive(Serialize, Deserialize)]
struct DatasetMeta { name:String, source:Option<String> }

fn app_import_root(app:&AppHandle)->Result<PathBuf>{let p=app.path().app_data_dir().map_err(|e|AppError::Message(e.to_string()))?.join("imported_datasets");fs::create_dir_all(&p)?;Ok(p)}
fn internal_root(app:&AppHandle)->Result<PathBuf>{app.path().resolve("resources/internal_cases",BaseDirectory::Resource).map_err(|e|AppError::Message(e.to_string()))}
fn valid_preproc(p:&Path)->bool{p.join("ct.nii.gz").is_file()&&p.join("segmentations_multilabel.nii.gz").is_file()&&p.join("labels.json").is_file()}
fn count_cases(root:&Path)->usize{fs::read_dir(root).ok().into_iter().flatten().filter_map(|e|e.ok()).filter(|e|e.file_type().map(|t|t.is_dir()).unwrap_or(false)&&valid_preproc(&e.path().join("preproc"))).count()}

#[tauri::command]
fn list_datasets(app:AppHandle)->Result<Vec<DatasetInfo>>{
    let mut out=Vec::new(); let ir=internal_root(&app)?;
    if ir.is_dir(){let n=count_cases(&ir);if n>0{out.push(DatasetInfo{id:"internal".into(),name:"Included Cases".into(),kind:"internal".into(),case_count:n})}}
    let root=app_import_root(&app)?;
    for e in fs::read_dir(root)?{let e=e?;if !e.file_type()?.is_dir(){continue}let p=e.path();let meta=fs::read_to_string(p.join("dataset.json")).ok().and_then(|x|serde_json::from_str::<DatasetMeta>(&x).ok());let name=meta.map(|m|m.name).unwrap_or_else(||e.file_name().to_string_lossy().into_owned());out.push(DatasetInfo{id:format!("imported:{}",e.file_name().to_string_lossy()),name,kind:"imported".into(),case_count:count_cases(&p)})}
    out.sort_by(|a,b|a.kind.cmp(&b.kind).then(a.name.cmp(&b.name))); Ok(out)
}

fn dataset_path(app:&AppHandle,id:&str)->Result<PathBuf>{if id=="internal"{internal_root(app)}else if let Some(k)=id.strip_prefix("imported:"){Ok(app_import_root(app)?.join(k))}else{Err(AppError::Message("Unknown dataset".into()))}}
#[tauri::command]
fn list_cases(app:AppHandle,dataset_id:String)->Result<Vec<CaseInfo>>{
    let root=dataset_path(&app,&dataset_id)?;let mut out=Vec::new();if !root.is_dir(){return Ok(out)}
    for e in fs::read_dir(root)?{let e=e?;if !e.file_type()?.is_dir(){continue}let pp=e.path().join("preproc");if !valid_preproc(&pp){continue}let labels:Vec<LabelInfo>=serde_json::from_str(&fs::read_to_string(pp.join("labels.json"))?)?;out.push(CaseInfo{id:e.file_name().to_string_lossy().into_owned(),ct_path:pp.join("ct.nii.gz").to_string_lossy().into_owned(),seg_path:pp.join("segmentations_multilabel.nii.gz").to_string_lossy().into_owned(),labels})}
    out.sort_by(|a,b|a.id.cmp(&b.id));Ok(out)
}

fn case_candidates(root:&Path)->Result<Vec<PathBuf>>{
    if valid_preproc(&root.join("preproc")) || (root.join("ct.nii.gz").is_file()&&root.join("segmentations").is_dir()){return Ok(vec![root.to_path_buf()])}
    let mut v=Vec::new();for e in fs::read_dir(root)?{let e=e?;if e.file_type()?.is_dir(){let p=e.path();if valid_preproc(&p.join("preproc"))||(p.join("ct.nii.gz").is_file()&&p.join("segmentations").is_dir()){v.push(p)}}}v.sort();Ok(v)
}
fn copy_preproc(src:&Path,dst:&Path)->Result<()> {fs::create_dir_all(dst)?;for n in ["ct.nii.gz","segmentations_multilabel.nii.gz","labels.json"]{fs::copy(src.join(n),dst.join(n))?;}Ok(())}
fn seg_name(path:&Path)->String{let s=path.file_name().unwrap_or_default().to_string_lossy();s.strip_suffix(".nii.gz").or_else(||s.strip_suffix(".nii")).unwrap_or(&s).to_string()}

fn preprocess_raw(case:&Path,dst:&Path)->Result<()> {
    fs::create_dir_all(dst)?; let ct_path=case.join("ct.nii.gz");fs::copy(&ct_path,dst.join("ct.nii.gz"))?;
    let ct_obj=ReaderOptions::new().read_file(&ct_path).map_err(|e|AppError::Nifti(e.to_string()))?;let header=ct_obj.header().clone();let ct_shape=ct_obj.into_volume().into_ndarray::<f32>().map_err(|e|AppError::Nifti(e.to_string()))?.raw_dim();
    let mut combined=ArrayD::<u16>::zeros(ct_shape.clone());let mut files:Vec<PathBuf>=fs::read_dir(case.join("segmentations"))?.filter_map(|e|e.ok()).map(|e|e.path()).filter(|p|p.file_name().map(|n|{let s=n.to_string_lossy();s.ends_with(".nii.gz")||s.ends_with(".nii")}).unwrap_or(false)).collect();files.sort();
    if files.is_empty(){return Err(AppError::Message(format!("No NIfTI masks found in {}",case.display())))}
    if files.len()>u16::MAX as usize{return Err(AppError::Message("Too many segmentation labels".into()))}
    let mut labels=Vec::new();
    for (idx,p) in files.iter().enumerate(){let id=(idx+1) as u16;let obj=ReaderOptions::new().read_file(p).map_err(|e|AppError::Nifti(format!("{}: {e}",p.display())))?;let arr=obj.into_volume().into_ndarray::<f32>().map_err(|e|AppError::Nifti(e.to_string()))?;if arr.raw_dim()!=ct_shape{return Err(AppError::Message(format!("Mask dimensions do not match CT: {}",p.display())))}let mut count=0u64;Zip::from(&mut combined).and(&arr).for_each(|out,&v|{if v!=0.0{*out=id;count+=1}});labels.push(LabelInfo{id,name:seg_name(p),voxels:count});}
    WriterOptions::new(dst.join("segmentations_multilabel.nii.gz")).reference_header(&header).write_nifti(&combined).map_err(|e|AppError::Nifti(e.to_string()))?;fs::write(dst.join("labels.json"),serde_json::to_vec_pretty(&labels)?)?;Ok(())
}

#[tauri::command]
fn import_dataset(app:AppHandle,source_path:String)->Result<ImportResult>{
    let source=PathBuf::from(&source_path);if !source.is_dir(){return Err(AppError::Message("Selected path is not a directory".into()))}let candidates=case_candidates(&source)?;if candidates.is_empty(){return Err(AppError::Message("No cases found. Expected case/preproc/{ct.nii.gz, labels.json, segmentations_multilabel.nii.gz} or case/{ct.nii.gz, segmentations/}.".into()))}
    let key=Uuid::new_v4().simple().to_string();let dst_root=app_import_root(&app)?.join(&key);fs::create_dir_all(&dst_root)?;let name=source.file_name().unwrap_or_default().to_string_lossy().into_owned();fs::write(dst_root.join("dataset.json"),serde_json::to_vec_pretty(&DatasetMeta{name:name.clone(),source:Some(source_path.clone())})?)?;
    let mut imported=0;let mut skipped=0;
    for case in candidates{let cid=case.file_name().unwrap_or_default().to_string_lossy().into_owned();let dst=dst_root.join(&cid).join("preproc");let r=if valid_preproc(&case.join("preproc")){copy_preproc(&case.join("preproc"),&dst)}else{preprocess_raw(&case,&dst)};match r{Ok(_)=>imported+=1,Err(e)=>{eprintln!("Skipping {cid}: {e}");skipped+=1;let _=fs::remove_dir_all(dst_root.join(&cid));}}}
    if imported==0{let _=fs::remove_dir_all(&dst_root);return Err(AppError::Message("No cases could be imported. Check that CT and masks have matching dimensions.".into()))}Ok(ImportResult{dataset_id:format!("imported:{key}"),imported_cases:imported,skipped_cases:skipped})
}

#[tauri::command]
fn remove_dataset(app:AppHandle,dataset_id:String)->Result<()> {let key=dataset_id.strip_prefix("imported:").ok_or_else(||AppError::Message("Included datasets cannot be removed".into()))?;let root=app_import_root(&app)?;let p=root.join(key);let canon_root=root.canonicalize()?;let canon=p.canonicalize()?;if !canon.starts_with(canon_root){return Err(AppError::Message("Invalid dataset path".into()))}fs::remove_dir_all(canon)?;Ok(())}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(){tauri::Builder::default().plugin(tauri_plugin_dialog::init()).invoke_handler(tauri::generate_handler![list_datasets,list_cases,import_dataset,remove_dataset]).run(tauri::generate_context!()).expect("error while running TotalSegmentator Viewer");}
