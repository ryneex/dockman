use std::collections::HashMap;
use std::io::{Cursor, Read};
use std::sync::mpsc::{self, Receiver};
use std::sync::Mutex;

use bollard::body_full;
use bollard::exec::StartExecResults;
use bollard::models::{
    ContainerCreateBody, ExecConfig, HostConfig, NetworkCreateRequest, PortBinding, RestartPolicy,
    RestartPolicyNameEnum, VolumeCreateRequest,
};
use bollard::query_parameters::{
    ContainerArchiveInfoOptionsBuilder, CreateContainerOptionsBuilder, CreateImageOptionsBuilder,
    DownloadFromContainerOptionsBuilder, InspectNetworkOptionsBuilder,
    ListContainersOptionsBuilder, ListImagesOptionsBuilder, ListNetworksOptionsBuilder,
    ListVolumesOptionsBuilder, LogsOptionsBuilder, PruneImagesOptionsBuilder,
    RemoveContainerOptionsBuilder, RemoveImageOptionsBuilder, RemoveVolumeOptionsBuilder,
    RenameContainerOptionsBuilder, RestartContainerOptionsBuilder, SearchImagesOptionsBuilder,
    StartContainerOptions, StopContainerOptionsBuilder, UploadToContainerOptionsBuilder,
};
use bollard::Docker;
use futures_util::future::{AbortHandle, Abortable};
use futures_util::StreamExt;
use serde::Serialize;
use tar::{Archive, Builder, Header};
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
    pub dangling: bool,
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
        .list_containers(Some(
            ListContainersOptionsBuilder::default().all(true).build(),
        ))
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
        .list_containers(Some(
            ListContainersOptionsBuilder::default().all(true).build(),
        ))
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
pub async fn container_pause(id: String) -> Result<(), String> {
    docker()?.pause_container(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn container_unpause(id: String) -> Result<(), String> {
    docker()?.unpause_container(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn container_rename(id: String, name: String) -> Result<(), String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Container name is required".into());
    }
    docker()?
        .rename_container(
            &id,
            RenameContainerOptionsBuilder::default().name(&name).build(),
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
pub async fn container_logs(
    app: AppHandle,
    hub: State<'_, LogHub>,
    id: String,
) -> Result<(), String> {
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
            .timestamps(true)
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
            let dangling = tags.is_empty();
            ImageRow {
                id: image.id,
                tags,
                size: image.size,
                created: image.created,
                dangling,
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
            Some(
                InspectNetworkOptionsBuilder::default()
                    .verbose(true)
                    .build(),
            ),
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

const MAX_FILE_BYTES: u64 = 32 * 1024 * 1024;
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

fn parse_mount_line(line: &str) -> Result<String, String> {
    let line = line.trim();
    if line.is_empty() {
        return Err("Mount is required".into());
    }
    let (rest, mode) = if let Some(stripped) = line.strip_suffix(":ro") {
        (stripped, Some("ro"))
    } else if let Some(stripped) = line.strip_suffix(":rw") {
        (stripped, Some("rw"))
    } else {
        (line, None)
    };
    let Some((source, target)) = rest.rsplit_once(':') else {
        return Err(format!("Invalid mount: {line}"));
    };
    let source = source.trim();
    let target = target.trim();
    if source.is_empty() {
        return Err(format!("Invalid mount: {line}"));
    }
    if !target.starts_with('/') {
        return Err(format!("Container path must be absolute: {line}"));
    }
    if source.contains('/') && !source.starts_with('/') {
        return Err(format!("Invalid mount: {line}"));
    }
    Ok(match mode {
        Some(mode) => format!("{source}:{target}:{mode}"),
        None => format!("{source}:{target}"),
    })
}

fn parse_restart(value: &str) -> Result<Option<RestartPolicy>, String> {
    let value = value.trim();
    if value.is_empty() || value == "no" {
        return Ok(None);
    }
    let name = match value {
        "on-failure" => RestartPolicyNameEnum::ON_FAILURE,
        "always" => RestartPolicyNameEnum::ALWAYS,
        "unless-stopped" => RestartPolicyNameEnum::UNLESS_STOPPED,
        _ => return Err(format!("Invalid restart policy: {value}")),
    };
    Ok(Some(RestartPolicy {
        name: Some(name),
        maximum_retry_count: None,
    }))
}

fn nonempty_args(values: Vec<String>) -> Option<Vec<String>> {
    let args: Vec<String> = values
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect();
    if args.is_empty() {
        None
    } else {
        Some(args)
    }
}

fn parent_and_name(path: &str) -> Result<(String, String), String> {
    let path = sanitize_path(path)?;
    let Some((parent, name)) = path.rsplit_once('/') else {
        return Err("not_a_file".into());
    };
    if name.is_empty() {
        return Err("not_a_file".into());
    }
    Ok((
        if parent.is_empty() {
            "/".into()
        } else {
            parent.to_string()
        },
        name.to_string(),
    ))
}

fn pack_text_file(name: &str, text: &str) -> Result<Vec<u8>, String> {
    let bytes = text.as_bytes();
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("too_large".into());
    }
    let mut header = Header::new_gnu();
    header.set_size(bytes.len() as u64);
    header.set_mode(0o644);
    header.set_cksum();
    let mut builder = Builder::new(Vec::new());
    builder
        .append_data(&mut header, name, bytes)
        .map_err(|e| e.to_string())?;
    builder.into_inner().map_err(|e| e.to_string())
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

async fn download_archive(
    docker: &Docker,
    id: &str,
    path: &str,
    max_bytes: usize,
) -> Result<Vec<u8>, String> {
    let mut stream = docker.download_from_container(
        id,
        Some(
            DownloadFromContainerOptionsBuilder::default()
                .path(path)
                .build(),
        ),
    );
    let mut buf = Vec::new();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(map_err)?;
        if buf.len().saturating_add(bytes.len()) > max_bytes {
            return Err("too_large".into());
        }
        buf.extend_from_slice(&bytes);
    }
    Ok(buf)
}

struct ChannelReader {
    rx: Receiver<Result<Vec<u8>, String>>,
    leftover: Vec<u8>,
    pos: usize,
}

impl Read for ChannelReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if buf.is_empty() {
            return Ok(0);
        }
        loop {
            if self.pos < self.leftover.len() {
                let n = (self.leftover.len() - self.pos).min(buf.len());
                buf[..n].copy_from_slice(&self.leftover[self.pos..self.pos + n]);
                self.pos += n;
                if self.pos >= self.leftover.len() {
                    self.leftover.clear();
                    self.pos = 0;
                }
                return Ok(n);
            }
            match self.rx.recv() {
                Ok(Ok(bytes)) if bytes.is_empty() => continue,
                Ok(Ok(bytes)) => {
                    self.leftover = bytes;
                    self.pos = 0;
                }
                Ok(Err(err)) => return Err(std::io::Error::other(err)),
                Err(_) => return Ok(0),
            }
        }
    }
}

fn list_tar_children(reader: impl Read, requested: &str) -> Result<Vec<FsEntry>, String> {
    let mut archive = Archive::new(reader);
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
        let size = if kind == "file" {
            header.size().unwrap_or(0)
        } else {
            0
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
                    existing.size = 0;
                }
            })
            .or_insert(FsEntry {
                name,
                path: child_path,
                kind: kind.into(),
                size,
            });
    }

    Ok(sort_fs_entries(by_name.into_values().collect()))
}

fn tar_entry_name(path: &str) -> String {
    path.replace('\\', "/").trim_matches('/').to_string()
}

fn read_capped(entry: &mut impl Read) -> Result<Vec<u8>, String> {
    let mut data = Vec::new();
    entry
        .take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut data)
        .map_err(|e| e.to_string())?;
    if data.len() as u64 > MAX_FILE_BYTES {
        return Err("too_large".into());
    }
    Ok(data)
}

fn read_tar_file(buf: &[u8], requested: &str) -> Result<FsFile, String> {
    let mut archive = Archive::new(Cursor::new(buf));
    let req = requested.trim_start_matches('/');
    let base = requested.rsplit('/').next().unwrap_or(req);
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();

    for entry in archive.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        if !entry.header().entry_type().is_file() {
            continue;
        }
        let path = entry.path().map_err(|e| e.to_string())?;
        let trimmed = tar_entry_name(&path.to_string_lossy());
        let data = read_capped(&mut entry)?;
        files.push((trimmed, data));
    }

    let data = if let Some((_, data)) = files.iter().find(|(name, _)| name == req) {
        data.clone()
    } else if files.len() == 1 {
        files.remove(0).1
    } else if let Some((_, data)) = files.iter().find(|(name, _)| name == base) {
        if files.iter().filter(|(name, _)| name == base).count() == 1 {
            data.clone()
        } else {
            return Err("not_a_file".into());
        }
    } else {
        return Err("not_a_file".into());
    };

    let text = String::from_utf8(data).map_err(|_| "binary".to_string())?;
    Ok(FsFile {
        path: requested.to_string(),
        text,
    })
}

const LIST_DIR_SCRIPT: &str = r#"
path=$1
cd -- "$path" || exit 1
for name in .* *; do
  [ "$name" = "." ] || [ "$name" = ".." ] && continue
  if [ ! -e "$name" ] && [ ! -L "$name" ]; then
    continue
  fi
  if [ -L "$name" ]; then
    k=symlink
    s=0
  elif [ -d "$name" ]; then
    k=dir
    s=0
  else
    k=file
    s=$(stat -c %s -- "$name" 2>/dev/null || echo 0)
  fi
  printf '%s\t%s\t%s\n' "$k" "$s" "$name"
done
"#;

fn sort_fs_entries(mut rows: Vec<FsEntry>) -> Vec<FsEntry> {
    rows.sort_by(|a, b| {
        (a.kind != "dir")
            .cmp(&(b.kind != "dir"))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    rows
}

fn parse_dir_list(text: &str, parent: &str) -> Vec<FsEntry> {
    let mut rows = Vec::new();
    for line in text.lines() {
        let Some((kind, rest)) = line.split_once('\t') else {
            continue;
        };
        let Some((size, name)) = rest.split_once('\t') else {
            continue;
        };
        if name.is_empty() || name == "." || name == ".." {
            continue;
        }
        let path = if parent == "/" {
            format!("/{name}")
        } else {
            format!("{parent}/{name}")
        };
        rows.push(FsEntry {
            name: name.to_string(),
            path,
            kind: kind.to_string(),
            size: size.parse().unwrap_or(0),
        });
    }
    sort_fs_entries(rows)
}

async fn exec_stdout(docker: &Docker, id: &str, cmd: Vec<String>) -> Result<String, String> {
    let exec = docker
        .create_exec(
            id,
            ExecConfig {
                attach_stdout: Some(true),
                attach_stderr: Some(true),
                cmd: Some(cmd),
                ..Default::default()
            },
        )
        .await
        .map_err(map_err)?
        .id;
    let StartExecResults::Attached { mut output, .. } =
        docker.start_exec(&exec, None).await.map_err(map_err)?
    else {
        return Err("Could not attach to exec".into());
    };
    let mut out = String::new();
    while let Some(item) = output.next().await {
        out.push_str(&item.map_err(map_err)?.to_string());
    }
    let inspect = docker.inspect_exec(&exec).await.map_err(map_err)?;
    if inspect.exit_code.unwrap_or(0) != 0 {
        return Err(if out.trim().is_empty() {
            "Could not list this folder".into()
        } else {
            out.trim().to_string()
        });
    }
    Ok(out)
}

async fn list_via_archive(docker: &Docker, id: &str, path: &str) -> Result<Vec<FsEntry>, String> {
    let mut stream = docker.download_from_container(
        id,
        Some(
            DownloadFromContainerOptionsBuilder::default()
                .path(path)
                .build(),
        ),
    );
    let (tx, rx) = mpsc::sync_channel(8);
    let requested = path.to_string();
    let worker = std::thread::spawn(move || {
        list_tar_children(
            ChannelReader {
                rx,
                leftover: Vec::new(),
                pos: 0,
            },
            &requested,
        )
    });
    while let Some(chunk) = stream.next().await {
        match chunk {
            Ok(bytes) => {
                if tx.send(Ok(bytes.to_vec())).is_err() {
                    break;
                }
            }
            Err(err) => {
                let _ = tx.send(Err(map_err(err)));
                break;
            }
        }
    }
    drop(tx);
    worker.join().unwrap_or_else(|_| Err("Could not list this folder".into()))
}

async fn list_via_exec(docker: &Docker, id: &str, path: &str) -> Result<Vec<FsEntry>, String> {
    let text = exec_stdout(
        docker,
        id,
        vec![
            "sh".into(),
            "-c".into(),
            LIST_DIR_SCRIPT.to_string(),
            "lsdir".into(),
            path.to_string(),
        ],
    )
    .await?;
    if text.contains("can't cd") || text.contains("No such file") {
        return Err(text.trim().to_string());
    }
    Ok(parse_dir_list(&text, path))
}

async fn list_root(docker: &Docker, id: &str) -> Result<Vec<FsEntry>, String> {
    let mut rows = Vec::new();
    for name in ROOT_CANDIDATES {
        let path = format!("/{name}");
        if docker
            .get_container_archive_info(
                id,
                Some(
                    ContainerArchiveInfoOptionsBuilder::default()
                        .path(&path)
                        .build(),
                ),
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
    let without_digest = trimmed
        .split_once('@')
        .map(|(name, _)| name)
        .unwrap_or(trimmed);
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
    use super::{
        first_child, hub_search_term, list_tar_children, parent_and_name, parse_dir_list,
        parse_mount_line, parse_restart, read_tar_file,
    };

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

    #[test]
    fn parse_mount_line_accepts_volume_bind_and_mode() {
        assert_eq!(
            parse_mount_line("data:/var/lib/data").unwrap(),
            "data:/var/lib/data"
        );
        assert_eq!(
            parse_mount_line("/tmp/app:/app:ro").unwrap(),
            "/tmp/app:/app:ro"
        );
        assert!(parse_mount_line("data").is_err());
        assert!(parse_mount_line("data:relative").is_err());
        assert!(parse_mount_line("not/a/volume:/app").is_err());
    }

    #[test]
    fn parse_restart_skips_default() {
        assert!(parse_restart("no").unwrap().is_none());
        assert!(parse_restart("unless-stopped").unwrap().is_some());
        assert!(parse_restart("sometimes").is_err());
    }

    #[test]
    fn parent_and_name_splits_absolute_files() {
        assert_eq!(
            parent_and_name("/etc/hosts").unwrap(),
            ("/etc".into(), "hosts".into())
        );
        assert_eq!(parent_and_name("/foo").unwrap(), ("/".into(), "foo".into()));
        assert!(parent_and_name("/").is_err());
        assert!(parent_and_name("../etc/hosts").is_err());
    }

    #[test]
    fn first_child_marks_nested_paths_as_directories() {
        assert_eq!(
            first_child("etc/hosts", "/etc"),
            Some(("hosts".into(), false))
        );
        assert_eq!(
            first_child("etc/nginx/nginx.conf", "/etc"),
            Some(("nginx".into(), true))
        );
    }

    #[test]
    fn read_tar_file_uses_single_member() {
        let mut header = super::Header::new_gnu();
        header.set_size(5);
        header.set_cksum();
        let mut builder = super::Builder::new(Vec::new());
        builder
            .append_data(&mut header, "hosts", b"hello".as_slice())
            .unwrap();
        let buf = builder.into_inner().unwrap();
        let file = read_tar_file(&buf, "/etc/hosts").unwrap();
        assert_eq!(file.text, "hello");
    }

    #[test]
    fn parse_dir_list_skips_dots_and_sorts_dirs_first() {
        let rows = parse_dir_list("file\t12\tz.txt\ndir\t0\tapp\nsymlink\t0\tlink\n", "/");
        assert_eq!(
            rows.iter().map(|row| row.name.as_str()).collect::<Vec<_>>(),
            ["app", "link", "z.txt"]
        );
        assert_eq!(rows[0].path, "/app");
        assert_eq!(rows[0].kind, "dir");
    }

    #[test]
    fn list_tar_children_keeps_only_immediate_names() {
        let mut builder = super::Builder::new(Vec::new());
        for (name, data, dir) in [
            ("app", &b""[..], true),
            ("app/wwwroot", &b""[..], true),
            ("app/wwwroot/index.js", b"console.log(1)" as &[u8], false),
            ("app/Aspire.Dashboard.dll", b"dll" as &[u8], false),
        ] {
            let mut header = super::Header::new_gnu();
            if dir {
                header.set_entry_type(tar::EntryType::Directory);
                header.set_size(0);
                header.set_cksum();
                builder.append_data(&mut header, name, data).unwrap();
            } else {
                header.set_size(data.len() as u64);
                header.set_cksum();
                builder.append_data(&mut header, name, data).unwrap();
            }
        }
        let buf = builder.into_inner().unwrap();
        let rows = list_tar_children(buf.as_slice(), "/app").unwrap();
        assert_eq!(
            rows.iter().map(|row| row.name.as_str()).collect::<Vec<_>>(),
            ["wwwroot", "Aspire.Dashboard.dll"]
        );
        assert_eq!(rows[0].kind, "dir");
        assert_eq!(rows[1].kind, "file");
        assert_eq!(rows[1].size, 3);
    }
}

#[derive(Serialize)]
pub struct PruneResult {
    pub deleted: i64,
    pub space_reclaimed: i64,
}

#[tauri::command]
pub async fn containers_prune() -> Result<PruneResult, String> {
    let result = docker()?.prune_containers(None).await.map_err(map_err)?;
    Ok(PruneResult {
        deleted: result.containers_deleted.unwrap_or_default().len() as i64,
        space_reclaimed: result.space_reclaimed.unwrap_or(0),
    })
}

#[tauri::command]
pub async fn images_prune() -> Result<PruneResult, String> {
    let mut filters = HashMap::new();
    filters.insert("dangling".to_string(), vec!["false".to_string()]);
    let result = docker()?
        .prune_images(Some(
            PruneImagesOptionsBuilder::default()
                .filters(&filters)
                .build(),
        ))
        .await
        .map_err(map_err)?;
    Ok(PruneResult {
        deleted: result.images_deleted.unwrap_or_default().len() as i64,
        space_reclaimed: result.space_reclaimed.unwrap_or(0),
    })
}

#[tauri::command]
pub async fn volumes_prune() -> Result<PruneResult, String> {
    let result = docker()?
        .prune_volumes(None::<bollard::query_parameters::PruneVolumesOptions>)
        .await
        .map_err(map_err)?;
    Ok(PruneResult {
        deleted: result.volumes_deleted.unwrap_or_default().len() as i64,
        space_reclaimed: result.space_reclaimed.unwrap_or(0),
    })
}

#[tauri::command]
pub async fn container_create(
    image: String,
    name: Option<String>,
    ports: Vec<String>,
    env: Vec<String>,
    cmd: Vec<String>,
    entrypoint: Vec<String>,
    mounts: Vec<String>,
    network: Option<String>,
    restart: Option<String>,
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

    let binds = mounts
        .into_iter()
        .filter(|line| !line.trim().is_empty())
        .map(|line| parse_mount_line(&line))
        .collect::<Result<Vec<_>, _>>()?;
    let network = network
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    let restart_policy = parse_restart(restart.as_deref().unwrap_or(""))?;
    let needs_host = !port_bindings.is_empty()
        || !binds.is_empty()
        || network.is_some()
        || restart_policy.is_some();

    let body = ContainerCreateBody {
        image: Some(image),
        cmd: nonempty_args(cmd),
        entrypoint: nonempty_args(entrypoint),
        env: if env.is_empty() { None } else { Some(env) },
        exposed_ports: if exposed_ports.is_empty() {
            None
        } else {
            Some(exposed_ports)
        },
        host_config: if needs_host {
            Some(HostConfig {
                port_bindings: if port_bindings.is_empty() {
                    None
                } else {
                    Some(port_bindings)
                },
                binds: if binds.is_empty() { None } else { Some(binds) },
                network_mode: network,
                restart_policy,
                ..Default::default()
            })
        } else {
            None
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
            driver: Some(
                driver
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| "bridge".into()),
            ),
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
    if let Ok(rows) = list_via_exec(&docker, &id, &path).await {
        return Ok(rows);
    }
    if path == "/" {
        return list_root(&docker, &id).await;
    }
    list_via_archive(&docker, &id, &path).await
}

#[tauri::command]
pub async fn container_fs_read(id: String, path: String) -> Result<FsFile, String> {
    let path = sanitize_path(&path)?;
    if path == "/" {
        return Err("not_a_file".into());
    }
    let buf = download_archive(
        &docker()?,
        &id,
        &path,
        MAX_FILE_BYTES as usize + 1024 * 1024,
    )
    .await?;
    read_tar_file(&buf, &path)
}

#[tauri::command]
pub async fn container_fs_write(id: String, path: String, text: String) -> Result<(), String> {
    let (parent, name) = parent_and_name(&path)?;
    let tar = pack_text_file(&name, &text)?;
    docker()?
        .upload_to_container(
            &id,
            Some(
                UploadToContainerOptionsBuilder::default()
                    .path(&parent)
                    .build(),
            ),
            body_full(tar.into()),
        )
        .await
        .map_err(map_err)
}
