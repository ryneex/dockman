use std::collections::HashMap;
use std::io::Write;

use bollard::body_full;
use bollard::query_parameters::{
    CreateImageOptionsBuilder, ImportImageOptionsBuilder, ListImagesOptionsBuilder,
    PruneImagesOptionsBuilder, RemoveImageOptionsBuilder, SearchImagesOptionsBuilder,
    TagImageOptionsBuilder,
};
use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::shared::{
    docker, image_aliases, map_err, normalize_image_ref, resource_usage, used_by_for, UsageRef,
    PruneResult,
};

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

#[derive(Clone, Serialize)]
pub struct PullChunk {
    pub id: String,
    pub line: String,
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
pub async fn image_tag(id_or_name: String, repo: String, tag: Option<String>) -> Result<(), String> {
    let id_or_name = id_or_name.trim().to_string();
    let repo = repo.trim().to_string();
    if id_or_name.is_empty() || repo.is_empty() {
        return Err("Image and repository are required".into());
    }
    let tag = tag
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("latest");
    docker()?
        .tag_image(
            &id_or_name,
            Some(
                TagImageOptionsBuilder::default()
                    .repo(&repo)
                    .tag(tag)
                    .build(),
            ),
        )
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn image_save(id_or_name: String, dest_path: String) -> Result<(), String> {
    let id_or_name = id_or_name.trim().to_string();
    let dest_path = dest_path.trim().to_string();
    if id_or_name.is_empty() {
        return Err("Image is required".into());
    }
    if dest_path.is_empty() {
        return Err("Destination path is required".into());
    }
    let mut file = std::fs::File::create(&dest_path).map_err(|err| err.to_string())?;
    let mut stream = docker()?.export_image(&id_or_name);
    while let Some(chunk) = stream.next().await {
        file.write_all(&chunk.map_err(map_err)?)
            .map_err(|err| err.to_string())?;
    }
    file.flush().map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn image_load(src_path: String) -> Result<(), String> {
    let src_path = src_path.trim().to_string();
    if src_path.is_empty() {
        return Err("Source path is required".into());
    }
    let bytes = std::fs::read(&src_path).map_err(|err| err.to_string())?;
    let mut stream = docker()?.import_image(
        ImportImageOptionsBuilder::default().build(),
        body_full(bytes.into()),
        None,
    );
    while let Some(item) = stream.next().await {
        let info = item.map_err(map_err)?;
        if let Some(message) = info.error_detail.and_then(|detail| detail.message) {
            return Err(message);
        }
    }
    Ok(())
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
