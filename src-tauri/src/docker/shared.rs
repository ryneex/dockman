use std::collections::HashMap;
use std::path::{Path, PathBuf};

use bollard::query_parameters::ListContainersOptionsBuilder;
use bollard::Docker;
use serde::Serialize;

#[derive(Clone, Serialize)]
pub struct UsageRef {
    pub id: String,
    pub name: String,
    pub state: String,
}

pub(crate) fn docker() -> Result<Docker, String> {
    Docker::connect_with_local_defaults().map_err(map_err)
}

pub(crate) fn container_name(container: &bollard::models::ContainerSummary) -> String {
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

pub(crate) fn container_state(container: &bollard::models::ContainerSummary) -> String {
    container
        .state
        .map(|state| state.to_string())
        .filter(|state| !state.is_empty())
        .unwrap_or_else(|| "unknown".into())
}

pub(crate) fn compose_label(labels: &Option<HashMap<String, String>>, key: &str) -> Option<String> {
    labels
        .as_ref()?
        .get(key)
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

pub(crate) fn usage_rank(state: &str) -> u8 {
    match state {
        "running" => 0,
        "restarting" => 1,
        _ => 2,
    }
}

pub(crate) fn sort_usage(refs: &mut [UsageRef]) {
    refs.sort_by(|a, b| {
        usage_rank(&a.state)
            .cmp(&usage_rank(&b.state))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
}

pub(crate) fn push_unique(map: &mut HashMap<String, Vec<UsageRef>>, key: String, value: &UsageRef) {
    if key.is_empty() || value.name.is_empty() {
        return;
    }
    let entry = map.entry(key).or_default();
    if !entry.iter().any(|existing| existing.name == value.name) {
        entry.push(value.clone());
    }
}

pub(crate) fn used_by_for(map: &HashMap<String, Vec<UsageRef>>, keys: &[&str]) -> Vec<UsageRef> {
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

pub(crate) fn image_aliases(id: &str) -> Vec<String> {
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

pub(crate) struct ResourceUsage {
    pub(crate) volumes: HashMap<String, Vec<UsageRef>>,
    pub(crate) networks: HashMap<String, Vec<UsageRef>>,
    pub(crate) images: HashMap<String, Vec<UsageRef>>,
}

pub(crate) async fn resource_usage(docker: &Docker) -> Result<ResourceUsage, String> {
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
            id: container.id.clone().unwrap_or_default(),
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

pub(crate) fn map_err(err: impl std::fmt::Display) -> String {
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

pub(crate) fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata()
        .map(|meta| meta.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

pub(crate) fn resolve_bin(name: &str) -> Option<PathBuf> {
    if name.contains('/') {
        let path = PathBuf::from(name);
        return (path.is_file() && is_executable(&path)).then_some(path);
    }
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).find_map(|dir| {
        let candidate = dir.join(name);
        (candidate.is_file() && is_executable(&candidate)).then_some(candidate)
    })
}

pub(crate) fn docker_cli() -> Result<PathBuf, String> {
    resolve_bin("docker")
        .or_else(|| resolve_bin("/usr/bin/docker"))
        .ok_or_else(|| "Could not find the docker CLI. Install docker.".into())
}

pub(crate) fn normalize_image_ref(raw: &str) -> Result<String, String> {
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

#[derive(Serialize)]
pub struct PruneResult {
    pub deleted: i64,
    pub space_reclaimed: i64,
}


#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::compose_label;

    #[test]
    fn compose_label_reads_nonempty_compose_keys() {
        let mut labels = HashMap::new();
        labels.insert("com.docker.compose.project".into(), " web ".into());
        labels.insert("com.docker.compose.service".into(), "".into());
        let labels = Some(labels);
        assert_eq!(
            compose_label(&labels, "com.docker.compose.project").as_deref(),
            Some("web")
        );
        assert_eq!(compose_label(&labels, "com.docker.compose.service"), None);
        assert_eq!(compose_label(&None, "com.docker.compose.project"), None);
    }

}
