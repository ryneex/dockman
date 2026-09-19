mod docker;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(docker::LogHub::default())
        .invoke_handler(tauri::generate_handler![
            docker::engine_info,
            docker::list_containers,
            docker::container_start,
            docker::container_stop,
            docker::container_restart,
            docker::container_remove,
            docker::container_inspect,
            docker::container_logs,
            docker::container_logs_stop,
            docker::list_images,
            docker::image_inspect,
            docker::image_remove,
            docker::list_volumes,
            docker::volume_inspect,
            docker::volume_remove,
            docker::list_networks,
            docker::network_inspect,
            docker::network_remove,
            docker::image_pull,
            docker::image_search,
            docker::container_create,
            docker::volume_create,
            docker::network_create,
            docker::container_fs_list,
            docker::container_fs_read,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
