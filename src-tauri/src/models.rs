//! Local GGUF discovery: HuggingFace hub layout, llama.cpp's loose model
//! directories, and multimodal projector filenames.

use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Serialize)]
pub(crate) struct LocalModel {
    pub(crate) name: String,
    pub(crate) filename: String,
    pub(crate) path: String,
    pub(crate) size: u64,
    /// Path to a multimodal projector (mmproj) file in the same snapshot, if
    /// any. Passed to llama-server via `--mmproj` when the model is started.
    pub(crate) mmproj: Option<String>,
}

pub(crate) fn hf_hub_dir() -> PathBuf {
    // Honour the standard HuggingFace cache overrides so llama-panel finds
    // (and downloads into) the same place as the CLI tools (issue #3).
    if let Some(dir) = std::env::var_os("HF_HUB_CACHE") {
        return PathBuf::from(dir);
    }
    if let Some(home) = std::env::var_os("HF_HOME") {
        return PathBuf::from(home).join("hub");
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home)
        .join(".cache")
        .join("huggingface")
        .join("hub")
}

/// Extra directories of loose GGUF files to scan, from llama.cpp's env vars
/// (issue #3): `LLAMA_ARG_MODELS_DIR` (llama-server's `--models` dir) and
/// `LLAMA_CACHE`. Deduplicated and only existing directories are returned.
pub(crate) fn loose_model_dirs() -> Vec<PathBuf> {
    collect_model_dirs([
        std::env::var_os("LLAMA_ARG_MODELS_DIR"),
        std::env::var_os("LLAMA_CACHE"),
    ])
}

/// Keep existing, unique directories from `candidates`. Missing paths, files,
/// and repeats (including two spellings of the same directory) are dropped.
/// `loose_model_dirs` feeds this the llama.cpp environment variables.
pub(crate) fn collect_model_dirs<I, S>(candidates: I) -> Vec<PathBuf>
where
    I: IntoIterator<Item = Option<S>>,
    S: AsRef<std::ffi::OsStr>,
{
    let mut dirs: Vec<PathBuf> = Vec::new();
    for val in candidates.into_iter().flatten() {
        let path = PathBuf::from(val.as_ref());
        let canon = std::fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
        if path.is_dir() && !dirs.contains(&canon) {
            dirs.push(canon);
        }
    }
    dirs
}

pub(crate) fn repo_dir(repo: &str) -> PathBuf {
    hf_hub_dir().join(format!("models--{}", repo.replace('/', "--")))
}

/// Whether a GGUF filename is a multimodal projector ("mmproj-*.gguf").
/// These are companions to a model, not standalone models (issue #2).
/// Only the last path segment is checked.
pub(crate) fn is_mmproj_name(name: &str) -> bool {
    name.rsplit('/')
        .next()
        .unwrap_or(name)
        .to_lowercase()
        .contains("mmproj")
}

/// Turn a HuggingFace tree entry into a `{path, size, hash}` download descriptor.
pub(crate) fn tree_file_entry(f: &serde_json::Value) -> serde_json::Value {
    // LFS files carry the SHA256 in lfs.oid; non-LFS files use oid directly.
    let blob_hash = f["lfs"]["oid"]
        .as_str()
        .or_else(|| f["oid"].as_str())
        .unwrap_or("")
        .to_string();
    serde_json::json!({
        "path": f["path"].as_str().unwrap_or(""),
        "size": f["size"].as_u64().unwrap_or(0),
        "hash": blob_hash,
    })
}

/// Scan a flat directory of loose GGUF files (llama-server's model dir) and
/// append them as local models. Split parts are grouped and mmproj files are
/// attached as projectors, mirroring the HF hub scan (issue #3).
pub(crate) fn scan_loose_gguf_dir(dir: &Path, models: &mut Vec<LocalModel>) {
    let split_re = regex::Regex::new(r"-\d{5}-of-\d{5}\.gguf$").unwrap();
    let of_re = regex::Regex::new(r"-\d{5}-of-(\d{5})\.gguf$").unwrap();

    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };

    use std::collections::BTreeMap;
    let mut bundles: BTreeMap<String, (Vec<String>, u64)> = BTreeMap::new();
    let mut mmproj_paths: Vec<PathBuf> = Vec::new();

    for file in entries.flatten() {
        let fname = file.file_name().to_string_lossy().to_string();
        if !fname.ends_with(".gguf") {
            continue;
        }
        if is_mmproj_name(&fname) {
            mmproj_paths.push(file.path());
            continue;
        }
        let size = std::fs::metadata(file.path()).map(|m| m.len()).unwrap_or(0);
        let key = if split_re.is_match(&fname) {
            split_re.replace(&fname, ".gguf").to_string()
        } else {
            fname.clone()
        };
        let bentry = bundles.entry(key).or_insert_with(|| (Vec::new(), 0));
        bentry.0.push(fname);
        bentry.1 += size;
    }

    mmproj_paths.sort();
    let mmproj = mmproj_paths
        .first()
        .map(|p| p.to_string_lossy().to_string());

    for (base_name, (mut file_list, total_size)) in bundles {
        file_list.sort();
        // Skip incomplete split bundles.
        if let Some(caps) = of_re.captures(&file_list[0]) {
            let expected: usize = caps[1].parse().unwrap_or(0);
            if file_list.len() < expected {
                continue;
            }
        }
        let first_path = dir.join(&file_list[0]);
        let display_name = if file_list.len() > 1 {
            format!("{base_name} ({} parts)", file_list.len())
        } else {
            base_name.clone()
        };
        models.push(LocalModel {
            name: display_name,
            filename: file_list[0].clone(),
            path: first_path.to_string_lossy().to_string(),
            size: total_size,
            mmproj: mmproj.clone(),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "llama-panel-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn is_mmproj_name_matches_the_filename_only() {
        assert!(is_mmproj_name("mmproj-model-f16.gguf"));
        assert!(is_mmproj_name("MMPROJ-foo.gguf"));
        assert!(is_mmproj_name("snapshots/abc/mmproj-q8.gguf"));
        assert!(is_mmproj_name("some-mmproj-extra.gguf"));
        assert!(!is_mmproj_name("models/mmproj/qwen.gguf"));
        assert!(!is_mmproj_name("qwen2.5-7b-q4_k_m.gguf"));
        assert!(!is_mmproj_name(""));
    }

    #[test]
    fn collect_model_dirs_keeps_existing_unique_directories() {
        let root = scratch("dirs");
        let a = root.join("a");
        let b = root.join("b");
        let file = root.join("file.gguf");
        let missing = root.join("missing");
        std::fs::create_dir_all(&a).unwrap();
        std::fs::create_dir_all(&b).unwrap();
        std::fs::write(&file, b"x").unwrap();

        let dotted = a.join(".");
        let dirs = collect_model_dirs([
            Some(a.as_os_str()),
            Some(missing.as_os_str()),
            Some(file.as_os_str()),
            Some(dotted.as_os_str()),
            Some(b.as_os_str()),
            None,
        ]);

        let canon_a = std::fs::canonicalize(&a).unwrap();
        let canon_b = std::fs::canonicalize(&b).unwrap();
        assert_eq!(dirs, vec![canon_a, canon_b]);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn scan_loose_gguf_dir_groups_splits_and_skips_projectors() {
        let root = scratch("scan");
        std::fs::write(root.join("model-00001-of-00002.gguf"), [0u8; 4]).unwrap();
        std::fs::write(root.join("model-00002-of-00002.gguf"), [0u8; 6]).unwrap();
        std::fs::write(root.join("mmproj-model.gguf"), [0u8; 3]).unwrap();
        std::fs::write(root.join("solo.gguf"), [0u8; 2]).unwrap();
        std::fs::write(root.join("partial-00001-of-00002.gguf"), [0u8; 1]).unwrap();
        std::fs::write(root.join("notes.txt"), b"no").unwrap();

        let mut models = Vec::new();
        scan_loose_gguf_dir(&root, &mut models);
        models.sort_by(|left, right| left.filename.cmp(&right.filename));

        assert_eq!(models.len(), 2);
        assert_eq!(models[0].filename, "model-00001-of-00002.gguf");
        assert_eq!(models[0].size, 10);
        assert!(models[0].name.contains("2 parts"));
        let mmproj = models[0].mmproj.as_deref().unwrap();
        assert!(mmproj.ends_with("mmproj-model.gguf"));
        assert_eq!(models[1].filename, "solo.gguf");
        assert_eq!(models[1].size, 2);
        assert!(models[1]
            .mmproj
            .as_deref()
            .unwrap()
            .ends_with("mmproj-model.gguf"));
        let _ = std::fs::remove_dir_all(&root);
    }
}
