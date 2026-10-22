import { app } from "../estado";
import { nombreSeguro } from "../proyectos/formato";
import { enTauri, rutaRaiz, sistemaArchivos } from "../proyectos/sistema-archivos";

/**
 * Guarda un archivo exportado. En la aplicación de escritorio pregunta dónde con el diálogo
 * nativo, proponiendo la carpeta «exportaciones» del proyecto; en el navegador lo descarga.
 * Devuelve la ruta elegida, o null si se canceló.
 */
export async function guardarExportacion(
  bytes: Uint8Array,
  nombre: string,
  tipo: { descripcion: string; extension: string; mime: string },
): Promise<string | null> {
  const archivo = `${nombreSeguro(nombre)}.${tipo.extension}`;
  if (enTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const { join } = await import("@tauri-apps/api/path");
    let ruta = archivo;
    if (app.proyecto) {
      // La carpeta debe existir para que el diálogo la proponga.
      await (await sistemaArchivos()).crearCarpeta(`${app.proyecto.carpeta}/exportaciones`);
      ruta = await join(await rutaRaiz(), app.proyecto.carpeta, "exportaciones", archivo);
    }
    const elegida = await save({ defaultPath: ruta, filters: [{ name: tipo.descripcion, extensions: [tipo.extension] }] });
    if (!elegida) return null;
    // El plugin de diálogos añade la ruta elegida a los permisos de escritura.
    await writeFile(elegida, bytes);
    return elegida;
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: tipo.mime }));
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = archivo;
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return archivo;
}
