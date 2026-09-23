use std::collections::HashMap;

use bollard::query_parameters::EventsOptionsBuilder;
use futures_util::StreamExt;
use serde::Serialize;

use super::shared::{docker, map_err};

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

#[derive(Serialize)]
pub struct DiskUsageKind {
    pub size: i64,
    pub reclaimable: i64,
}

#[derive(Serialize)]
pub struct DiskUsage {
    pub images: DiskUsageKind,
    pub containers: DiskUsageKind,
    pub volumes: DiskUsageKind,
}

fn disk_kind(size: Option<i64>, reclaimable: Option<i64>) -> DiskUsageKind {
    DiskUsageKind {
        size: size.unwrap_or(0),
        reclaimable: reclaimable.unwrap_or(0),
    }
}

#[tauri::command]
pub async fn system_df() -> Result<DiskUsage, String> {
    let usage = docker()?
        .df(None::<bollard::query_parameters::DataUsageOptions>)
        .await
        .map_err(map_err)?;
    let images = usage.image_usage.as_ref();
    let containers = usage.container_usage.as_ref();
    let volumes = usage.volume_usage.as_ref();
    Ok(DiskUsage {
        images: disk_kind(
            images.and_then(|row| row.total_size),
            images.and_then(|row| row.reclaimable),
        ),
        containers: disk_kind(
            containers.and_then(|row| row.total_size),
            containers.and_then(|row| row.reclaimable),
        ),
        volumes: disk_kind(
            volumes.and_then(|row| row.total_size),
            volumes.and_then(|row| row.reclaimable),
        ),
    })
}

#[derive(Serialize)]
pub struct EngineEvent {
    #[serde(rename = "type")]
    pub typ: String,
    pub action: String,
    pub actor_id: String,
    pub actor_name: String,
    pub time: i64,
}

#[tauri::command]
pub async fn engine_events(since: Option<i64>) -> Result<Vec<EngineEvent>, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|err| err.to_string())?
        .as_secs() as i64;
    let since = since.filter(|value| *value > 0).unwrap_or(now.saturating_sub(300));
    let until = now.max(since);
    let mut filters = HashMap::new();
    filters.insert(
        "type",
        vec!["container", "image", "volume", "network"],
    );
    let docker = docker()?;
    let mut stream = docker.events(Some(
        EventsOptionsBuilder::default()
            .since(&since.to_string())
            .until(&until.to_string())
            .filters(&filters)
            .build(),
    ));
    let mut rows = Vec::new();
    while let Some(item) = stream.next().await {
        let event = item.map_err(map_err)?;
        let actor = event.actor.unwrap_or_default();
        let actor_name = actor
            .attributes
            .as_ref()
            .and_then(|attrs| attrs.get("name").cloned())
            .unwrap_or_default();
        rows.push(EngineEvent {
            typ: event.typ.map(|value| value.to_string()).unwrap_or_default(),
            action: event.action.unwrap_or_default(),
            actor_id: actor.id.unwrap_or_default(),
            actor_name,
            time: event.time.unwrap_or(0),
        });
        if rows.len() >= 100 {
            break;
        }
    }
    Ok(rows)
}

