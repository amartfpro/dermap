// Dermap: el núcleo de Tauri solo registra los plugins.
// Todo el código propio de la aplicación está en TypeScript (carpeta src/).

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error al iniciar Dermap");
}
