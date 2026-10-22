import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { nuevoId } from "../lienzo/capa";
import { nombreSeguro } from "./formato";
import { VERSION_FORMATO, type Proyecto } from "./modelo";
import type { SistemaArchivos } from "./sistema-archivos";

/**
 * Archivo .dermap (RF-53): un proyecto entero en un solo archivo, para copiarlo a otro
 * ordenador o guardarlo como copia de seguridad. Es un ZIP con la carpeta del proyecto tal
 * cual (proyecto.json y las carpetas .lienzo) más un pequeño manifiesto.
 */
export const EXTENSION = "dermap";
const MANIFIESTO = "dermap.json";
const ARCHIVO_PROYECTO = "proyecto.json";
/** Las exportaciones (PDF, PNG) se pueden regenerar: no se incluyen. */
const EXCLUIDAS = new Set(["exportaciones"]);

export async function empaquetarProyecto(fs: SistemaArchivos, carpeta: string): Promise<Uint8Array> {
  const archivos: Zippable = {};
  const recorrer = async (ruta: string, relativa: string) => {
    for (const e of await fs.listar(ruta)) {
      const r = relativa ? `${relativa}/${e.nombre}` : e.nombre;
      if (e.carpeta) {
        if (!relativa && EXCLUIDAS.has(e.nombre)) continue;
        await recorrer(`${ruta}/${e.nombre}`, r);
      } else if (!e.nombre.endsWith(".tmp")) {
        const bytes = await fs.leerBinario(`${ruta}/${e.nombre}`);
        // Los PNG ya van comprimidos: se guardan tal cual, que es mucho más rápido.
        archivos[r] = [bytes, { level: /\.(png|jpe?g)$/i.test(e.nombre) ? 0 : 6 }];
      }
    }
  };
  await recorrer(carpeta, "");
  if (!archivos[ARCHIVO_PROYECTO]) throw new Error("La carpeta no contiene un proyecto de Dermap.");
  archivos[MANIFIESTO] = strToU8(JSON.stringify({ formato: "dermap", version: VERSION_FORMATO, creado: new Date().toISOString() }));
  return zipSync(archivos);
}

/**
 * Crea un proyecto nuevo a partir de un archivo .dermap y devuelve su carpeta. Nunca
 * sobrescribe: si ya existe un proyecto con ese nombre, la copia importada se renombra.
 */
export async function importarPaquete(fs: SistemaArchivos, bytes: Uint8Array): Promise<string> {
  let entradas: Record<string, Uint8Array>;
  try {
    entradas = unzipSync(bytes);
  } catch {
    throw new Error("El archivo no es un proyecto de Dermap válido (no se puede leer).");
  }
  // Admite también un ZIP hecho a mano con la carpeta del proyecto dentro.
  let prefijo = "";
  if (!entradas[ARCHIVO_PROYECTO]) {
    const anidado = Object.keys(entradas).find((r) => /^[^/]+\/proyecto\.json$/.test(r));
    if (!anidado) throw new Error("El archivo no contiene un proyecto de Dermap.");
    prefijo = anidado.slice(0, anidado.indexOf("/") + 1);
  }
  const datos = JSON.parse(strFromU8(entradas[`${prefijo}${ARCHIVO_PROYECTO}`])) as Proyecto;
  if (typeof datos.version !== "number" || !Array.isArray(datos.arbol))
    throw new Error("El proyecto.json del archivo está dañado.");
  if (datos.version > VERSION_FORMATO)
    throw new Error("Este proyecto se creó con una versión más reciente de Dermap. Actualiza la aplicación.");

  const base = nombreSeguro(datos.nombre || "Proyecto importado");
  let carpeta = base;
  for (let n = 2; await fs.existe(carpeta); n++) carpeta = `${base} (${n})`;
  if (carpeta !== base) datos.nombre = `${datos.nombre} (${carpeta.slice(base.length + 2, -1)})`;
  datos.id = nuevoId();

  await fs.crearCarpeta(carpeta);
  const carpetasCreadas = new Set<string>();
  for (const [ruta, contenido] of Object.entries(entradas)) {
    if (!ruta.startsWith(prefijo) || ruta.endsWith("/")) continue;
    const relativa = ruta.slice(prefijo.length);
    if (relativa === MANIFIESTO || relativa === ARCHIVO_PROYECTO) continue;
    const partes = relativa.split("/");
    // Rutas seguras: nada de «..», rutas absolutas ni separadores de Windows.
    if (partes.some((p) => !p || p === "." || p === "..") || relativa.includes("\\") || relativa.includes(":")) continue;
    const dir = partes.slice(0, -1).join("/");
    if (dir && !carpetasCreadas.has(dir)) {
      await fs.crearCarpeta(`${carpeta}/${dir}`);
      carpetasCreadas.add(dir);
    }
    await fs.escribirBinario(`${carpeta}/${relativa}`, contenido);
  }
  // proyecto.json al final: si la importación se interrumpe, la carpeta no parece un proyecto.
  await fs.escribirTexto(`${carpeta}/${ARCHIVO_PROYECTO}`, JSON.stringify(datos, null, 2));
  return carpeta;
}
