use bollard::models::VolumeCreateRequest;
use bollard::query_parameters::{ListVolumesOptionsBuilder, RemoveVolumeOptionsBuilder};
use serde::Serialize;

use super::shared::{docker, map_err, resource_usage, used_by_for, UsageRef, PruneResult};

#[derive(Serialize)]
pub struct VolumeRow {
    pub name: String,
    pub driver: String,
    pub mountpoint: String,
    pub created_at: Option<String>,
    pub used_by: Vec<UsageRef>,
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

