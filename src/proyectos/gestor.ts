import { t } from "../i18n";
import { app } from "../estado";
import type { Lienzo } from "../lienzo/lienzo";
import { ARCHIVO_PORTADA, listarProyectos, ProyectoAbierto } from "./proyecto";
import type { FichaCliente, ModeloCuerpo } from "./modelo";
import { enTauri, sistemaArchivos } from "./sistema-archivos";
import { empaquetarProyecto, EXTENSION, importarPaquete } from "./paquete";
import { guardarExportacion } from "../exportar/guardar";

/**
 * Operaciones de proyecto que afectan a toda la aplicación: abrir, crear, añadir y quitar
 * lienzos, manteniendo sincronizados el proyecto, el visor 3D y las pestañas.
 */
const CLAVE_ULTIMO = "dermap.ultimoProyecto";

let alCambiarArbol: ((e: Event) => void) | null = null;

export async function proyectos() {
  return listarProyectos(await sistemaArchivos());
}

export async function abrirProyecto(carpeta: string, progreso?: (t: string) => void): Promise<ProyectoAbierto> {
  await cerrarProyecto();
  const p = await ProyectoAbierto.abrir(await sistemaArchivos(), carpeta, progreso);
  activar(p);
  return p;
}

export async function crearProyecto(nombre: string): Promise<ProyectoAbierto> {
  await cerrarProyecto();
  const p = await ProyectoAbierto.crear(await sistemaArchivos(), nombre);
  activar(p);
  return p;
}

/** Proyecto nuevo con la ficha del cliente y el cuerpo ya definidos (pantalla de inicio). */
export async function crearProyectoCompleto(
  nombre: string,
  ficha: Partial<Omit<FichaCliente, "creado" | "modificado">>,
  modelo: Partial<ModeloCuerpo>,
): Promise<ProyectoAbierto> {
  await cerrarProyecto();
  const p = await ProyectoAbierto.crear(await sistemaArchivos(), nombre);
  p.cambiarFicha(ficha);
  p.cambiarModelo(modelo);
  await p.guardar();
  activar(p);
  return p;
}

/** Guarda la imagen de portada (vista 3D) del proyecto abierto. */
export async function guardarPortada(bytes: Uint8Array): Promise<void> {
  const p = app.proyecto;
  if (!p) return;
  await p.fs.escribirBinario(`${p.carpeta}/${ARCHIVO_PORTADA}`, bytes);
}

/** Lee una imagen del almacén de proyectos como URL para un <img> (o null si no existe). */
export async function urlImagen(ruta: string): Promise<string | null> {
  try {
    const bytes = await (await sistemaArchivos()).leerBinario(ruta);
    return URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/png" }));
  } catch {
    return null;
  }
}

/** Elimina del disco un proyecto que no está abierto (desde la pantalla de inicio). */
export async function eliminarProyecto(carpeta: string): Promise<void> {
  if (app.proyecto?.carpeta === carpeta) {
    await eliminarProyectoActual();
    return;
  }
  await (await sistemaArchivos()).borrar(carpeta);
  try {
    if (localStorage.getItem(CLAVE_ULTIMO) === carpeta) localStorage.removeItem(CLAVE_ULTIMO);
  } catch {
    // Sin almacenamiento local.
  }
}

/** Exporta a .dermap un proyecto de la lista (lo abre si no es el actual). */
export async function exportarProyectoDe(carpeta: string): Promise<string | null> {
  if (app.proyecto?.carpeta === carpeta) await app.proyecto.guardar();
  const bytes = await empaquetarProyecto(await sistemaArchivos(), carpeta);
  const nombre = (await proyectos()).find((p) => p.carpeta === carpeta)?.nombre ?? carpeta;
  return guardarExportacion(bytes, nombre, { descripcion: t("Proyecto de Dermap"), extension: EXTENSION, mime: "application/zip" });
}

/** Guarda y cierra el proyecto abierto. */
export async function cerrarProyecto(): Promise<void> {
  const p = app.proyecto;
  if (!p) return;
  await p.guardar();
  if (alCambiarArbol) p.removeEventListener("arbol", alCambiarArbol);
  p.cerrar();
  app.fijarProyecto(null, []);
}

/**
 * Elimina del disco el proyecto abierto, con todos sus lienzos (RF-01). No se puede
 * deshacer: el panel pide confirmación antes.
 */
export async function eliminarProyectoActual(): Promise<string | null> {
  const p = app.proyecto;
  if (!p) return null;
  const { carpeta, nombre } = p;
  if (alCambiarArbol) p.removeEventListener("arbol", alCambiarArbol);
  p.cerrar();
  app.fijarProyecto(null, []);
  await (await sistemaArchivos()).borrar(carpeta);
  try {
    if (localStorage.getItem(CLAVE_ULTIMO) === carpeta) localStorage.removeItem(CLAVE_ULTIMO);
  } catch {
    // Sin almacenamiento local.
  }
  return nombre;
}

/** Proyecto abierto o, si no hay ninguno, uno nuevo «Sin título». */
export async function asegurarProyecto(): Promise<ProyectoAbierto> {
  if (app.proyecto) return app.proyecto;
  const existentes = new Set((await proyectos()).map((p) => p.nombre));
  let nombre = t("Sin título");
  for (let n = 2; existentes.has(nombre); n++) nombre = t("Sin título {n}", { n });
  return crearProyecto(nombre);
}

export async function añadirLienzo(lienzo: Lienzo): Promise<void> {
  const p = await asegurarProyecto();
  await p.añadirLienzo(lienzo);
  app.actualizarLienzos(p.ordenDeDibujo());
  app.abrir(lienzo);
}

export async function duplicarLienzo(id: string): Promise<void> {
  const p = app.proyecto;
  const copia = p && (await p.duplicarLienzo(id));
  if (!p || !copia) return;
  app.actualizarLienzos(p.ordenDeDibujo());
  app.abrir(copia);
}

export async function eliminarNodo(id: string): Promise<void> {
  const p = app.proyecto;
  if (!p) return;
  await p.eliminar(id);
  app.actualizarLienzos(p.ordenDeDibujo());
}

/** Al arrancar se abre el último proyecto usado, si sigue existiendo. */
export async function abrirUltimo(progreso?: (t: string) => void): Promise<void> {
  let ultimo: string | null = null;
  try {
    ultimo = localStorage.getItem(CLAVE_ULTIMO);
  } catch {
    // Sin almacenamiento local.
  }
  if (!ultimo) return;
  const lista = await proyectos();
  if (lista.some((p) => p.carpeta === ultimo)) await abrirProyecto(ultimo, progreso);
}

function activar(p: ProyectoAbierto): void {
  alCambiarArbol = (e) => {
    if ((e as CustomEvent<{ afectaDibujo: boolean }>).detail.afectaDibujo) app.actualizarLienzos(p.ordenDeDibujo());
  };
  p.addEventListener("arbol", alCambiarArbol);
  const orden = p.ordenDeDibujo();
  app.fijarProyecto(p, orden);
  // Se abre el último lienzo del árbol para que el panel de dibujo no aparezca vacío.
  const ultimo = orden[orden.length - 1];
  if (ultimo) app.abrir(ultimo);
  try {
    localStorage.setItem(CLAVE_ULTIMO, p.carpeta);
  } catch {
    // Sin almacenamiento local: simplemente no se recuerda.
  }
}

/**
 * Guarda el proyecto abierto en un solo archivo .dermap (RF-53). Devuelve la ruta elegida,
 * o null si se canceló.
 */
export async function exportarProyecto(): Promise<string | null> {
  const p = app.proyecto;
  if (!p) return null;
  await p.guardar();
  const bytes = await empaquetarProyecto(await sistemaArchivos(), p.carpeta);
  return guardarExportacion(bytes, p.datos.nombre, {
    descripcion: t("Proyecto de Dermap"),
    extension: EXTENSION,
    mime: "application/zip",
  });
}

/**
 * Pide un archivo .dermap, lo importa como proyecto nuevo y lo abre. Devuelve false si
 * se canceló.
 */
export async function importarProyecto(progreso?: (t: string) => void): Promise<boolean> {
  const bytes = await elegirArchivoDermap();
  if (!bytes) return false;
  progreso?.(t("Importando proyecto…"));
  const carpeta = await importarPaquete(await sistemaArchivos(), bytes);
  await abrirProyecto(carpeta, progreso);
  return true;
}

async function elegirArchivoDermap(): Promise<Uint8Array | null> {
  if (enTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const ruta = await open({ multiple: false, directory: false, filters: [{ name: t("Proyecto de Dermap"), extensions: [EXTENSION] }] });
    // El plugin de diálogos añade el archivo elegido a los permisos de lectura.
    return typeof ruta === "string" ? readFile(ruta) : null;
  }
  return new Promise((resolver) => {
    const entrada = document.createElement("input");
    entrada.type = "file";
    entrada.accept = `.${EXTENSION},application/zip`;
    entrada.addEventListener("change", async () => {
      const archivo = entrada.files?.[0];
      resolver(archivo ? new Uint8Array(await archivo.arrayBuffer()) : null);
    });
    entrada.addEventListener("cancel", () => resolver(null));
    entrada.click();
  });
}

/**
 * Abre un archivo .dermap por su ruta (doble clic en el archivo con la aplicación instalada):
 * se importa como proyecto nuevo, igual que con «Importar…».
 */
export async function importarDesdeRuta(ruta: string, progreso?: (t: string) => void): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  progreso?.(t("Importando proyecto…"));
  const bytes = new Uint8Array(await invoke<ArrayBuffer>("leer_dermap", { ruta }));
  const carpeta = await importarPaquete(await sistemaArchivos(), bytes);
  await abrirProyecto(carpeta, progreso);
}

/** Si la aplicación se abrió con un archivo .dermap, lo importa (Windows, Linux y macOS). */
export async function abrirArchivoInicial(progreso?: (t: string) => void): Promise<void> {
  if (!enTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const abrir = (ruta: string) =>
    importarDesdeRuta(ruta, progreso).catch((error) => console.error("No se pudo abrir el archivo .dermap", error));
  // macOS avisa con un evento si el archivo llega con la aplicación ya abierta.
  await listen<string>("abrir-dermap", () => {
    void invoke<string | null>("archivo_al_abrir").then((ruta) => {
      if (ruta) void abrir(ruta);
    });
  });
  const ruta = await invoke<string | null>("archivo_al_abrir");
  if (ruta) await abrir(ruta);
}
