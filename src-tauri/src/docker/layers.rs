use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::io::{Cursor, Read, Write};
use std::path::PathBuf;
use std::sync::Mutex;

use bollard::Docker;
use flate2::read::GzDecoder;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tar::Archive;
use tauri::State;

use super::shared::{docker, map_err};

#[derive(Clone, Serialize)]
pub struct ImageHistoryRow {
    pub created_by: String,
    pub size: i64,
    pub created: i64,
    pub empty: bool,
    pub id: Option<String>,
    pub comment: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct LayerChange {
    pub path: String,
    pub kind: String,
    pub size: i64,
}

#[derive(Clone, Serialize)]
pub struct LayerDiff {
    pub changes: Vec<LayerChange>,
}

#[derive(Clone, Serialize)]
pub struct ImageLayerDiffs {
    pub layers: Vec<LayerDiff>,
    pub note: Option<String>,
}

struct CachedImageLayers {
    diffs: ImageLayerDiffs,
    blobs: Vec<LayerBlob>,
}

#[derive(Default)]
pub struct LayerDiffCache {
    inner: Mutex<HashMap<String, CachedImageLayers>>,
}

#[derive(Clone, Serialize)]
pub struct LayerFilePreview {
    pub path: String,
    pub kind: String,
    pub size: u64,
    pub text: Option<String>,
    pub truncated: bool,
}

const PREVIEW_MAX_BYTES: u64 = 256 * 1024;

fn rootfs_layer_count(inspect: &bollard::models::ImageInspect) -> usize {
    inspect
        .root_fs
        .as_ref()
        .and_then(|root| root.layers.as_ref())
        .map(Vec::len)
        .unwrap_or(0)
}

fn optional_history_text(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed == "<missing>" {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn mark_history_empty(sizes: &[i64], rootfs_layers: usize) -> (Vec<bool>, Option<String>) {
    let n = sizes.len();
    let zero = sizes.iter().filter(|size| **size == 0).count();
    let nonzero = n - zero;
    if n == rootfs_layers {
        (vec![false; n], None)
    } else if nonzero == rootfs_layers {
        (sizes.iter().map(|size| *size == 0).collect(), None)
    } else {
        (
            sizes.iter().map(|size| *size == 0).collect(),
            Some(format!(
                "Could not align history ({n} steps, {nonzero} with size) to {rootfs_layers} RootFS layers; diffs attached by layer index."
            )),
        )
    }
}

fn history_rows(
    history: Vec<bollard::models::ImageHistoryResponseItem>,
    layer_count: usize,
) -> Vec<ImageHistoryRow> {
    let sizes: Vec<i64> = history.iter().map(|row| row.size).collect();
    let (empties, _) = mark_history_empty(&sizes, layer_count);
    history
        .into_iter()
        .zip(empties)
        .map(|(row, empty)| ImageHistoryRow {
            created_by: row.created_by,
            size: row.size,
            created: row.created,
            empty,
            id: optional_history_text(&row.id),
            comment: optional_history_text(&row.comment),
        })
        .collect()
}

fn is_gzip(bytes: &[u8]) -> bool {
    bytes.len() >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b
}

fn layer_name_is_gzip(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".tar.gz") || lower.ends_with(".tgz")
}

fn layer_media_is_gzip(media: &str) -> bool {
    let lower = media.to_ascii_lowercase();
    lower.contains("gzip")
}

fn layer_blob_is_gzip(bytes: &[u8], name: &str, media: Option<&str>) -> bool {
    is_gzip(bytes) || layer_name_is_gzip(name) || media.is_some_and(layer_media_is_gzip)
}

fn decode_gzip_layer(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut decoder = GzDecoder::new(bytes);
    let mut out = Vec::new();
    decoder
        .read_to_end(&mut out)
        .map_err(|err| format!("Failed to decode gzip layer: {err}"))?;
    Ok(out)
}

fn archive_path(raw: &str) -> String {
    let normalized = raw.replace('\\', "/");
    let mut parts = Vec::new();
    for part in normalized.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            parts.pop();
            continue;
        }
        parts.push(part);
    }
    parts.join("/")
}

fn resolve_relative(from: &str, target: &str) -> String {
    let target = target.replace('\\', "/");
    if target.is_empty() {
        return archive_path(from);
    }
    if target.starts_with('/') {
        return archive_path(&target);
    }
    let from_dir = from.rsplit_once('/').map(|(dir, _)| dir).unwrap_or("");
    if from_dir.is_empty() {
        archive_path(&target)
    } else {
        archive_path(&format!("{from_dir}/{target}"))
    }
}

fn normalize_layer_path(raw: &str) -> Option<String> {
    let path = archive_path(raw);
    if path.is_empty() {
        None
    } else {
        Some(format!("/{path}"))
    }
}

enum Whiteout {
    Deleted(String),
    Opaque(String),
}

fn parent_layer_path(path: &str) -> String {
    match path.rsplit_once('/') {
        Some(("", _)) | None => "/".into(),
        Some((parent, _)) if parent.is_empty() => "/".into(),
        Some((parent, _)) => parent.to_string(),
    }
}

fn classify_whiteout(path: &str) -> Option<Whiteout> {
    let name = path.rsplit('/').next().unwrap_or(path);
    if name == ".wh..wh..opq" {
        return Some(Whiteout::Opaque(parent_layer_path(path)));
    }
    let rest = name.strip_prefix(".wh.")?;
    if rest.is_empty() {
        return None;
    }
    let parent = parent_layer_path(path);
    let target = if parent == "/" {
        format!("/{rest}")
    } else {
        format!("{parent}/{rest}")
    };
    Some(Whiteout::Deleted(target))
}

fn paths_prefixed(seen: &HashSet<String>, path: &str, include_self: bool) -> Vec<String> {
    if path == "/" {
        return seen.iter().cloned().collect();
    }
    let prefix = format!("{path}/");
    seen.iter()
        .filter(|existing| (include_self && *existing == path) || existing.starts_with(&prefix))
        .cloned()
        .collect()
}

#[cfg(test)]
fn parse_layer_changes(bytes: &[u8], seen: &mut HashSet<String>) -> Result<Vec<LayerChange>, String> {
    parse_layer_changes_named(bytes, "", None, seen)
}

fn parse_layer_changes_named(
    bytes: &[u8],
    name: &str,
    media: Option<&str>,
    seen: &mut HashSet<String>,
) -> Result<Vec<LayerChange>, String> {
    if bytes.is_empty() {
        return Ok(Vec::new());
    }
    if layer_blob_is_gzip(bytes, name, media) {
        let decoded = decode_gzip_layer(bytes)?;
        return parse_uncompressed_layer(&decoded, seen);
    }
    parse_uncompressed_layer(bytes, seen)
}

fn parse_uncompressed_layer(
    bytes: &[u8],
    seen: &mut HashSet<String>,
) -> Result<Vec<LayerChange>, String> {
    let mut archive = Archive::new(Cursor::new(bytes));
    let mut whiteouts = Vec::new();
    let mut present = Vec::new();

    for entry in archive.entries().map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let header = entry.header();
        let ty = header.entry_type();
        if ty.is_pax_global_extensions()
            || ty.is_pax_local_extensions()
            || ty.is_gnu_longname()
            || ty.is_gnu_longlink()
        {
            continue;
        }
        let path = header.path().map_err(|err| err.to_string())?;
        let Some(path) = normalize_layer_path(&path.to_string_lossy()) else {
            continue;
        };
        if let Some(whiteout) = classify_whiteout(&path) {
            whiteouts.push(whiteout);
            continue;
        }
        let size = if ty.is_file() {
            header.size().unwrap_or(0) as i64
        } else {
            0
        };
        present.push((path, size));
    }

    let mut by_path = HashMap::new();
    for whiteout in whiteouts {
        match whiteout {
            Whiteout::Opaque(dir) => {
                for path in paths_prefixed(seen, &dir, false) {
                    seen.remove(&path);
                    by_path.insert(
                        path.clone(),
                        LayerChange {
                            path,
                            kind: "deleted".into(),
                            size: 0,
                        },
                    );
                }
            }
            Whiteout::Deleted(path) => {
                for child in paths_prefixed(seen, &path, true) {
                    seen.remove(&child);
                    by_path.insert(
                        child.clone(),
                        LayerChange {
                            path: child,
                            kind: "deleted".into(),
                            size: 0,
                        },
                    );
                }
                by_path.entry(path.clone()).or_insert(LayerChange {
                    path,
                    kind: "deleted".into(),
                    size: 0,
                });
            }
        }
    }

    for (path, size) in present {
        let kind = if seen.contains(&path) {
            "modified"
        } else {
            "added"
        };
        seen.insert(path.clone());
        by_path.insert(
            path.clone(),
            LayerChange {
                path,
                kind: kind.into(),
                size,
            },
        );
    }

    let mut changes: Vec<LayerChange> = by_path.into_values().collect();
    changes.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(changes)
}

fn vec_null_as_empty<'de, D, T>(deserializer: D) -> Result<Vec<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Option::<Vec<T>>::deserialize(deserializer)?.unwrap_or_default())
}

#[derive(Deserialize)]
struct SaveManifest {
    #[serde(default, rename = "RepoTags", deserialize_with = "vec_null_as_empty")]
    repo_tags: Vec<String>,
    #[serde(default, rename = "Layers", deserialize_with = "vec_null_as_empty")]
    layers: Vec<String>,
}

#[derive(Deserialize)]
struct OciDescriptor {
    #[serde(default, rename = "mediaType")]
    media_type: String,
    #[serde(default)]
    digest: String,
}

#[derive(Deserialize)]
struct OciIndex {
    #[serde(default)]
    manifests: Vec<OciDescriptor>,
}

#[derive(Deserialize)]
struct OciManifest {
    #[serde(default)]
    layers: Vec<OciDescriptor>,
}

#[derive(Clone)]
struct LayerBlob {
    name: String,
    media: Option<String>,
    bytes: Vec<u8>,
}

fn digest_to_blob_path(digest: &str) -> Option<String> {
    let (algo, hex) = digest.split_once(':')?;
    if algo.is_empty() || hex.is_empty() {
        return None;
    }
    Some(format!("blobs/{algo}/{hex}"))
}

fn oci_layer_media_types(files: &HashMap<String, Vec<u8>>) -> HashMap<String, String> {
    let mut media = HashMap::new();
    let Some(index_bytes) = files.get("index.json") else {
        return media;
    };
    let Ok(index) = serde_json::from_slice::<OciIndex>(index_bytes) else {
        return media;
    };
    for desc in &index.manifests {
        let Some(path) = digest_to_blob_path(&desc.digest) else {
            continue;
        };
        let Some(bytes) = files.get(&path) else {
            continue;
        };
        let Ok(manifest) = serde_json::from_slice::<OciManifest>(bytes) else {
            continue;
        };
        for layer in manifest.layers {
            if let Some(layer_path) = digest_to_blob_path(&layer.digest) {
                if !layer.media_type.is_empty() {
                    media.insert(layer_path, layer.media_type);
                }
            }
        }
    }
    media
}

fn pick_manifest<'a>(
    manifests: &'a [SaveManifest],
    tags: &[String],
) -> Result<&'a SaveManifest, String> {
    manifests
        .iter()
        .find(|manifest| {
            manifest
                .repo_tags
                .iter()
                .any(|tag| tags.iter().any(|wanted| wanted == tag))
        })
        .or_else(|| manifests.first())
        .ok_or_else(|| "Image export manifest.json is empty".into())
}

fn resolve_archive_file(
    files: &HashMap<String, Vec<u8>>,
    links: &HashMap<String, String>,
    path: &str,
) -> Result<Vec<u8>, String> {
    let mut current = archive_path(path);
    let mut hops = 0;
    loop {
        if let Some(bytes) = files.get(&current) {
            return Ok(bytes.clone());
        }
        if let Some(target) = links.get(&current) {
            hops += 1;
            if hops > 16 {
                return Err(format!("Too many links for layer {path}"));
            }
            current = target.clone();
            continue;
        }
        return Err(format!("Image export is missing layer {path}"));
    }
}

fn parse_save_archive(reader: impl Read, repo_tags: &[String]) -> Result<Vec<LayerBlob>, String> {
    let mut archive = Archive::new(reader);
    let mut files = HashMap::new();
    let mut links = HashMap::new();
    let mut manifest_bytes = None;

    for entry in archive.entries().map_err(|err| err.to_string())? {
        let mut entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path().map_err(|err| err.to_string())?;
        let key = archive_path(&path.to_string_lossy());
        if key.is_empty() {
            continue;
        }
        let ty = entry.header().entry_type();
        let link_target = entry
            .link_name()
            .map_err(|err| err.to_string())?
            .or_else(|| entry.header().link_name().ok().flatten());
        if let Some(target) = link_target {
            if ty.is_symlink() || ty.is_hard_link() || !ty.is_file() {
                let target = target.to_string_lossy();
                let resolved = if ty.is_hard_link() {
                    archive_path(&target)
                } else {
                    resolve_relative(&key, &target)
                };
                links.insert(key, resolved);
                continue;
            }
        }
        if ty.is_dir()
            || ty.is_pax_global_extensions()
            || ty.is_pax_local_extensions()
            || ty.is_gnu_longname()
            || ty.is_gnu_longlink()
        {
            continue;
        }
        let mut data = Vec::new();
        entry.read_to_end(&mut data).map_err(|err| err.to_string())?;
        if key == "manifest.json" {
            manifest_bytes = Some(data);
        } else {
            files.insert(key, data);
        }
    }

    let manifest_bytes =
        manifest_bytes.ok_or_else(|| "Image export has no manifest.json".to_string())?;
    let manifests: Vec<SaveManifest> =
        serde_json::from_slice(&manifest_bytes).map_err(|err| err.to_string())?;
    let manifest = pick_manifest(&manifests, repo_tags)?;
    let media_by_path = oci_layer_media_types(&files);
    manifest
        .layers
        .iter()
        .map(|layer| {
            let bytes = resolve_archive_file(&files, &links, layer)?;
            let path = archive_path(layer);
            let media = media_by_path.get(&path).cloned();
            Ok(LayerBlob {
                name: path,
                media,
                bytes,
            })
        })
        .collect()
}

struct TempExport {
    path: PathBuf,
}

impl Drop for TempExport {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

async fn export_image_temp(docker: &Docker, id: &str) -> Result<TempExport, String> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let path = std::env::temp_dir().join(format!(
        "dockman-export-{}-{stamp}.tar",
        std::process::id()
    ));
    let mut file = std::fs::File::create(&path).map_err(|err| err.to_string())?;
    let mut stream = docker.export_image(id);
    while let Some(chunk) = stream.next().await {
        file.write_all(&chunk.map_err(map_err)?)
            .map_err(|err| err.to_string())?;
    }
    file.flush().map_err(|err| err.to_string())?;
    Ok(TempExport { path })
}

fn align_layer_diffs(
    empties: &[bool],
    oldest_first: Vec<Vec<LayerChange>>,
    note: Option<String>,
) -> ImageLayerDiffs {
    let mut newest_first = oldest_first;
    newest_first.reverse();
    let layers = if note.is_some() {
        newest_first
            .into_iter()
            .map(|changes| LayerDiff { changes })
            .collect()
    } else {
        let n = empties.iter().filter(|empty| !*empty).count();
        (0..n)
            .map(|i| LayerDiff {
                changes: newest_first.get(i).cloned().unwrap_or_default(),
            })
            .collect()
    };
    ImageLayerDiffs { layers, note }
}

fn align_layer_blobs(
    empties: &[bool],
    oldest_first: Vec<LayerBlob>,
    note: Option<&str>,
) -> Vec<LayerBlob> {
    let mut newest_first = oldest_first;
    newest_first.reverse();
    if note.is_some() {
        newest_first
    } else {
        let n = empties.iter().filter(|empty| !*empty).count();
        newest_first.into_iter().take(n).collect()
    }
}

fn layer_tar_bytes(blob: &LayerBlob) -> Result<Cow<'_, [u8]>, String> {
    if blob.bytes.is_empty() {
        return Ok(Cow::Borrowed(&[]));
    }
    if layer_blob_is_gzip(&blob.bytes, &blob.name, blob.media.as_deref()) {
        Ok(Cow::Owned(decode_gzip_layer(&blob.bytes)?))
    } else {
        Ok(Cow::Borrowed(&blob.bytes))
    }
}

fn read_file_from_layer_tar(blob: &LayerBlob, path: &str) -> Result<(u64, Vec<u8>), String> {
    let tar_bytes = layer_tar_bytes(blob)?;
    let mut archive = Archive::new(Cursor::new(tar_bytes.as_ref()));
    let mut deleted = false;

    for entry in archive.entries().map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let ty = entry.header().entry_type();
        if ty.is_pax_global_extensions()
            || ty.is_pax_local_extensions()
            || ty.is_gnu_longname()
            || ty.is_gnu_longlink()
        {
            continue;
        }
        let raw = entry.path().map_err(|err| err.to_string())?;
        let Some(entry_path) = normalize_layer_path(&raw.to_string_lossy()) else {
            continue;
        };
        if let Some(whiteout) = classify_whiteout(&entry_path) {
            match whiteout {
                Whiteout::Deleted(target)
                    if target == path || path.starts_with(&format!("{target}/")) =>
                {
                    deleted = true;
                }
                Whiteout::Opaque(dir)
                    if path != dir && (dir == "/" || path.starts_with(&format!("{dir}/"))) =>
                {
                    deleted = true;
                }
                _ => {}
            }
            continue;
        }
        if entry_path != path {
            continue;
        }
        if !ty.is_file() {
            return Err(format!("Not a file: {path}"));
        }
        let size = entry.header().size().unwrap_or(0);
        let mut data = Vec::new();
        entry
            .take(PREVIEW_MAX_BYTES)
            .read_to_end(&mut data)
            .map_err(|err| err.to_string())?;
        return Ok((size, data));
    }

    if deleted {
        return Err(format!("File was deleted: {path}"));
    }
    Err(format!("File not found: {path}"))
}

fn looks_text(bytes: &[u8]) -> bool {
    if bytes.contains(&0) {
        return false;
    }
    match std::str::from_utf8(bytes) {
        Ok(_) => true,
        Err(err) => err.error_len().is_none() && err.valid_up_to() > 0,
    }
}

fn decode_text_preview(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_string(),
        Err(err) if err.error_len().is_none() => {
            String::from_utf8_lossy(&bytes[..err.valid_up_to()]).into_owned()
        }
        Err(_) => String::new(),
    }
}

fn layer_file_preview(path: String, size: u64, data: Vec<u8>) -> LayerFilePreview {
    let truncated = size > PREVIEW_MAX_BYTES;
    let bytes = if data.len() as u64 > PREVIEW_MAX_BYTES {
        &data[..PREVIEW_MAX_BYTES as usize]
    } else {
        &data
    };
    if looks_text(bytes) {
        LayerFilePreview {
            path,
            kind: "text".into(),
            size,
            text: Some(decode_text_preview(bytes)),
            truncated,
        }
    } else {
        LayerFilePreview {
            path,
            kind: "binary".into(),
            size,
            text: None,
            truncated,
        }
    }
}

fn blob_for_layer_path(
    cached: &CachedImageLayers,
    layer_index: usize,
    path: &str,
) -> Result<LayerBlob, String> {
    if layer_index >= cached.blobs.len() {
        return Err("Layer not found".into());
    }
    for index in layer_index..cached.diffs.layers.len() {
        let Some(change) = cached.diffs.layers[index]
            .changes
            .iter()
            .find(|change| change.path == path)
        else {
            continue;
        };
        if change.kind == "deleted" {
            return Err(if index == layer_index {
                format!("File was deleted: {path}")
            } else {
                format!("File not found: {path}")
            });
        }
        return cached
            .blobs
            .get(index)
            .cloned()
            .ok_or_else(|| "Layer not found".into());
    }
    cached
        .blobs
        .get(layer_index)
        .cloned()
        .ok_or_else(|| "Layer not found".into())
}

async fn cached_or_load_layers(cache: &LayerDiffCache, id: &str) -> Result<String, String> {
    let docker = docker()?;
    let inspect = docker.inspect_image(id).await.map_err(map_err)?;
    let image_id = inspect
        .id
        .clone()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| id.to_string());
    {
        let guard = cache.inner.lock().map_err(|err| err.to_string())?;
        if guard.contains_key(&image_id) {
            return Ok(image_id);
        }
    }

    let history = docker.image_history(id).await.map_err(map_err)?;
    let layer_count = rootfs_layer_count(&inspect);
    let sizes: Vec<i64> = history.iter().map(|row| row.size).collect();
    let (empties, note) = mark_history_empty(&sizes, layer_count);
    let repo_tags = inspect.repo_tags.unwrap_or_default();

    let temp = export_image_temp(&docker, id).await?;
    let file = std::fs::File::open(&temp.path).map_err(|err| err.to_string())?;
    let layer_blobs = parse_save_archive(file, &repo_tags)?;
    drop(temp);

    let mut seen = HashSet::new();
    let mut oldest_first = Vec::with_capacity(layer_blobs.len());
    for blob in &layer_blobs {
        oldest_first.push(parse_layer_changes_named(
            &blob.bytes,
            &blob.name,
            blob.media.as_deref(),
            &mut seen,
        )?);
    }
    let diffs = align_layer_diffs(&empties, oldest_first, note.clone());
    let blobs = align_layer_blobs(&empties, layer_blobs, note.as_deref());
    {
        let mut guard = cache.inner.lock().map_err(|err| err.to_string())?;
        guard.insert(image_id.clone(), CachedImageLayers { diffs, blobs });
    }
    Ok(image_id)
}

#[tauri::command]
pub async fn image_history(id: String) -> Result<Vec<ImageHistoryRow>, String> {
    let id = id.trim().to_string();
    if id.is_empty() {
        return Err("Image is required".into());
    }
    let docker = docker()?;
    let history = docker.image_history(&id).await.map_err(map_err)?;
    let layer_count = match docker.inspect_image(&id).await {
        Ok(inspect) => rootfs_layer_count(&inspect),
        Err(_) => history.iter().filter(|row| row.size > 0).count(),
    };
    Ok(history_rows(history, layer_count))
}

#[tauri::command]
pub async fn image_layer_diffs(
    cache: State<'_, LayerDiffCache>,
    id: String,
) -> Result<ImageLayerDiffs, String> {
    let id = id.trim().to_string();
    if id.is_empty() {
        return Err("Image is required".into());
    }
    let image_id = cached_or_load_layers(&cache, &id).await?;
    let guard = cache.inner.lock().map_err(|err| err.to_string())?;
    guard
        .get(&image_id)
        .map(|cached| cached.diffs.clone())
        .ok_or_else(|| "Layer cache missing after load".into())
}

#[tauri::command]
pub async fn image_layer_file(
    cache: State<'_, LayerDiffCache>,
    id: String,
    layer_index: usize,
    path: String,
) -> Result<LayerFilePreview, String> {
    let id = id.trim().to_string();
    if id.is_empty() {
        return Err("Image is required".into());
    }
    let path = normalize_layer_path(&path).ok_or_else(|| "Path is required".to_string())?;
    let image_id = cached_or_load_layers(&cache, &id).await?;
    let blob = {
        let guard = cache.inner.lock().map_err(|err| err.to_string())?;
        let cached = guard
            .get(&image_id)
            .ok_or_else(|| "Layer cache missing after load".to_string())?;
        blob_for_layer_path(cached, layer_index, &path)?
    };
    let (size, data) = read_file_from_layer_tar(&blob, &path)?;
    Ok(layer_file_preview(path, size, data))
}


#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use tar::{Builder, Header};

    use super::{
        align_layer_diffs, classify_whiteout, is_gzip, layer_file_preview, mark_history_empty,
        normalize_layer_path, parse_layer_changes, parse_layer_changes_named, parse_save_archive,
        read_file_from_layer_tar, resolve_relative, LayerBlob, LayerChange, SaveManifest, Whiteout,
        PREVIEW_MAX_BYTES,
    };

    fn layer_tar(entries: &[(&str, Option<&[u8]>)]) -> Vec<u8> {
        let mut builder = Builder::new(Vec::new());
        for (path, data) in entries {
            let mut header = Header::new_gnu();
            if let Some(bytes) = data {
                header.set_size(bytes.len() as u64);
                header.set_mode(0o644);
                header.set_cksum();
                builder.append_data(&mut header, *path, *bytes).unwrap();
            } else {
                header.set_entry_type(tar::EntryType::Directory);
                header.set_size(0);
                header.set_mode(0o755);
                header.set_cksum();
                builder.append_data(&mut header, *path, &[][..]).unwrap();
            }
        }
        builder.into_inner().unwrap()
    }

    #[test]
    fn normalize_layer_path_strips_dot_segments() {
        assert_eq!(normalize_layer_path("./usr/bin/foo"), Some("/usr/bin/foo".into()));
        assert_eq!(normalize_layer_path("usr/bin/foo/"), Some("/usr/bin/foo".into()));
        assert_eq!(normalize_layer_path("."), None);
        assert_eq!(resolve_relative("1/layer.tar", "../0/layer.tar"), "0/layer.tar");
    }

    #[test]
    fn classify_whiteout_reads_delete_and_opaque() {
        match classify_whiteout("/usr/lib/.wh.foo").unwrap() {
            Whiteout::Deleted(path) => assert_eq!(path, "/usr/lib/foo"),
            Whiteout::Opaque(_) => panic!("expected delete whiteout"),
        }
        match classify_whiteout("/usr/lib/.wh..wh..opq").unwrap() {
            Whiteout::Opaque(path) => assert_eq!(path, "/usr/lib"),
            Whiteout::Deleted(_) => panic!("expected opaque whiteout"),
        }
        assert!(classify_whiteout("/usr/lib/foo").is_none());
    }

    #[test]
    fn mark_history_empty_uses_rootfs_count() {
        let (empties, note) = mark_history_empty(&[0, 12, 0, 8], 2);
        assert_eq!(empties, vec![true, false, true, false]);
        assert!(note.is_none());

        let (empties, note) = mark_history_empty(&[0, 0], 2);
        assert_eq!(empties, vec![false, false]);
        assert!(note.is_none());

        let (empties, note) = mark_history_empty(&[0, 12, 0], 2);
        assert_eq!(empties, vec![true, false, true]);
        assert!(note.is_some());
    }

    #[test]
    fn parse_layer_changes_marks_add_modify_and_delete() {
        let first = layer_tar(&[
            ("usr", None),
            ("usr/bin", None),
            ("usr/bin/app", Some(b"v1")),
            ("etc/keep", Some(b"ok")),
        ]);
        let second = layer_tar(&[
            ("usr/bin/app", Some(b"v2")),
            ("usr/bin/.wh.old", Some(b"")),
            ("etc/.wh..wh..opq", Some(b"")),
            ("etc/new", Some(b"n")),
        ]);
        let mut seen = HashSet::new();
        let added = parse_layer_changes(&first, &mut seen).unwrap();
        assert!(added.iter().any(|change| change.path == "/usr/bin/app" && change.kind == "added"));
        let next = parse_layer_changes(&second, &mut seen).unwrap();
        assert!(next.iter().any(|change| change.path == "/usr/bin/app" && change.kind == "modified"));
        assert!(next.iter().any(|change| change.path == "/usr/bin/old" && change.kind == "deleted"));
        assert!(next.iter().any(|change| change.path == "/etc/keep" && change.kind == "deleted"));
        assert!(next.iter().any(|change| change.path == "/etc/new" && change.kind == "added"));
    }

    #[test]
    fn parse_save_archive_follows_layer_symlinks() {
        let layer = layer_tar(&[("hello", Some(b"hi"))]);
        let manifest = serde_json::json!([{
            "Config": "config.json",
            "RepoTags": ["demo:latest"],
            "Layers": ["0/layer.tar", "1/layer.tar"]
        }]);
        let mut builder = Builder::new(Vec::new());
        let mut header = Header::new_gnu();
        header.set_size(2);
        header.set_cksum();
        builder.append_data(&mut header, "config.json", b"{}" as &[u8]).unwrap();
        let encoded = serde_json::to_vec(&manifest).unwrap();
        header = Header::new_gnu();
        header.set_size(encoded.len() as u64);
        header.set_cksum();
        builder.append_data(&mut header, "manifest.json", encoded.as_slice()).unwrap();
        header = Header::new_gnu();
        header.set_size(layer.len() as u64);
        header.set_cksum();
        builder.append_data(&mut header, "0/layer.tar", layer.as_slice()).unwrap();
        header = Header::new_gnu();
        header.set_entry_type(tar::EntryType::Symlink);
        header.set_size(0);
        header.set_path("1/layer.tar").unwrap();
        header.set_link_name("../0/layer.tar").unwrap();
        header.set_cksum();
        builder.append(&header, std::io::empty()).unwrap();
        let buf = builder.into_inner().unwrap();
        let layers = parse_save_archive(buf.as_slice(), &["demo:latest".into()]).unwrap();
        assert_eq!(layers.len(), 2);
        assert_eq!(layers[0].bytes, layer);
        assert_eq!(layers[1].bytes, layer);
    }

    #[test]
    fn save_manifest_treats_null_arrays_as_empty() {
        let manifests: Vec<SaveManifest> = serde_json::from_str(
            r#"[{"Config":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json","RepoTags":[],"Layers":null}]"#,
        )
        .unwrap();
        assert!(manifests[0].repo_tags.is_empty());
        assert!(manifests[0].layers.is_empty());

        let manifests: Vec<SaveManifest> = serde_json::from_str(
            r#"[{"Config":"config.json","RepoTags":null,"Layers":["0/layer.tar"]}]"#,
        )
        .unwrap();
        assert!(manifests[0].repo_tags.is_empty());
        assert_eq!(manifests[0].layers, ["0/layer.tar"]);
    }

    fn gzip_layer(plain: &[u8]) -> Vec<u8> {
        use flate2::write::GzEncoder;
        use flate2::Compression;
        use std::io::Write;
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(plain).unwrap();
        encoder.finish().unwrap()
    }

    fn save_archive_with_layer(layer_name: &str, layer: &[u8]) -> Vec<u8> {
        let manifest = serde_json::json!([{
            "Config": "config.json",
            "RepoTags": ["demo:latest"],
            "Layers": [layer_name]
        }]);
        let mut builder = Builder::new(Vec::new());
        let mut header = Header::new_gnu();
        header.set_size(2);
        header.set_cksum();
        builder
            .append_data(&mut header, "config.json", b"{}" as &[u8])
            .unwrap();
        let encoded = serde_json::to_vec(&manifest).unwrap();
        header = Header::new_gnu();
        header.set_size(encoded.len() as u64);
        header.set_cksum();
        builder
            .append_data(&mut header, "manifest.json", encoded.as_slice())
            .unwrap();
        header = Header::new_gnu();
        header.set_size(layer.len() as u64);
        header.set_cksum();
        builder
            .append_data(&mut header, layer_name, layer)
            .unwrap();
        builder.into_inner().unwrap()
    }

    #[test]
    fn gzip_layer_in_save_archive_matches_uncompressed() {
        let entries = &[
            ("usr", None),
            ("usr/bin", None),
            ("usr/bin/app", Some(&b"hello"[..])),
        ];
        let plain = layer_tar(entries);
        let gzipped = gzip_layer(&plain);
        assert!(is_gzip(&gzipped));

        let plain_archive = save_archive_with_layer("0/layer.tar", &plain);
        let gzip_named = save_archive_with_layer("0/layer.tar.gz", &gzipped);
        let gzip_magic = save_archive_with_layer("0/layer.tar", &gzipped);

        let expected = {
            let blobs =
                parse_save_archive(plain_archive.as_slice(), &["demo:latest".into()]).unwrap();
            let mut seen = HashSet::new();
            parse_layer_changes(&blobs[0].bytes, &mut seen).unwrap()
        };

        for archive in [gzip_named, gzip_magic] {
            let blobs = parse_save_archive(archive.as_slice(), &["demo:latest".into()]).unwrap();
            let mut seen = HashSet::new();
            let actual = parse_layer_changes_named(
                &blobs[0].bytes,
                &blobs[0].name,
                blobs[0].media.as_deref(),
                &mut seen,
            )
            .unwrap();
            assert_eq!(actual, expected);
        }
    }

    #[test]
    fn parse_save_archive_accepts_null_repo_tags() {
        let layer = layer_tar(&[("hello", Some(b"hi"))]);
        let manifest = serde_json::json!([{
            "Config": "config.json",
            "RepoTags": null,
            "Layers": ["0/layer.tar"]
        }]);
        let mut builder = Builder::new(Vec::new());
        let encoded = serde_json::to_vec(&manifest).unwrap();
        let mut header = Header::new_gnu();
        header.set_size(encoded.len() as u64);
        header.set_cksum();
        builder.append_data(&mut header, "manifest.json", encoded.as_slice()).unwrap();
        header = Header::new_gnu();
        header.set_size(layer.len() as u64);
        header.set_cksum();
        builder.append_data(&mut header, "0/layer.tar", layer.as_slice()).unwrap();
        let buf = builder.into_inner().unwrap();
        let layers = parse_save_archive(buf.as_slice(), &["demo:latest".into()]).unwrap();
        assert_eq!(layers.len(), 1);
        assert_eq!(layers[0].bytes, layer);
    }

    #[test]
    fn align_layer_diffs_reverses_to_history_order() {
        let older = vec![LayerChange {
            path: "/old".into(),
            kind: "added".into(),
            size: 1,
        }];
        let newer = vec![LayerChange {
            path: "/new".into(),
            kind: "added".into(),
            size: 2,
        }];
        let aligned = align_layer_diffs(&[true, false, false], vec![older, newer], None);
        assert_eq!(aligned.layers.len(), 2);
        assert_eq!(aligned.layers[0].changes[0].path, "/new");
        assert_eq!(aligned.layers[1].changes[0].path, "/old");
        assert!(aligned.note.is_none());
    }

    #[test]
    fn read_file_from_layer_tar_reads_text_and_whiteout() {
        let blob = LayerBlob {
            name: "0/layer.tar".into(),
            media: None,
            bytes: layer_tar(&[
                ("usr/bin/app", Some(b"hello")),
                ("usr/bin/.wh.old", Some(b"")),
            ]),
        };
        let (size, data) = read_file_from_layer_tar(&blob, "/usr/bin/app").unwrap();
        assert_eq!(size, 5);
        assert_eq!(data, b"hello");
        assert!(
            read_file_from_layer_tar(&blob, "/usr/bin/old")
                .unwrap_err()
                .contains("deleted")
        );
        assert!(
            read_file_from_layer_tar(&blob, "/missing")
                .unwrap_err()
                .contains("not found")
        );
    }

    #[test]
    fn read_file_from_gzip_layer_tar() {
        let plain = layer_tar(&[("hello.txt", Some(b"hi"))]);
        let blob = LayerBlob {
            name: "0/layer.tar.gz".into(),
            media: None,
            bytes: gzip_layer(&plain),
        };
        let (_, data) = read_file_from_layer_tar(&blob, "/hello.txt").unwrap();
        assert_eq!(data, b"hi");
    }

    #[test]
    fn layer_file_preview_marks_truncated_and_rejects_binary() {
        let text = layer_file_preview("/a".into(), PREVIEW_MAX_BYTES + 1, b"hello".to_vec());
        assert!(text.truncated);
        assert_eq!(text.kind, "text");
        assert_eq!(text.text.as_deref(), Some("hello"));

        let bin = layer_file_preview("/b".into(), 4, vec![0, 1, 2, 3]);
        assert_eq!(bin.kind, "binary");
        assert!(bin.text.is_none());

        let invalid = layer_file_preview("/c".into(), 3, vec![0xff, 0xfe, 0xfd]);
        assert_eq!(invalid.kind, "binary");
        assert!(invalid.text.is_none());
    }

    #[test]
    fn read_file_from_layer_tar_caps_preview_bytes() {
        let big = vec![b'a'; (PREVIEW_MAX_BYTES as usize) + 64];
        let blob = LayerBlob {
            name: "0/layer.tar".into(),
            media: None,
            bytes: layer_tar(&[("big.txt", Some(big.as_slice()))]),
        };
        let (size, data) = read_file_from_layer_tar(&blob, "/big.txt").unwrap();
        assert_eq!(size, big.len() as u64);
        assert_eq!(data.len(), PREVIEW_MAX_BYTES as usize);
        let preview = layer_file_preview("/big.txt".into(), size, data);
        assert!(preview.truncated);
        assert_eq!(
            preview.text.as_ref().map(String::len),
            Some(PREVIEW_MAX_BYTES as usize)
        );
    }

}
