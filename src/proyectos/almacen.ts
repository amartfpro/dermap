import { exists, mkdir, readDir, readTextFile, writeTextFile, rename, BaseDirectory } from "@tauri-apps/plugin-fs";
import { documentDir, join } from "@tauri-apps/api/path";
import { VERSION_FORMATO, type Proyecto } from "./modelo";

/** Carpeta, relativa a Documentos, donde viven todos los proyectos. */
const RAIZ = "Dermap";
const ARCHIVO_PROYECTO = "proyecto.json";
const base = { baseDir: BaseDirectory.Document };

export interface ResumenProyecto {
  nombre: string;
  ruta: string;
}

export function enTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export async function carpetaRaiz(): Promise<string> {
  return join(await documentDir(), RAIZ);
}

async function asegurarRaiz(): Promise<void> {
  if (!(await exists(RAIZ, base))) await mkdir(RAIZ, { ...base, recursive: true });
}

/** Devuelve los proyectos válidos (carpetas con proyecto.json), ordenados por nombre. */
export async function listarProyectos(): Promise<ResumenProyecto[]> {
  await asegurarRaiz();
  const raiz = await carpetaRaiz();
  const entradas = await readDir(RAIZ, base);
  const proyectos: ResumenProyecto[] = [];
  for (const entrada of entradas) {
    if (!entrada.isDirectory) continue;
    const archivo = `${RAIZ}/${entrada.name}/${ARCHIVO_PROYECTO}`;
    if (!(await exists(archivo, base))) continue;
    try {
      const datos = JSON.parse(await readTextFile(archivo, base)) as Proyecto;
      proyectos.push({ nombre: datos.nombre ?? entrada.name, ruta: await join(raiz, entrada.name) });
    } catch {
      // proyecto.json dañado: se omite de la lista en lugar de bloquear la app.
    }
  }
  return proyectos.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

export async function crearProyecto(nombre: string): Promise<void> {
  await asegurarRaiz();
  const carpeta = `${RAIZ}/${nombreDeCarpeta(nombre)}`;
  if (await exists(carpeta, base)) throw new Error(`Ya existe un proyecto llamado «${nombre}».`);
  await mkdir(carpeta, base);

  const ahora = new Date().toISOString();
  const proyecto: Proyecto = {
    version: VERSION_FORMATO,
    id: crypto.randomUUID(),
    nombre,
    ficha: { cliente: nombre, notas: "", creado: ahora, modificado: ahora },
    modelo: { altura: 170, complexion: 0.5, tonoPiel: "#d8a98a", versionMalla: "provisional" },
    arbol: [],
  };
  await escribirSeguro(`${carpeta}/${ARCHIVO_PROYECTO}`, JSON.stringify(proyecto, null, 2));
}

/**
 * Escritura segura: se escribe en un archivo temporal y se renombra al terminar,
 * para no dejar un proyecto a medias si la app se cierra durante el guardado.
 */
async function escribirSeguro(ruta: string, contenido: string): Promise<void> {
  const temporal = `${ruta}.tmp`;
  await writeTextFile(temporal, contenido, base);
  await rename(temporal, ruta, { oldPathBaseDir: BaseDirectory.Document, newPathBaseDir: BaseDirectory.Document });
}

/** Quita los caracteres que Windows y macOS no admiten en nombres de carpeta. */
export function nombreDeCarpeta(nombre: string): string {
  const limpio = nombre.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").replace(/[. ]+$/, "").trim();
  return limpio || "Proyecto";
}
