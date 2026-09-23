use std::collections::HashMap;
use std::io::{Cursor, Read};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::sync::Mutex;

use bollard::body_full;
use bollard::exec::{ResizeExecOptions, StartExecOptions, StartExecResults};
use bollard::models::{
    ContainerCreateBody, ContainerInspectResponse, ExecConfig, HostConfig, PortBinding,
    RestartPolicy, RestartPolicyNameEnum,
};
use bollard::query_parameters::{
    ContainerArchiveInfoOptionsBuilder, CreateContainerOptionsBuilder,
    DownloadFromContainerOptionsBuilder, ListContainersOptionsBuilder, LogsOptionsBuilder,
    RemoveContainerOptionsBuilder, RenameContainerOptionsBuilder, RestartContainerOptionsBuilder,
    StartContainerOptions, StatsOptionsBuilder, StopContainerOptionsBuilder,
    UploadToContainerOptionsBuilder,
};
use bollard::Docker;
use futures_util::future::{AbortHandle, Abortable};
use futures_util::StreamExt;
use serde::Serialize;
use tar::{Archive, Builder, Header};
use tauri::{AppHandle, Emitter, State};
use tokio::io::AsyncWriteExt;

use super::shared::{
    docker, docker_cli, map_err, normalize_image_ref, resolve_bin, container_name, container_state,
    compose_label, PruneResult,
};

#[derive(Default)]
pub struct LogHub {
    tasks: Mutex<HashMap<String, AbortHandle>>,
}

struct TermSession {
    abort: AbortHandle,
    exec_id: String,
    input: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
}

#[derive(Default)]
pub struct TermHub {
    sessions: Mutex<HashMap<String, TermSession>>,
}

#[derive(Serialize)]
pub struct HostTerminal {
    pub id: String,
    pub label: String,
}

#[derive(Clone, Serialize)]
pub struct TermChunk {
    pub id: String,
    pub data: String,
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
    pub compose_project: Option<String>,
    pub compose_service: Option<String>,
    pub compose_id: Option<String>,
    pub compose_workdir: Option<String>,
    pub compose_config_files: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct LogChunk {
    pub id: String,
    pub line: String,
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
            let name = container_name(&c);
            let state = container_state(&c);
            let compose_project = compose_label(&c.labels, "com.docker.compose.project");
            let compose_service = compose_label(&c.labels, "com.docker.compose.service");
            let compose_id = compose_label(&c.labels, "com.dockman.compose.id");
            let compose_workdir = compose_label(&c.labels, "com.docker.compose.project.working_dir");
            let compose_config_files =
                compose_label(&c.labels, "com.docker.compose.project.config_files");
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
                state,
                ports,
                created: c.created.unwrap_or(0),
                compose_project,
                compose_service,
                compose_id,
                compose_workdir,
                compose_config_files,
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

const SHELL_CANDIDATES: &[&str] = &[
    "/bin/bash",
    "/bin/sh",
    "/bin/ash",
    "/usr/bin/bash",
    "/usr/bin/sh",
];

const HOST_TERMINALS: &[&str] = &[
    "xdg-terminal-exec",
    "ptyxis",
    "kgx",
    "gnome-terminal",
    "konsole",
    "xfce4-terminal",
    "mate-terminal",
    "tilix",
    "kitty",
    "alacritty",
    "wezterm",
    "foot",
    "ghostty",
    "xterm",
];

fn is_safe_docker_ref(value: &str) -> bool {
    let bytes = value.as_bytes();
    (1..=128).contains(&bytes.len())
        && bytes
            .iter()
            .all(|b| b.is_ascii_alphanumeric() || matches!(*b, b'_' | b'-' | b'.' | b'/' | b':'))
}

fn docker_exec_argv(docker: &str, id: &str, shell: &str) -> Vec<String> {
    vec![
        docker.to_string(),
        "exec".into(),
        "-it".into(),
        "--".into(),
        id.to_string(),
        shell.to_string(),
    ]
}

fn terminal_args_for(launcher: &str, exec: &[String]) -> Vec<String> {
    let mut args = match launcher {
        "xdg-terminal-exec" | "foot" => vec!["--".into()],
        "kitty" => vec!["--detach".into(), "--".into()],
        "wezterm" => vec!["start".into(), "--".into()],
        "ptyxis" | "kgx" | "gnome-terminal" => vec!["--".into()],
        "xfce4-terminal" | "mate-terminal" => vec!["-x".into()],
        _ => vec!["-e".into()],
    };
    args.extend(exec.iter().cloned());
    args
}

fn terminal_label(name: &str) -> String {
    match name {
        "xdg-terminal-exec" => "Desktop default".into(),
        "ptyxis" => "Ptyxis".into(),
        "kgx" => "GNOME Console".into(),
        "gnome-terminal" => "GNOME Terminal".into(),
        "konsole" => "Konsole".into(),
        "xfce4-terminal" => "XFCE Terminal".into(),
        "mate-terminal" => "MATE Terminal".into(),
        "tilix" => "Tilix".into(),
        "kitty" => "kitty".into(),
        "alacritty" => "Alacritty".into(),
        "wezterm" => "WezTerm".into(),
        "foot" => "foot".into(),
        "ghostty" => "Ghostty".into(),
        "xterm" => "xterm".into(),
        other => other.to_string(),
    }
}

fn pick_host_terminal(preferred: Option<&str>) -> Result<(PathBuf, String), String> {
    if let Some(name) = preferred
        .map(str::trim)
        .filter(|name| !name.is_empty() && *name != "auto")
    {
        if !is_safe_docker_ref(name) {
            return Err("Invalid terminal".into());
        }
        if let Some(path) = resolve_bin(name) {
            let kind = path
                .file_name()
                .and_then(|file| file.to_str())
                .unwrap_or(name)
                .to_string();
            return Ok((path, kind));
        }
        return Err(format!("{name} is not installed."));
    }
    if let Ok(value) = std::env::var("TERMINAL") {
        let value = value.trim();
        if !value.is_empty() && !value.contains(char::is_whitespace) {
            if let Some(path) = resolve_bin(value) {
                let kind = path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or(value)
                    .to_string();
                return Ok((path, kind));
            }
        }
    }
    for name in HOST_TERMINALS {
        if let Some(path) = resolve_bin(name) {
            return Ok((path, (*name).to_string()));
        }
    }
    Err("No terminal app found. Install a terminal or set the TERMINAL environment variable.".into())
}

fn spawn_container_terminal(id: &str, shell: &str, preferred: Option<&str>) -> Result<(), String> {
    if !is_safe_docker_ref(id) || !is_safe_docker_ref(shell) {
        return Err("Invalid container or shell path".into());
    }
    let docker = docker_cli()?;
    let (term, kind) = pick_host_terminal(preferred)?;
    let exec = docker_exec_argv(&docker.to_string_lossy(), id, shell);
    let args = terminal_args_for(&kind, &exec);
    let mut cmd = if let Some(setsid) = resolve_bin("setsid") {
        let mut cmd = Command::new(setsid);
        cmd.arg(&term);
        cmd
    } else {
        Command::new(&term)
    };
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| format!("Could not open a terminal: {err}"))?;
    Ok(())
}

fn inspect_shell(inspect: &ContainerInspectResponse) -> Option<String> {
    inspect
        .config
        .as_ref()?
        .env
        .as_ref()?
        .iter()
        .find_map(|entry| entry.strip_prefix("SHELL="))
        .map(str::trim)
        .filter(|value| value.starts_with('/') && is_safe_docker_ref(value))
        .map(ToString::to_string)
}

async fn container_path_exists(docker: &Docker, id: &str, path: &str) -> bool {
    docker
        .get_container_archive_info(
            id,
            Some(
                ContainerArchiveInfoOptionsBuilder::default()
                    .path(path)
                    .build(),
            ),
        )
        .await
        .is_ok()
}

async fn detect_container_shell(
    docker: &Docker,
    id: &str,
    inspect: &ContainerInspectResponse,
) -> Result<String, String> {
    let mut candidates = Vec::new();
    if let Some(shell) = inspect_shell(inspect) {
        candidates.push(shell);
    }
    for shell in SHELL_CANDIDATES {
        if !candidates.iter().any(|existing| existing == shell) {
            candidates.push((*shell).to_string());
        }
    }
    for shell in candidates {
        if container_path_exists(docker, id, &shell).await {
            return Ok(shell);
        }
    }
    Err("This image has no shell, so a terminal cannot be opened.".into())
}

async fn ready_container_shell(id: &str) -> Result<(Docker, String), String> {
    if !is_safe_docker_ref(id) {
        return Err("Invalid container".into());
    }
    let docker = docker()?;
    let inspect = docker.inspect_container(id, None).await.map_err(map_err)?;
    let running = inspect
        .state
        .as_ref()
        .and_then(|state| state.running)
        .unwrap_or(false);
    let paused = inspect
        .state
        .as_ref()
        .and_then(|state| state.paused)
        .unwrap_or(false);
    if !running {
        return Err("Start the container to open a terminal.".into());
    }
    if paused {
        return Err("Unpause the container to open a terminal.".into());
    }
    let shell = detect_container_shell(&docker, id, &inspect).await?;
    Ok((docker, shell))
}

#[tauri::command]
pub fn list_host_terminals() -> Vec<HostTerminal> {
    HOST_TERMINALS
        .iter()
        .filter_map(|name| {
            resolve_bin(name).map(|_| HostTerminal {
                id: (*name).to_string(),
                label: terminal_label(name),
            })
        })
        .collect()
}

#[tauri::command]
pub async fn container_open_terminal(id: String, terminal: Option<String>) -> Result<(), String> {
    let id = id.trim().to_string();
    let preferred = terminal.as_deref().map(str::trim).filter(|value| !value.is_empty());
    let (_docker, shell) = ready_container_shell(&id).await?;
    spawn_container_terminal(&id, &shell, preferred)
}

#[tauri::command]
pub async fn container_term_start(
    app: AppHandle,
    hub: State<'_, TermHub>,
    id: String,
) -> Result<(), String> {
    let id = id.trim().to_string();
    let (docker, shell) = ready_container_shell(&id).await?;
    let exec = docker
        .create_exec(
            &id,
            ExecConfig {
                attach_stdin: Some(true),
                attach_stdout: Some(true),
                attach_stderr: Some(true),
                tty: Some(true),
                env: Some(vec!["TERM=xterm-256color".into()]),
                cmd: Some(vec![shell]),
                ..Default::default()
            },
        )
        .await
        .map_err(map_err)?
        .id;
    let StartExecResults::Attached {
        mut output,
        mut input,
    } = docker
        .start_exec(
            &exec,
            Some(StartExecOptions {
                tty: true,
                ..Default::default()
            }),
        )
        .await
        .map_err(map_err)?
    else {
        return Err("Could not attach to exec".into());
    };

    let (input_tx, mut input_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
    let (abort_handle, abort_reg) = AbortHandle::new_pair();
    {
        let mut sessions = hub.sessions.lock().map_err(|err| err.to_string())?;
        if let Some(prev) = sessions.insert(
            id.clone(),
            TermSession {
                abort: abort_handle,
                exec_id: exec,
                input: input_tx,
            },
        ) {
            prev.abort.abort();
        }
    }

    let stream_id = id.clone();
    tauri::async_runtime::spawn(async move {
        let read = async {
            while let Some(item) = output.next().await {
                match item {
                    Ok(msg) => {
                        let _ = app.emit(
                            "container-term",
                            TermChunk {
                                id: stream_id.clone(),
                                data: msg.to_string(),
                            },
                        );
                    }
                    Err(_) => break,
                }
            }
        };
        let write = async {
            while let Some(bytes) = input_rx.recv().await {
                if input.write_all(&bytes).await.is_err() {
                    break;
                }
                let _ = input.flush().await;
            }
        };
        let work = async {
            futures_util::future::select(Box::pin(read), Box::pin(write)).await;
        };
        let _ = Abortable::new(work, abort_reg).await;
        let _ = app.emit("container-term-end", stream_id);
    });
    Ok(())
}

#[tauri::command]
pub async fn container_term_write(hub: State<'_, TermHub>, id: String, data: String) -> Result<(), String> {
    let tx = {
        let sessions = hub.sessions.lock().map_err(|err| err.to_string())?;
        sessions
            .get(&id)
            .map(|session| session.input.clone())
            .ok_or_else(|| "No terminal session".to_string())?
    };
    tx.send(data.into_bytes())
        .map_err(|_| "Terminal session has closed".to_string())
}

#[tauri::command]
pub async fn container_term_resize(
    hub: State<'_, TermHub>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    if cols == 0 || rows == 0 {
        return Ok(());
    }
    let exec_id = {
        let sessions = hub.sessions.lock().map_err(|err| err.to_string())?;
        sessions
            .get(&id)
            .map(|session| session.exec_id.clone())
            .ok_or_else(|| "No terminal session".to_string())?
    };
    docker()?
        .resize_exec(
            &exec_id,
            ResizeExecOptions {
                height: rows,
                width: cols,
            },
        )
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn container_term_stop(hub: State<'_, TermHub>, id: String) -> Result<(), String> {
    let mut sessions = hub.sessions.lock().map_err(|err| err.to_string())?;
    if let Some(session) = sessions.remove(&id) {
        session.abort.abort();
    }
    Ok(())
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
const ROOT_FILE_CANDIDATES: &[&str] = &[
    "docker-entrypoint.sh",
    "entrypoint.sh",
    "init.sh",
    "start.sh",
];

fn parse_port_line(line: &str) -> Result<(String, String, String), String> {
    let line = line.trim();
    let (rest, proto) = if let Some((rest, proto)) = line.rsplit_once('/') {
        let proto = proto.to_ascii_lowercase();
        if proto != "tcp" && proto != "udp" {
            return Err(format!("Invalid port mapping: {line}"));
        }
        (rest, proto)
    } else {
        (line, "tcp".to_string())
    };
    if let Some((host, container)) = rest.split_once(':') {
        if host.parse::<u16>().is_err() || container.parse::<u16>().is_err() {
            return Err(format!("Invalid port mapping: {line}"));
        }
        Ok((host.to_string(), container.to_string(), proto))
    } else if rest.parse::<u16>().is_ok() {
        Ok((rest.to_string(), rest.to_string(), proto))
    } else {
        Err(format!("Invalid port mapping: {line}"))
    }
}

fn parse_memory(value: &str) -> Result<Option<i64>, String> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    let split = value
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(value.len());
    let (num, suffix) = value.split_at(split);
    let amount: i64 = num
        .parse()
        .map_err(|_| format!("Invalid memory limit: {value}"))?;
    let mul: i64 = match suffix.to_ascii_lowercase().as_str() {
        "" | "b" => 1,
        "k" | "kb" | "ki" | "kib" => 1024,
        "m" | "mb" | "mi" | "mib" => 1024 * 1024,
        "g" | "gb" | "gi" | "gib" => 1024 * 1024 * 1024,
        _ => return Err(format!("Invalid memory limit: {value}")),
    };
    let bytes = amount
        .checked_mul(mul)
        .ok_or_else(|| format!("Invalid memory limit: {value}"))?;
    if bytes <= 0 {
        return Err(format!("Invalid memory limit: {value}"));
    }
    Ok(Some(bytes))
}

fn optional_text(value: Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
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
        if container_path_exists(docker, id, &path).await {
            rows.push(FsEntry {
                name: (*name).to_string(),
                path,
                kind: "dir".into(),
                size: 0,
            });
        }
    }
    for name in ROOT_FILE_CANDIDATES {
        let path = format!("/{name}");
        if container_path_exists(docker, id, &path).await {
            rows.push(FsEntry {
                name: (*name).to_string(),
                path,
                kind: "file".into(),
                size: 0,
            });
        }
    }
    Ok(sort_fs_entries(rows))
}

#[tauri::command]
pub async fn containers_prune() -> Result<PruneResult, String> {
    let result = docker()?.prune_containers(None).await.map_err(map_err)?;
    Ok(PruneResult {
        deleted: result.containers_deleted.unwrap_or_default().len() as i64,
        space_reclaimed: result.space_reclaimed.unwrap_or(0),
    })
}

#[derive(Serialize)]
pub struct ContainerStats {
    pub id: String,
    pub cpu_percent: f64,
    pub memory_used: u64,
    pub memory_limit: u64,
    pub net_rx: u64,
    pub net_tx: u64,
}

fn cpu_percent(stats: &bollard::models::ContainerStatsResponse) -> f64 {
    let Some(cpu) = stats.cpu_stats.as_ref() else {
        return 0.0;
    };
    let Some(pre) = stats.precpu_stats.as_ref() else {
        return 0.0;
    };
    let total = cpu.cpu_usage.as_ref().and_then(|usage| usage.total_usage).unwrap_or(0);
    let pre_total = pre.cpu_usage.as_ref().and_then(|usage| usage.total_usage).unwrap_or(0);
    let system = cpu.system_cpu_usage.unwrap_or(0);
    let pre_system = pre.system_cpu_usage.unwrap_or(0);
    if total <= pre_total || system <= pre_system {
        return 0.0;
    }
    let ncpu = cpu
        .online_cpus
        .filter(|count| *count > 0)
        .or_else(|| {
            cpu.cpu_usage
                .as_ref()
                .and_then(|usage| usage.percpu_usage.as_ref())
                .map(|cores| cores.len() as u32)
        })
        .unwrap_or(1) as f64;
    ((total - pre_total) as f64 / (system - pre_system) as f64) * ncpu * 100.0
}

#[tauri::command]
pub async fn container_stats(id: String) -> Result<ContainerStats, String> {
    let id = id.trim().to_string();
    if id.is_empty() {
        return Err("Container is required".into());
    }
    let docker = docker()?;
    let mut stream = docker.stats(
        &id,
        Some(StatsOptionsBuilder::default().stream(false).build()),
    );
    let stats = stream
        .next()
        .await
        .ok_or_else(|| "No stats available".to_string())?
        .map_err(map_err)?;
    let memory = stats.memory_stats.as_ref();
    let (net_rx, net_tx) = stats.networks.as_ref().map_or((0, 0), |networks| {
        networks.values().fold((0, 0), |(rx, tx), iface| {
            (
                rx + iface.rx_bytes.unwrap_or(0),
                tx + iface.tx_bytes.unwrap_or(0),
            )
        })
    });
    Ok(ContainerStats {
        id: stats.id.clone().unwrap_or(id),
        cpu_percent: cpu_percent(&stats),
        memory_used: memory.and_then(|row| row.usage).unwrap_or(0),
        memory_limit: memory.and_then(|row| row.limit).unwrap_or(0),
        net_rx,
        net_tx,
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
    user: Option<String>,
    working_dir: Option<String>,
    memory: Option<String>,
    start: bool,
) -> Result<String, String> {
    let image = normalize_image_ref(&image)?;
    let mut exposed_ports = Vec::new();
    let mut port_bindings = HashMap::new();
    for line in ports {
        if line.trim().is_empty() {
            continue;
        }
        let (host, container, proto) = parse_port_line(&line)?;
        let key = format!("{container}/{proto}");
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
    let network = optional_text(network);
    let user = optional_text(user);
    let working_dir = optional_text(working_dir);
    let memory = parse_memory(memory.as_deref().unwrap_or(""))?;
    let restart_policy = parse_restart(restart.as_deref().unwrap_or(""))?;
    let needs_host = !port_bindings.is_empty()
        || !binds.is_empty()
        || network.is_some()
        || restart_policy.is_some()
        || memory.is_some();

    let body = ContainerCreateBody {
        image: Some(image),
        cmd: nonempty_args(cmd),
        entrypoint: nonempty_args(entrypoint),
        user,
        working_dir,
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
                memory,
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


#[cfg(test)]
mod tests {
    use super::{
        docker_exec_argv, first_child, is_safe_docker_ref, list_tar_children, parent_and_name,
        parse_dir_list, parse_memory, parse_mount_line, parse_port_line, parse_restart,
        read_tar_file, terminal_args_for, terminal_label,
    };

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
    fn parse_port_line_accepts_proto_suffix() {
        assert_eq!(
            parse_port_line("80").unwrap(),
            ("80".into(), "80".into(), "tcp".into())
        );
        assert_eq!(
            parse_port_line("8080:80").unwrap(),
            ("8080".into(), "80".into(), "tcp".into())
        );
        assert_eq!(
            parse_port_line("53:53/udp").unwrap(),
            ("53".into(), "53".into(), "udp".into())
        );
        assert_eq!(
            parse_port_line("53/udp").unwrap(),
            ("53".into(), "53".into(), "udp".into())
        );
        assert!(parse_port_line("53:53/sctp").is_err());
        assert!(parse_port_line("abc").is_err());
    }

    #[test]
    fn parse_memory_accepts_bytes_and_suffixes() {
        assert_eq!(parse_memory("").unwrap(), None);
        assert_eq!(parse_memory("512").unwrap(), Some(512));
        assert_eq!(parse_memory("512m").unwrap(), Some(512 * 1024 * 1024));
        assert_eq!(parse_memory("1g").unwrap(), Some(1024 * 1024 * 1024));
        assert_eq!(parse_memory("256MiB").unwrap(), Some(256 * 1024 * 1024));
        assert!(parse_memory("0").is_err());
        assert!(parse_memory("lots").is_err());
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

    #[test]
    fn is_safe_docker_ref_rejects_injection() {
        assert!(is_safe_docker_ref("abc123def456"));
        assert!(is_safe_docker_ref("my-app"));
        assert!(is_safe_docker_ref("/bin/bash"));
        assert!(!is_safe_docker_ref(""));
        assert!(!is_safe_docker_ref("id;rm -rf /"));
        assert!(!is_safe_docker_ref("a b"));
    }

    #[test]
    fn terminal_args_keep_docker_exec_as_argv() {
        let exec = docker_exec_argv("/usr/bin/docker", "abc", "/bin/sh");
        assert_eq!(
            terminal_args_for("xdg-terminal-exec", &exec),
            ["--", "/usr/bin/docker", "exec", "-it", "--", "abc", "/bin/sh"]
        );
        assert_eq!(
            terminal_args_for("gnome-terminal", &exec)[..2],
            ["--", "/usr/bin/docker"]
        );
        assert_eq!(
            terminal_args_for("kitty", &exec)[..2],
            ["--detach", "--"]
        );
        assert_eq!(terminal_args_for("konsole", &exec)[0], "-e");
        assert_eq!(
            terminal_args_for("wezterm", &exec)[..2],
            ["start", "--"]
        );
    }

    #[test]
    fn terminal_label_uses_friendly_names() {
        assert_eq!(terminal_label("kgx"), "GNOME Console");
        assert_eq!(terminal_label("kitty"), "kitty");
        assert_eq!(terminal_label("weirdterm"), "weirdterm");
    }

}
