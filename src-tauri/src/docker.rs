use std::collections::HashMap;
use std::io::{Cursor, Read};
use std::sync::Mutex;

use bollard::models::{
    ContainerCreateBody, HostConfig, NetworkCreateRequest, PortBinding, VolumeCreateRequest,
};
use bollard::query_parameters::{
    ContainerArchiveInfoOptionsBuilder, CreateContainerOptionsBuilder, CreateImageOptionsBuilder,
    DownloadFromContainerOptionsBuilder, InspectNetworkOptionsBuilder, ListContainersOptionsBuilder,
    ListImagesOptionsBuilder, ListNetworksOptionsBuilder, ListVolumesOptionsBuilder,
    LogsOptionsBuilder, RemoveContainerOptionsBuilder, RemoveImageOptionsBuilder,
    RemoveVolumeOptionsBuilder, RestartContainerOptionsBuilder, SearchImagesOptionsBuilder,
    StartContainerOptions, StopContainerOptionsBuilder,
};
use bollard::Docker;
use futures_util::future::{AbortHandle, Abortable};
use futures_util::StreamExt;
use serde::Serialize;
use tar::Archive;
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct LogHub {
    tasks: Mutex<HashMap<String, AbortHandle>>,
}

#[derive(Serialize)]
pub struct EngineInfo {
    pub name: String,
    pub server_version: String,
    pub operating_system: String,
    pub architecture: String,
    pub ncpu: i64,
    pub mem_total: i64,
    pub containers: i64,
    pub containers_running: i64,
    pub containers_paused: i64,
    pub containers_stopped: i64,
    pub images: i64,
}

#[derive(Serialize)]
pub struct ContainerRow {
    pub id: String,
    pub name: String,
    pub image: String,
    pub status: String,
    pub state: String,
    pub ports: Vec<String>,
    pub created: i64,
}

#[derive(Clone, Serialize)]
pub struct UsageRef {
    pub name: String,
    pub state: String,
}

#[derive(Serialize)]
pub struct ImageRow {
    pub id: String,
    pub tags: Vec<String>,
    pub size: i64,
    pub created: i64,
    pub used_by: Vec<UsageRef>,
}

#[derive(Serialize)]
pub struct ImageSearchRow {
    pub name: String,
    pub description: String,
    pub official: bool,
    pub stars: i64,
}

#[derive(Serialize)]
pub struct VolumeRow {
    pub name: String,
    pub driver: String,
    pub mountpoint: String,
    pub created_at: Option<String>,
    pub used_by: Vec<UsageRef>,
}

#[derive(Serialize)]
pub struct NetworkRow {
    pub id: String,
    pub name: String,
    pub driver: String,
    pub scope: String,
    pub builtin: bool,
    pub used_by: Vec<UsageRef>,
}

#[derive(Clone, Serialize)]
pub struct LogChunk {
    pub id: String,
    pub line: String,
}

fn docker() -> Result<Docker, String> {
    Docker::connect_with_local_defaults().map_err(map_err)
}

fn container_name(container: &bollard::models::ContainerSummary) -> String {
    container
        .names
        .clone()
        .unwrap_or_default()
        .into_iter()
        .next()
        .unwrap_or_default()
        .trim_start_matches('/')
        .to_string()
}

fn container_state(container: &bollard::models::ContainerSummary) -> String {
    container
        .state
        .map(|state| state.to_string())
        .filter(|state| !state.is_empty())
        .unwrap_or_else(|| "unknown".into())
}

fn usage_rank(state: &str) -> u8 {
    match state {
        "running" => 0,
        "restarting" => 1,
        _ => 2,
    }
}

fn sort_usage(refs: &mut [UsageRef]) {
    refs.sort_by(|a, b| {
        usage_rank(&a.state)
            .cmp(&usage_rank(&b.state))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
}

fn push_unique(map: &mut HashMap<String, Vec<UsageRef>>, key: String, value: &UsageRef) {
    if key.is_empty() || value.name.is_empty() {
        return;
    }
    let entry = map.entry(key).or_default();
    if !entry.iter().any(|existing| existing.name == value.name) {
        entry.push(value.clone());
    }
}

fn used_by_for(map: &HashMap<String, Vec<UsageRef>>, keys: &[&str]) -> Vec<UsageRef> {
    let mut used_by: Vec<UsageRef> = Vec::new();
    for key in keys {
        if let Some(refs) = map.get(*key) {
            for value in refs {
                if !used_by.iter().any(|existing| existing.name == value.name) {
                    used_by.push(value.clone());
                }
            }
        }
    }
    sort_usage(&mut used_by);
    used_by
}

fn image_aliases(id: &str) -> Vec<String> {
    let mut aliases = Vec::new();
    let mut push = |value: &str| {
        if !value.is_empty() && !aliases.iter().any(|existing| existing == value) {
            aliases.push(value.to_string());
        }
    };
    push(id);
    let bare = id.strip_prefix("sha256:").unwrap_or(id);
    push(bare);
    if bare.len() >= 12 {
        push(&bare[..12]);
    }
    aliases
}

struct ResourceUsage {
    volumes: HashMap<String, Vec<UsageRef>>,
    networks: HashMap<String, Vec<UsageRef>>,
    images: HashMap<String, Vec<UsageRef>>,
}

async fn resource_usage(docker: &Docker) -> Result<ResourceUsage, String> {
    let containers = docker
        .list_containers(Some(ListContainersOptionsBuilder::default().all(true).build()))
        .await
        .map_err(map_err)?;

    let mut volumes = HashMap::new();
    let mut networks = HashMap::new();
    let mut images = HashMap::new();

    for container in containers {
        let usage = UsageRef {
            name: container_name(&container),
            state: container_state(&container),
        };
        for mount in container.mounts.unwrap_or_default() {
            if mount.typ.as_deref() == Some("volume") {
                if let Some(volume) = mount.name {
                    push_unique(&mut volumes, volume, &usage);
                }
            }
        }
        if let Some(settings) = container.network_settings {
            for (network_name, endpoint) in settings.networks.unwrap_or_default() {
                push_unique(&mut networks, network_name, &usage);
                if let Some(id) = endpoint.network_id {
                    push_unique(&mut networks, id, &usage);
                }
            }
        }
        for alias in image_aliases(container.image_id.as_deref().unwrap_or_default()) {
            push_unique(&mut images, alias, &usage);
        }
        if let Some(image) = container.image {
            push_unique(&mut images, image, &usage);
        }
    }

    Ok(ResourceUsage {
        volumes,
        networks,
        images,
    })
}

fn map_err(err: impl std::fmt::Display) -> String {
    let text = err.to_string();
    let lower = text.to_lowercase();
    if lower.contains("permission denied") {
        "Docker socket permission denied. Add your user to the docker group, then log out and back in.".into()
    } else if lower.contains("no such file")
        || lower.contains("connection refused")
        || lower.contains("cannot connect")
    {
        "Cannot connect to Docker. Is the engine running?".into()
    } else {
        text
    }
}

#[tauri::command]
pub async fn engine_info() -> Result<EngineInfo, String> {
    let docker = docker()?;
    let info = docker.info().await.map_err(map_err)?;
    Ok(EngineInfo {
        name: info.name.unwrap_or_default(),
        server_version: info.server_version.unwrap_or_default(),
        operating_system: info.operating_system.unwrap_or_default(),
        architecture: info.architecture.unwrap_or_default(),
        ncpu: info.ncpu.unwrap_or(0),
        mem_total: info.mem_total.unwrap_or(0),
        containers: info.containers.unwrap_or(0),
        containers_running: info.containers_running.unwrap_or(0),
        containers_paused: info.containers_paused.unwrap_or(0),
        containers_stopped: info.containers_stopped.unwrap_or(0),
        images: info.images.unwrap_or(0),
    })
}

#[tauri::command]
pub async fn list_containers() -> Result<Vec<ContainerRow>, String> {
    let docker = docker()?;
    let containers = docker
        .list_containers(Some(ListContainersOptionsBuilder::default().all(true).build()))
        .await
        .map_err(map_err)?;

    let mut rows: Vec<ContainerRow> = containers
        .into_iter()
        .map(|c| {
            let name = c
                .names
                .unwrap_or_default()
                .into_iter()
                .next()
                .unwrap_or_default()
                .trim_start_matches('/')
                .to_string();
            let ports = c
                .ports
                .unwrap_or_default()
                .into_iter()
                .map(|p| match (p.public_port, p.ip) {
                    (Some(public), Some(ip)) if !ip.is_empty() => {
                        format!("{ip}:{public}->{}", p.private_port)
                    }
                    (Some(public), _) => format!("{public}->{}", p.private_port),
                    _ => format!("{}", p.private_port),
                })
                .collect();
            ContainerRow {
                id: c.id.unwrap_or_default(),
                name,
                image: c.image.unwrap_or_default(),
                status: c.status.unwrap_or_default(),
                state: c
                    .state
                    .map(|s| s.to_string())
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| "unknown".into()),
                ports,
                created: c.created.unwrap_or(0),
            }
        })
        .collect();
    rows.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(rows)
}

#[tauri::command]
pub async fn container_start(id: String) -> Result<(), String> {
    docker()?
        .start_container(&id, None::<StartContainerOptions>)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn container_stop(id: String) -> Result<(), String> {
    docker()?
        .stop_container(
            &id,
            Some(StopContainerOptionsBuilder::default().t(10).build()),
        )
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn container_restart(id: String) -> Result<(), String> {
    docker()?
        .restart_container(
            &id,
            Some(RestartContainerOptionsBuilder::default().t(10).build()),
        )
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn container_remove(id: String) -> Result<(), String> {
    docker()?
        .remove_container(
            &id,
            Some(
                RemoveContainerOptionsBuilder::default()
                    .force(true)
                    .v(false)
                    .build(),
            ),
        )
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn container_inspect(id: String) -> Result<serde_json::Value, String> {
    let inspect = docker()?
        .inspect_container(&id, None)
        .await
        .map_err(map_err)?;
    serde_json::to_value(inspect).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn container_logs(app: AppHandle, hub: State<'_, LogHub>, id: String) -> Result<(), String> {
    let docker = docker()?;
    let (abort_handle, abort_reg) = AbortHandle::new_pair();
    {
        let mut tasks = hub.tasks.lock().map_err(|e| e.to_string())?;
        if let Some(prev) = tasks.insert(id.clone(), abort_handle) {
            prev.abort();
        }
    }

    let stream_id = id.clone();
    tauri::async_runtime::spawn(async move {
        let options = LogsOptionsBuilder::default()
            .stdout(true)
            .stderr(true)
            .follow(true)
            .tail("200")
            .timestamps(false)
            .build();
        let stream = docker.logs(&stream_id, Some(options));
        let mut stream = Abortable::new(stream, abort_reg);
        while let Some(item) = stream.next().await {
            match item {
                Ok(output) => {
                    let line = output.to_string();
                    let _ = app.emit(
                        "container-logs",
                        LogChunk {
                            id: stream_id.clone(),
                            line,
                        },
                    );
                }
                Err(_) => break,
            }
        }
        let _ = app.emit("container-logs-end", stream_id);
    });

    Ok(())
}

#[tauri::command]
pub async fn container_logs_stop(hub: State<'_, LogHub>, id: String) -> Result<(), String> {
    let mut tasks = hub.tasks.lock().map_err(|e| e.to_string())?;
    if let Some(handle) = tasks.remove(&id) {
        handle.abort();
    }
    Ok(())
}

#[tauri::command]
pub async fn list_images() -> Result<Vec<ImageRow>, String> {
    let docker = docker()?;
    let images = docker
        .list_images(Some(ListImagesOptionsBuilder::default().all(false).build()))
        .await
        .map_err(map_err)?;
    let usage = resource_usage(&docker).await?;

    let mut rows: Vec<ImageRow> = images
        .into_iter()
        .map(|image| {
            let tags: Vec<String> = image
                .repo_tags
                .into_iter()
                .filter(|tag| tag != "<none>:<none>")
                .collect();
            let aliases = image_aliases(&image.id);
            let mut keys: Vec<&str> = aliases.iter().map(String::as_str).collect();
            keys.extend(tags.iter().map(String::as_str));
            let used_by = used_by_for(&usage.images, &keys);
            ImageRow {
                id: image.id,
                tags,
                size: image.size,
                created: image.created,
                used_by,
            }
        })
        .collect();
    rows.sort_by(|a, b| {
        let a_tag = a.tags.first().map(String::as_str).unwrap_or(&a.id);
        let b_tag = b.tags.first().map(String::as_str).unwrap_or(&b.id);
        a_tag
            .to_lowercase()
            .cmp(&b_tag.to_lowercase())
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(rows)
}

#[tauri::command]
pub async fn image_inspect(id: String) -> Result<serde_json::Value, String> {
    let inspect = docker()?.inspect_image(&id).await.map_err(map_err)?;
    serde_json::to_value(inspect).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn image_remove(id: String) -> Result<(), String> {
    docker()?
        .remove_image(
            &id,
            Some(RemoveImageOptionsBuilder::default().force(false).build()),
            None,
        )
        .await
        .map_err(map_err)?;
    Ok(())
}

#[tauri::command]
pub async fn list_volumes() -> Result<Vec<VolumeRow>, String> {
    let docker = docker()?;
    let response = docker
        .list_volumes(Some(ListVolumesOptionsBuilder::default().build()))
        .await
        .map_err(map_err)?;

    let usage = resource_usage(&docker).await?;
    let mut rows: Vec<VolumeRow> = response
        .volumes
        .unwrap_or_default()
        .into_iter()
        .map(|volume| {
            let used_by = used_by_for(&usage.volumes, &[&volume.name]);
            VolumeRow {
                name: volume.name,
                driver: volume.driver,
                mountpoint: volume.mountpoint,
                created_at: volume.created_at.map(|value| value.to_string()),
                used_by,
            }
        })
        .collect();
    rows.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(rows)
}

#[tauri::command]
pub async fn volume_inspect(name: String) -> Result<serde_json::Value, String> {
    let inspect = docker()?.inspect_volume(&name).await.map_err(map_err)?;
    serde_json::to_value(inspect).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn volume_remove(name: String) -> Result<(), String> {
    docker()?
        .remove_volume(
            &name,
            Some(RemoveVolumeOptionsBuilder::default().force(false).build()),
        )
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn list_networks() -> Result<Vec<NetworkRow>, String> {
    let docker = docker()?;
    let networks = docker
        .list_networks(Some(ListNetworksOptionsBuilder::default().build()))
        .await
        .map_err(map_err)?;

    let usage = resource_usage(&docker).await?;
    let mut rows: Vec<NetworkRow> = networks
        .into_iter()
        .map(|network| {
            let name = network.name.unwrap_or_default();
            let id = network.id.unwrap_or_default();
            let used_by = used_by_for(&usage.networks, &[&name, &id]);
            NetworkRow {
                id,
                name: name.clone(),
                driver: network.driver.unwrap_or_default(),
                scope: network.scope.unwrap_or_default(),
                builtin: matches!(name.as_str(), "bridge" | "host" | "none"),
                used_by,
            }
        })
        .collect();
    rows.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(rows)
}

#[tauri::command]
pub async fn network_inspect(id: String) -> Result<serde_json::Value, String> {
    let inspect = docker()?
        .inspect_network(
            &id,
            Some(InspectNetworkOptionsBuilder::default().verbose(true).build()),
        )
        .await
        .map_err(map_err)?;
    serde_json::to_value(inspect).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn network_remove(id: String) -> Result<(), String> {
    docker()?.remove_network(&id).await.map_err(map_err)
}

#[derive(Clone, Serialize)]
pub struct PullChunk {
    pub id: String,
    pub line: String,
}

#[derive(Serialize)]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub size: u64,
}

#[derive(Serialize)]
pub struct FsFile {
    pub path: String,
    pub text: String,
}

const MAX_ARCHIVE_BYTES: usize = 16 * 1024 * 1024;
const MAX_FILE_BYTES: u64 = 256 * 1024;
const ROOT_CANDIDATES: &[&str] = &[
    "app", "bin", "boot", "data", "dev", "etc", "home", "lib", "lib64", "media", "mnt", "opt",
    "proc", "root", "run", "sbin", "srv", "sys", "tmp", "usr", "var",
];

fn normalize_image_ref(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Image reference is required".into());
    }
    if trimmed.contains('@') {
        return Ok(trimmed.to_string());
    }
    if let Some((name, tag)) = trimmed.rsplit_once(':') {
        if !name.is_empty() && !tag.contains('/') {
            return Ok(trimmed.to_string());
        }
    }
    Ok(format!("{trimmed}:latest"))
}

fn parse_port_line(line: &str) -> Result<(String, String), String> {
    let line = line.trim();
    if let Some((host, container)) = line.split_once(':') {
        if host.parse::<u16>().is_err() || container.parse::<u16>().is_err() {
            return Err(format!("Invalid port mapping: {line}"));
        }
        Ok((host.to_string(), container.to_string()))
    } else if line.parse::<u16>().is_ok() {
        Ok((line.to_string(), line.to_string()))
    } else {
        Err(format!("Invalid port mapping: {line}"))
    }
}

fn sanitize_path(path: &str) -> Result<String, String> {
    let path = if path.trim().is_empty() {
        "/"
    } else {
        path.trim()
    };
    if !path.starts_with('/') {
        return Err("Path must be absolute".into());
    }
    let mut parts = Vec::new();
    for part in path.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            return Err("Path cannot contain ..".into());
        }
        if part.contains('\0') {
            return Err("Invalid path".into());
        }
        parts.push(part);
    }
    if parts.is_empty() {
        Ok("/".into())
    } else {
        Ok(format!("/{}", parts.join("/")))
    }
}

fn first_child(entry: &str, requested: &str) -> Option<(String, bool)> {
    let entry = entry.replace('\\', "/");
    let entry = entry.trim_matches('/');
    let req = requested.trim_start_matches('/').trim_end_matches('/');
    let relative = if req.is_empty() {
        entry
    } else if entry == req {
        return None;
    } else if let Some(rest) = entry.strip_prefix(&format!("{req}/")) {
        rest
    } else if !entry.contains('/') {
        entry
    } else {
        return None;
    };
    let mut parts = relative.split('/');
    let child = parts.next().filter(|part| !part.is_empty())?;
    let nested = parts.next().is_some();
    Some((child.to_string(), nested))
}

async fn download_archive(docker: &Docker, id: &str, path: &str) -> Result<Vec<u8>, String> {
    let mut stream = docker.download_from_container(
        id,
        Some(DownloadFromContainerOptionsBuilder::default().path(path).build()),
    );
    let mut buf = Vec::new();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(map_err)?;
        if buf.len().saturating_add(bytes.len()) > MAX_ARCHIVE_BYTES {
            return Err("Path is too large to read in the app. Open a narrower directory.".into());
        }
        buf.extend_from_slice(&bytes);
    }
    Ok(buf)
}

fn list_tar_children(buf: &[u8], requested: &str) -> Result<Vec<FsEntry>, String> {
    let mut archive = Archive::new(Cursor::new(buf));
    let mut by_name: HashMap<String, FsEntry> = HashMap::new();

    for entry in archive.entries().map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let header = entry.header();
        let path = header.path().map_err(|e| e.to_string())?;
        let raw = path.to_string_lossy();
        let Some((name, nested)) = first_child(&raw, requested) else {
            continue;
        };
        let kind = if nested || header.entry_type().is_dir() {
            "dir"
        } else if header.entry_type().is_symlink() {
            "symlink"
        } else {
            "file"
        };
        let child_path = if requested == "/" {
            format!("/{name}")
        } else {
            format!("{requested}/{name}")
        };
        by_name
            .entry(name.clone())
            .and_modify(|existing| {
                if kind == "dir" {
                    existing.kind = "dir".into();
                }
            })
            .or_insert(FsEntry {
                name,
                path: child_path,
                kind: kind.into(),
                size: header.size().unwrap_or(0),
            });
    }

    let mut rows: Vec<FsEntry> = by_name.into_values().collect();
    rows.sort_by(|a, b| {
        (a.kind != "dir")
            .cmp(&(b.kind != "dir"))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(rows)
}

fn read_tar_file(buf: &[u8], requested: &str) -> Result<FsFile, String> {
    let mut archive = Archive::new(Cursor::new(buf));
    let req = requested.trim_start_matches('/');
    let base = requested.rsplit('/').next().unwrap_or(req);

    for entry in archive.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().map_err(|e| e.to_string())?;
        let raw = path.to_string_lossy().replace('\\', "/");
        let trimmed = raw.trim_matches('/');
        if trimmed != req && trimmed != base {
            continue;
        }
        if !entry.header().entry_type().is_file() {
            return Err("not_a_file".into());
        }
        let size = entry.header().size().unwrap_or(0);
        if size > MAX_FILE_BYTES {
            return Err("too_large".into());
        }
        let mut data = Vec::new();
        entry.read_to_end(&mut data).map_err(|e| e.to_string())?;
        let text = String::from_utf8(data).map_err(|_| "binary".to_string())?;
        return Ok(FsFile {
            path: requested.to_string(),
            text,
        });
    }
    Err("File not found".into())
}

async fn list_root(docker: &Docker, id: &str) -> Result<Vec<FsEntry>, String> {
    let mut rows = Vec::new();
    for name in ROOT_CANDIDATES {
        let path = format!("/{name}");
        if docker
            .get_container_archive_info(
                id,
                Some(ContainerArchiveInfoOptionsBuilder::default().path(&path).build()),
            )
            .await
            .is_ok()
        {
            rows.push(FsEntry {
                name: (*name).to_string(),
                path,
                kind: "dir".into(),
                size: 0,
            });
        }
    }
    Ok(rows)
}

#[tauri::command]
pub async fn image_pull(app: AppHandle, reference: String) -> Result<(), String> {
    let reference = normalize_image_ref(&reference)?;
    let docker = docker()?;
    let mut stream = docker.create_image(
        Some(
            CreateImageOptionsBuilder::default()
                .from_image(&reference)
                .build(),
        ),
        None,
        None,
    );

    while let Some(item) = stream.next().await {
        let info = item.map_err(map_err)?;
        if let Some(message) = info.error_detail.and_then(|detail| detail.message) {
            return Err(message);
        }
        let mut line = info.status.unwrap_or_default();
        if let Some(detail) = info.progress_detail {
            if let (Some(current), Some(total)) = (detail.current, detail.total) {
                if total > 0 {
                    line = format!("{line} {current}/{total}");
                }
            }
        }
        if !line.is_empty() {
            let _ = app.emit(
                "image-pull",
                PullChunk {
                    id: reference.clone(),
                    line,
                },
            );
        }
    }
    let _ = app.emit("image-pull-end", reference);
    Ok(())
}

fn hub_search_term(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let without_digest = trimmed.split_once('@').map(|(name, _)| name).unwrap_or(trimmed);
    if let Some((name, tag)) = without_digest.rsplit_once(':') {
        if !name.is_empty() && !tag.contains('/') {
            return name.to_string();
        }
    }
    without_digest.to_string()
}

#[tauri::command]
pub async fn image_search(term: String) -> Result<Vec<ImageSearchRow>, String> {
    let term = hub_search_term(&term);
    if term.len() < 2 {
        return Ok(Vec::new());
    }
    let items = docker()?
        .search_images(
            SearchImagesOptionsBuilder::default()
                .term(&term)
                .limit(12)
                .build(),
        )
        .await
        .map_err(map_err)?;
    Ok(items
        .into_iter()
        .filter_map(|item| {
            let name = item.name.filter(|value| !value.is_empty())?;
            Some(ImageSearchRow {
                name,
                description: item.description.unwrap_or_default(),
                official: item.is_official.unwrap_or(false),
                stars: item.star_count.unwrap_or(0),
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::hub_search_term;

    #[test]
    fn hub_search_term_strips_tag_and_digest() {
        assert_eq!(hub_search_term("nginx:alpine"), "nginx");
        assert_eq!(hub_search_term("nginx@sha256:abc"), "nginx");
        assert_eq!(hub_search_term("  redis  "), "redis");
        assert_eq!(hub_search_term("library/nginx:latest"), "library/nginx");
        assert_eq!(hub_search_term("localhost:5000/app"), "localhost:5000/app");
        assert_eq!(hub_search_term("a"), "a");
        assert_eq!(hub_search_term(""), "");
    }
}

#[tauri::command]
pub async fn container_create(
    image: String,
    name: Option<String>,
    ports: Vec<String>,
    env: Vec<String>,
    start: bool,
) -> Result<String, String> {
    let image = normalize_image_ref(&image)?;
    let mut exposed_ports = Vec::new();
    let mut port_bindings = HashMap::new();
    for line in ports {
        if line.trim().is_empty() {
            continue;
        }
        let (host, container) = parse_port_line(&line)?;
        let key = format!("{container}/tcp");
        if !exposed_ports.contains(&key) {
            exposed_ports.push(key.clone());
        }
        port_bindings
            .entry(key)
            .or_insert_with(|| Some(Vec::new()))
            .get_or_insert_with(Vec::new)
            .push(PortBinding {
                host_ip: Some("0.0.0.0".into()),
                host_port: Some(host),
            });
    }

    let body = ContainerCreateBody {
        image: Some(image),
        env: if env.is_empty() { None } else { Some(env) },
        exposed_ports: if exposed_ports.is_empty() {
            None
        } else {
            Some(exposed_ports)
        },
        host_config: if port_bindings.is_empty() {
            None
        } else {
            Some(HostConfig {
                port_bindings: Some(port_bindings),
                ..Default::default()
            })
        },
        ..Default::default()
    };

    let options = name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| CreateContainerOptionsBuilder::default().name(value).build());

    let created = docker()?
        .create_container(options, body)
        .await
        .map_err(map_err)?;
    if start {
        docker()?
            .start_container(&created.id, None::<StartContainerOptions>)
            .await
            .map_err(map_err)?;
    }
    Ok(created.id)
}

#[tauri::command]
pub async fn volume_create(name: String, driver: Option<String>) -> Result<String, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Volume name is required".into());
    }
    let created = docker()?
        .create_volume(VolumeCreateRequest {
            name: Some(name.clone()),
            driver: driver.filter(|value| !value.trim().is_empty()),
            ..Default::default()
        })
        .await
        .map_err(map_err)?;
    Ok(created.name)
}

#[tauri::command]
pub async fn network_create(name: String, driver: Option<String>) -> Result<String, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Network name is required".into());
    }
    docker()?
        .create_network(NetworkCreateRequest {
            name: name.clone(),
            driver: Some(driver.filter(|value| !value.trim().is_empty()).unwrap_or_else(|| "bridge".into())),
            ..Default::default()
        })
        .await
        .map_err(map_err)?;
    Ok(name)
}

#[tauri::command]
pub async fn container_fs_list(id: String, path: String) -> Result<Vec<FsEntry>, String> {
    let path = sanitize_path(&path)?;
    let docker = docker()?;
    if path == "/" {
        return list_root(&docker, &id).await;
    }
    let buf = download_archive(&docker, &id, &path).await?;
    list_tar_children(&buf, &path)
}

#[tauri::command]
pub async fn container_fs_read(id: String, path: String) -> Result<FsFile, String> {
    let path = sanitize_path(&path)?;
    if path == "/" {
        return Err("not_a_file".into());
    }
    let buf = download_archive(&docker()?, &id, &path).await?;
    read_tar_file(&buf, &path)
}

