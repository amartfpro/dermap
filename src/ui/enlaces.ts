import { enTauri } from "../proyectos/sistema-archivos";

/** Abre un enlace en el navegador del sistema (en la aplicación de escritorio, fuera de la ventana). */
export async function abrirEnlace(url: string): Promise<void> {
  if (enTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener");
}
