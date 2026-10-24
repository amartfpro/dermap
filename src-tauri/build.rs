fn main() {
    // El icono de la ventana y de la barra de tareas (Windows) va dentro del ejecutable: sin
    // esto, al cambiar los iconos `tauri dev` seguiría mostrando los anteriores.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
