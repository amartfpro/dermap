// Dermap: el núcleo de Tauri registra los plugins y abre los archivos .dermap con los que se
// lanza la aplicación (doble clic en el archivo). Todo lo demás está en TypeScript (src/).

use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Archivo .dermap con el que se abrió la aplicación, hasta que la interfaz lo recoge.
struct ArchivoPendiente(Mutex<Option<PathBuf>>);

fn es_dermap(ruta: &Path) -> bool {
    ruta.extension().is_some_and(|e| e.eq_ignore_ascii_case("dermap"))
}

/// Devuelve (una sola vez) el archivo .dermap con el que se abrió la aplicación.
#[tauri::command]
fn archivo_al_abrir(estado: tauri::State<ArchivoPendiente>) -> Option<String> {
    estado.0.lock().ok()?.take().map(|p| p.to_string_lossy().into_owned())
}

/// Lee un archivo .dermap elegido fuera de la carpeta de proyectos (solo esa extensión).
#[tauri::command]
fn leer_dermap(ruta: String) -> Result<tauri::ipc::Response, String> {
    let ruta = PathBuf::from(ruta);
    if !es_dermap(&ruta) {
        return Err("No es un archivo .dermap".into());
    }
    std::fs::read(&ruta).map(tauri::ipc::Response::new).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Windows y Linux pasan el archivo como argumento.
    let inicial = std::env::args().skip(1).map(PathBuf::from).find(|p| es_dermap(p));
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ArchivoPendiente(Mutex::new(inicial)))
        .invoke_handler(tauri::generate_handler![archivo_al_abrir, leer_dermap])
        .build(tauri::generate_context!())
        .expect("error al iniciar Dermap")
        .run(|_app, _evento| {
            // macOS entrega el archivo con un evento en vez de un argumento.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _evento {
                use tauri::{Emitter, Manager};
                for url in urls {
                    if let Ok(ruta) = url.to_file_path() {
                        if es_dermap(&ruta) {
                            if let Ok(mut p) = _app.state::<ArchivoPendiente>().0.lock() {
                                *p = Some(ruta.clone());
                            }
                            let _ = _app.emit("abrir-dermap", ruta.to_string_lossy().into_owned());
                        }
                    }
                }
            }
        });
}
