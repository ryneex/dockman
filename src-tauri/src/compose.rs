use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::docker::{docker_cli, resolve_bin};

const EMPTY_COMPOSE: &str = "services: {}\n";

#[derive(Clone, Serialize, Deserialize)]
struct StackMeta {
    name: String,
    updated_at: i64,
    #[serde(default)]
    last_project: Option<String>,
    #[serde(default)]
    projects: Vec<String>,
}

#[derive(Serialize)]
pub struct StackRow {
    pub id: String,
    pub name: String,
    pub service_count: u32,
    pub services: Vec<String>,
    pub updated_at: i64,
    pub last_project: Option<String>,
    pub projects: Vec<String>,
}

#[derive(Serialize)]
pub struct StackDetail {
    pub id: String,
    pub name: String,
    pub yaml: String,
    pub updated_at: i64,
    pub last_project: Option<String>,
    pub projects: Vec<String>,
}

#[derive(Clone, Serialize)]
pub struct ComposeChunk {
    pub id: String,
    pub line: String,
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or(0)
}

fn is_slug(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !first.is_ascii_lowercase() && !first.is_ascii_digit() {
        return false;
    }
    value.len() <= 64
        && value
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-' || ch == '_')
}

fn parse_id(id: &str) -> Result<String, String> {
    let id = id.trim();
    if !is_slug(id) {
        return Err("Invalid compose".into());
    }
    Ok(id.to_string())
}

fn parse_project(project: &str) -> Result<String, String> {
    let project = project.trim();
    if !is_slug(project) {
        return Err("Project name must be lowercase letters, digits, hyphens, or underscores.".into());
    }
    Ok(project.to_string())
}

fn slugify(name: &str) -> String {
    let mut slug = String::new();
    let mut dash = false;
    for ch in name.to_ascii_lowercase().chars() {
        if ch.is_ascii_lowercase() || ch.is_ascii_digit() {
            slug.push(ch);
            dash = false;
        } else if !slug.is_empty() && !dash {
            slug.push('-');
            dash = true;
        }
    }
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() { "stack".into() } else { slug }
}

fn stacks_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?
        .join("stacks");
    fs::create_dir_all(&dir).map_err(|err| format!("Could not create compose library: {err}"))?;
    Ok(dir)
}

fn stack_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let id = parse_id(id)?;
    Ok(stacks_root(app)?.join(id))
}

fn compose_path(dir: &Path) -> PathBuf {
    dir.join("compose.yml")
}

fn meta_path(dir: &Path) -> PathBuf {
    dir.join("meta.json")
}

fn read_meta(dir: &Path) -> Result<StackMeta, String> {
    let raw = fs::read_to_string(meta_path(dir)).map_err(|err| format!("Could not read compose: {err}"))?;
    serde_json::from_str(&raw).map_err(|err| format!("Could not read compose metadata: {err}"))
}

fn write_meta(dir: &Path, meta: &StackMeta) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(meta).map_err(|err| err.to_string())?;
    fs::write(meta_path(dir), raw).map_err(|err| format!("Could not save compose: {err}"))
}

fn read_yaml(dir: &Path) -> Result<String, String> {
    fs::read_to_string(compose_path(dir)).map_err(|err| format!("Could not read compose.yml: {err}"))
}

fn write_yaml(dir: &Path, yaml: &str) -> Result<(), String> {
    let body = if yaml.ends_with('\n') {
        yaml.to_string()
    } else {
        format!("{yaml}\n")
    };
    fs::write(compose_path(dir), body).map_err(|err| format!("Could not save compose.yml: {err}"))
}

fn service_key(trimmed: &str) -> Option<String> {
    if trimmed.starts_with('-') {
        return None;
    }
    let (key, _) = trimmed.split_once(':')?;
    let name = key.trim().trim_matches('"').trim_matches('\'').trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

fn list_services(yaml: &str) -> Vec<String> {
    let mut in_services = false;
    let mut names = Vec::new();
    let mut service_indent: Option<usize> = None;
    for line in yaml.lines() {
        if !in_services {
            let heading = line.trim();
            if heading == "services:" || heading.starts_with("services:") {
                in_services = true;
            }
            continue;
        }
        if line.is_empty() {
            continue;
        }
        let trimmed = line.trim_start();
        if trimmed.starts_with('#') {
            continue;
        }
        if !line.starts_with(' ') && !line.starts_with('\t') {
            break;
        }
        let indent = line.len() - trimmed.len();
        let Some(name) = service_key(trimmed) else {
            continue;
        };
        match service_indent {
            None => service_indent = Some(indent),
            Some(expected) if indent != expected => continue,
            Some(_) => {}
        }
        if !names.iter().any(|existing| existing == &name) {
            names.push(name);
        }
    }
    names
}

fn unique_id(root: &Path, name: &str) -> String {
    let base = slugify(name);
    if !root.join(&base).exists() {
        return base;
    }
    for index in 2..1000 {
        let candidate = format!("{base}-{index}");
        if !root.join(&candidate).exists() {
            return candidate;
        }
    }
    format!("{base}-{}", now_secs())
}

fn compose_invocation() -> Result<(PathBuf, Vec<String>), String> {
    let docker = docker_cli().map_err(|_| {
        "Could not find the docker CLI. Install Docker Compose to start compose files.".to_string()
    })?;
    let plugin = Command::new(&docker)
        .args(["compose", "version"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .ok()
        .is_some_and(|status| status.success());
    if plugin {
        return Ok((docker, vec!["compose".into()]));
    }
    if let Some(legacy) = resolve_bin("docker-compose") {
        return Ok((legacy, Vec::new()));
    }
    Err("Docker Compose is not available. Install the compose plugin (`docker compose`).".into())
}

fn compose_fail_message(log: &[String]) -> String {
    let detail = log
        .iter()
        .rev()
        .map(|line| line.trim())
        .find(|line| !line.is_empty())
        .unwrap_or("");
    if detail.is_empty() {
        "docker compose exited with an error.".to_string()
    } else {
        format!("docker compose failed: {detail}")
    }
}

fn emit_and_collect(app: &AppHandle, id: &str, reader: impl BufRead, log: &Mutex<Vec<String>>) {
    for line in reader.lines() {
        let Ok(line) = line else {
            continue;
        };
        let line = line.trim_end().to_string();
        if line.is_empty() {
            continue;
        }
        if let Ok(mut collected) = log.lock() {
            collected.push(line.clone());
        }
        let _ = app.emit(
            "stack-compose",
            ComposeChunk {
                id: id.to_string(),
                line,
            },
        );
    }
}

fn compose_scratch_dir() -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join("dockman-compose-empty");
    fs::create_dir_all(&dir).map_err(|err| format!("Could not prepare compose down: {err}"))?;
    for name in [
        "compose.yml",
        "compose.yaml",
        "docker-compose.yml",
        "docker-compose.yaml",
    ] {
        let _ = fs::remove_file(dir.join(name));
    }
    Ok(dir)
}

fn run_compose(
    app: &AppHandle,
    id: &str,
    project: &str,
    extra: &[&str],
    attach_file: bool,
) -> Result<(), String> {
    let (bin, prefix) = compose_invocation()?;
    let mut args = prefix;
    let cwd = if attach_file {
        let dir = stack_dir(app, id)?;
        let file = compose_path(&dir);
        if !file.is_file() {
            return Err("Compose file is missing.".into());
        }
        args.extend(["-f".into(), file.to_string_lossy().into_owned()]);
        args.extend(["-p".into(), project.to_string()]);
        dir
    } else {
        args.extend(["-p".into(), project.to_string()]);
        compose_scratch_dir()?
    };
    args.extend(extra.iter().map(|part| (*part).to_string()));

    let mut child = Command::new(&bin)
        .args(&args)
        .current_dir(&cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("COMPOSE_INTERACTIVE_NO_CLI", "1")
        .env("DOCKER_CLI_HINTS", "false")
        .spawn()
        .map_err(|err| format!("Could not run docker compose: {err}"))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let log = Mutex::new(Vec::new());
    std::thread::scope(|scope| {
        if let Some(stdout) = stdout {
            scope.spawn(|| emit_and_collect(app, id, BufReader::new(stdout), &log));
        }
        if let Some(stderr) = stderr {
            scope.spawn(|| emit_and_collect(app, id, BufReader::new(stderr), &log));
        }
    });

    let status = child
        .wait()
        .map_err(|err| format!("docker compose failed: {err}"))?;
    let collected = log.into_inner().unwrap_or_default();
    if !status.success() {
        return Err(compose_fail_message(&collected));
    }
    Ok(())
}

async fn compose_job<F>(job: F) -> Result<(), String>
where
    F: FnOnce() -> Result<(), String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|err| format!("docker compose failed: {err}"))?
}

fn push_known_project(projects: &mut Vec<String>, project: &str) {
    if !projects.iter().any(|existing| existing == project) {
        projects.push(project.to_string());
    }
}

fn drop_known_project(projects: &mut Vec<String>, last_project: &mut Option<String>, project: &str) {
    projects.retain(|existing| existing != project);
    if last_project.as_deref() == Some(project) {
        *last_project = projects.first().cloned();
    }
}

fn remember_project(dir: &Path, project: &str) -> Result<(), String> {
    let mut meta = read_meta(dir)?;
    meta.last_project = Some(project.to_string());
    push_known_project(&mut meta.projects, project);
    meta.updated_at = now_secs();
    write_meta(dir, &meta)
}

fn forget_project(dir: &Path, project: &str) -> Result<(), String> {
    let mut meta = read_meta(dir)?;
    drop_known_project(&mut meta.projects, &mut meta.last_project, project);
    meta.updated_at = now_secs();
    write_meta(dir, &meta)
}

#[tauri::command]
pub fn compose_available() -> bool {
    compose_invocation().is_ok()
}

#[tauri::command]
pub fn stack_list(app: AppHandle) -> Result<Vec<StackRow>, String> {
    let root = stacks_root(&app)?;
    let mut rows = Vec::new();
    let entries = fs::read_dir(&root).map_err(|err| format!("Could not list compose files: {err}"))?;
    for entry in entries {
        let entry = entry.map_err(|err| err.to_string())?;
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let Some(id) = entry.file_name().to_str().map(ToString::to_string) else {
            continue;
        };
        if !is_slug(&id) || !compose_path(&dir).is_file() {
            continue;
        }
        let meta = match read_meta(&dir) {
            Ok(meta) => meta,
            Err(_) => continue,
        };
        let yaml = read_yaml(&dir).unwrap_or_default();
        let services = list_services(&yaml);
        rows.push(StackRow {
            id,
            name: meta.name,
            service_count: services.len() as u32,
            services,
            updated_at: meta.updated_at,
            last_project: meta.last_project,
            projects: meta.projects,
        });
    }
    rows.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then(a.name.cmp(&b.name)));
    Ok(rows)
}

#[tauri::command]
pub fn stack_create(app: AppHandle, name: String, yaml: Option<String>) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Compose name is required".into());
    }
    let yaml = yaml
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(EMPTY_COMPOSE);
    let root = stacks_root(&app)?;
    let id = unique_id(&root, name);
    let dir = root.join(&id);
    fs::create_dir_all(&dir).map_err(|err| format!("Could not create compose: {err}"))?;
    write_yaml(&dir, yaml)?;
    write_meta(
        &dir,
        &StackMeta {
            name: name.to_string(),
            updated_at: now_secs(),
            last_project: None,
            projects: Vec::new(),
        },
    )?;
    Ok(id)
}

#[tauri::command]
pub fn stack_read(app: AppHandle, id: String) -> Result<StackDetail, String> {
    let dir = stack_dir(&app, &id)?;
    let meta = read_meta(&dir)?;
    Ok(StackDetail {
        id: parse_id(&id)?,
        name: meta.name,
        yaml: read_yaml(&dir)?,
        updated_at: meta.updated_at,
        last_project: meta.last_project,
        projects: meta.projects,
    })
}

#[tauri::command]
pub fn stack_write(app: AppHandle, id: String, name: String, yaml: String) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Compose name is required".into());
    }
    let dir = stack_dir(&app, &id)?;
    if !dir.is_dir() {
        return Err("Compose not found".into());
    }
    let mut meta = read_meta(&dir)?;
    meta.name = name.to_string();
    meta.updated_at = now_secs();
    write_yaml(&dir, &yaml)?;
    write_meta(&dir, &meta)
}

#[tauri::command]
pub fn stack_delete(app: AppHandle, id: String) -> Result<(), String> {
    let dir = stack_dir(&app, &id)?;
    if !dir.is_dir() {
        return Err("Compose not found".into());
    }
    fs::remove_dir_all(&dir).map_err(|err| format!("Could not delete compose: {err}"))
}

#[tauri::command]
pub async fn stack_up(app: AppHandle, id: String, project: String) -> Result<(), String> {
    let id = parse_id(&id)?;
    let project = parse_project(&project)?;
    let dir = stack_dir(&app, &id)?;
    let job_app = app.clone();
    let job_id = id.clone();
    let job_project = project.clone();
    let result = compose_job(move || run_compose(&job_app, &job_id, &job_project, &["up", "-d"], true)).await;
    let _ = app.emit("stack-compose-end", &id);
    result?;
    remember_project(&dir, &project)
}

fn compose_down_args(volumes: bool) -> &'static [&'static str] {
    if volumes {
        &["down", "-v"]
    } else {
        &["down"]
    }
}

#[tauri::command]
pub async fn stack_down(
    app: AppHandle,
    id: String,
    project: String,
    volumes: bool,
) -> Result<(), String> {
    let id = parse_id(&id)?;
    let project = parse_project(&project)?;
    let dir = stack_dir(&app, &id)?;
    let job_app = app.clone();
    let job_id = id.clone();
    let job_project = project.clone();
    let extra = compose_down_args(volumes);
    let result = compose_job(move || {
        match run_compose(&job_app, &job_id, &job_project, extra, true) {
            Ok(()) => Ok(()),
            Err(first) => {
                let _ = job_app.emit(
                    "stack-compose",
                    ComposeChunk {
                        id: job_id.clone(),
                        line: "Retrying docker compose down by project name…".into(),
                    },
                );
                match run_compose(&job_app, &job_id, &job_project, extra, false) {
                    Ok(()) => Ok(()),
                    Err(_) => Err(first),
                }
            }
        }
    })
    .await;
    let _ = app.emit("stack-compose-end", &id);
    result?;
    forget_project(&dir, &project)
}

#[cfg(test)]
mod tests {
    use super::{
        compose_down_args, compose_fail_message, drop_known_project, list_services, push_known_project,
    };

    #[test]
    fn list_services_reads_two_space_keys() {
        let yaml = "\
services:
  web:
    image: nginx
  db:
    image: postgres
volumes:
  data:
";
        assert_eq!(list_services(yaml), ["web", "db"]);
    }

    #[test]
    fn list_services_skips_comments_and_empty() {
        assert_eq!(
            list_services("services:\n  # note\n\n  api:\n    image: app\n"),
            ["api"]
        );
        assert_eq!(list_services("services: {}\n"), [] as [&str; 0]);
    }

    #[test]
    fn list_services_reads_four_space_and_inline_keys() {
        let yaml = "\
services:
    web: {image: nginx}
    db:
        image: postgres
volumes:
    data:
";
        assert_eq!(list_services(yaml), ["web", "db"]);
    }

    #[test]
    fn push_known_project_dedupes() {
        let mut projects = vec!["blog".into()];
        push_known_project(&mut projects, "blog");
        push_known_project(&mut projects, "staging");
        assert_eq!(projects, ["blog", "staging"]);
    }

    #[test]
    fn drop_known_project_removes_and_picks_next_last() {
        let mut projects = vec!["blog".into(), "staging".into()];
        let mut last = Some("blog".into());
        drop_known_project(&mut projects, &mut last, "blog");
        assert_eq!(projects, ["staging"]);
        assert_eq!(last.as_deref(), Some("staging"));
    }

    #[test]
    fn drop_known_project_clears_last_when_empty() {
        let mut projects = vec!["blog".into()];
        let mut last = Some("blog".into());
        drop_known_project(&mut projects, &mut last, "blog");
        assert!(projects.is_empty());
        assert_eq!(last, None);
    }

    #[test]
    fn drop_known_project_keeps_unrelated_last() {
        let mut projects = vec!["blog".into(), "staging".into()];
        let mut last = Some("staging".into());
        drop_known_project(&mut projects, &mut last, "blog");
        assert_eq!(projects, ["staging"]);
        assert_eq!(last.as_deref(), Some("staging"));
    }

    #[test]
    fn compose_down_args_include_volumes_flag() {
        assert_eq!(compose_down_args(false), ["down"]);
        assert_eq!(compose_down_args(true), ["down", "-v"]);
    }

    #[test]
    fn compose_fail_message_uses_last_line() {
        assert_eq!(
            compose_fail_message(&["invalid hostPort: 4000".into()]),
            "docker compose failed: invalid hostPort: 4000"
        );
        assert_eq!(
            compose_fail_message(&[]),
            "docker compose exited with an error."
        );
    }
}
