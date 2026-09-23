use bollard::models::{NetworkConnectRequest, NetworkCreateRequest, NetworkDisconnectRequest};
use bollard::query_parameters::{InspectNetworkOptionsBuilder, ListNetworksOptionsBuilder};
use serde::Serialize;

use super::shared::{docker, map_err, resource_usage, used_by_for, UsageRef, PruneResult};

#[derive(Serialize)]
pub struct NetworkRow {
    pub id: String,
    pub name: String,
    pub driver: String,
    pub scope: String,
    pub builtin: bool,
    pub used_by: Vec<UsageRef>,
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

#[tauri::command]
pub async fn networks_prune() -> Result<PruneResult, String> {
    let result = docker()?.prune_networks(None).await.map_err(map_err)?;
    Ok(PruneResult {
        deleted: result.networks_deleted.unwrap_or_default().len() as i64,
        space_reclaimed: 0,
    })
}

#[tauri::command]
pub async fn network_connect(network: String, container: String) -> Result<(), String> {
    let network = network.trim().to_string();
    let container = container.trim().to_string();
    if network.is_empty() || container.is_empty() {
        return Err("Network and container are required".into());
    }
    docker()?
        .connect_network(
            &network,
            NetworkConnectRequest {
                container,
                endpoint_config: None,
            },
        )
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn network_disconnect(network: String, container: String) -> Result<(), String> {
    let network = network.trim().to_string();
    let container = container.trim().to_string();
    if network.is_empty() || container.is_empty() {
        return Err("Network and container are required".into());
    }
    docker()?
        .disconnect_network(
            &network,
            NetworkDisconnectRequest {
                container,
                force: None,
            },
        )
        .await
        .map_err(map_err)
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

