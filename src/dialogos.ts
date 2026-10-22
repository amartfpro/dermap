import { t } from "./i18n";
import { enTauri } from "./proyectos/sistema-archivos";

/**
 * Diálogos de confirmación y aviso. En la aplicación de escritorio usan los diálogos nativos
 * (plugin de Tauri): window.confirm no está garantizado en todas las WebViews.
 */
export async function confirmar(mensaje: string, titulo = "Dermap"): Promise<boolean> {
  if (enTauri()) {
    const { confirm } = await import("@tauri-apps/plugin-dialog");
    return confirm(mensaje, { title: titulo, kind: "warning", okLabel: t("Sí"), cancelLabel: t("Cancelar") });
  }
  return window.confirm(mensaje);
}

export async function avisar(mensaje: string, titulo = "Dermap"): Promise<void> {
  if (enTauri()) {
    const { message } = await import("@tauri-apps/plugin-dialog");
    await message(mensaje, { title: titulo });
    return;
  }
  window.alert(mensaje);
}
