/**
 * Acceso a los archivos de los proyectos. Rutas relativas a la carpeta raíz de Dermap, con «/».
 *
 *  - En la aplicación de escritorio (Tauri): Documentos/Dermap, con el plugin de archivos.
 *  - En el navegador (desarrollo y pruebas): IndexedDB, para que todo funcione igual sin Tauri.
 */
export interface SistemaArchivos {
  /** Si cada escritura ya es atómica (no hace falta escribir en un temporal y renombrar). */
  readonly escrituraAtomica: boolean;
  /** Descripción de dónde se guardan los proyectos, para mostrarla al usuario. */
  descripcion(): Promise<string>;
  existe(ruta: string): Promise<boolean>;
  leerTexto(ruta: string): Promise<string>;
  escribirTexto(ruta: string, texto: string): Promise<void>;
  leerBinario(ruta: string): Promise<Uint8Array>;
  escribirBinario(ruta: string, datos: Uint8Array): Promise<void>;
  listar(ruta: string): Promise<{ nombre: string; carpeta: boolean }[]>;
  crearCarpeta(ruta: string): Promise<void>;
  borrar(ruta: string): Promise<void>;
  renombrar(de: string, a: string): Promise<void>;
}

export function enTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

let instancia: Promise<SistemaArchivos> | null = null;

/** Sistema de archivos de la plataforma actual. */
export function sistemaArchivos(): Promise<SistemaArchivos> {
  instancia ??= enTauri() ? crearTauri() : Promise.resolve(new ArchivosNavegador());
  return instancia;
}

/** Escritura segura: a un temporal y renombrado, para no dejar un archivo a medias. */
export async function escribirTextoSeguro(fs: SistemaArchivos, ruta: string, texto: string): Promise<void> {
  if (fs.escrituraAtomica) return fs.escribirTexto(ruta, texto);
  const temporal = `${ruta}.tmp`;
  await fs.escribirTexto(temporal, texto);
  if (await fs.existe(ruta)) await fs.borrar(ruta);
  await fs.renombrar(temporal, ruta);
}

// ── Tauri ────────────────────────────────────────────────────────────────────────

const RAIZ = "Dermap";

async function crearTauri(): Promise<SistemaArchivos> {
  const fs = await import("@tauri-apps/plugin-fs");
  const { documentDir, join } = await import("@tauri-apps/api/path");
  const base = { baseDir: fs.BaseDirectory.Document };
  const r = (ruta: string) => (ruta ? `${RAIZ}/${ruta}` : RAIZ);
  if (!(await fs.exists(RAIZ, base))) await fs.mkdir(RAIZ, { ...base, recursive: true });
  return {
    escrituraAtomica: false,
    descripcion: async () => join(await documentDir(), RAIZ),
    existe: (ruta) => fs.exists(r(ruta), base),
    leerTexto: (ruta) => fs.readTextFile(r(ruta), base),
    escribirTexto: (ruta, texto) => fs.writeTextFile(r(ruta), texto, base),
    leerBinario: (ruta) => fs.readFile(r(ruta), base),
    escribirBinario: (ruta, datos) => fs.writeFile(r(ruta), datos, base),
    listar: async (ruta) =>
      (await fs.readDir(r(ruta), base)).map((e) => ({ nombre: e.name, carpeta: e.isDirectory })),
    crearCarpeta: (ruta) => fs.mkdir(r(ruta), { ...base, recursive: true }),
    borrar: (ruta) => fs.remove(r(ruta), { ...base, recursive: true }),
    renombrar: (de, a) =>
      fs.rename(r(de), r(a), { oldPathBaseDir: fs.BaseDirectory.Document, newPathBaseDir: fs.BaseDirectory.Document }),
  };
}

// ── Navegador (IndexedDB) ────────────────────────────────────────────────────────

type Entrada = { tipo: "carpeta" } | { tipo: "archivo"; datos: Uint8Array };

class ArchivosNavegador implements SistemaArchivos {
  readonly escrituraAtomica = true;
  private db: Promise<IDBDatabase>;

  constructor() {
    this.db = new Promise((resolver, rechazar) => {
      const peticion = indexedDB.open("dermap", 1);
      peticion.onupgradeneeded = () => peticion.result.createObjectStore("archivos");
      peticion.onsuccess = () => resolver(peticion.result);
      peticion.onerror = () => rechazar(peticion.error);
    });
  }

  private async almacen(modo: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await this.db).transaction("archivos", modo).objectStore("archivos");
  }

  private async obtener(ruta: string): Promise<Entrada | undefined> {
    const a = await this.almacen("readonly");
    return pedir<Entrada | undefined>(a.get(ruta));
  }

  private async poner(ruta: string, entrada: Entrada): Promise<void> {
    // Crea las carpetas intermedias, como haría un sistema de archivos.
    const partes = ruta.split("/");
    const a = await this.almacen("readwrite");
    for (let i = 1; i < partes.length; i++) a.put({ tipo: "carpeta" }, partes.slice(0, i).join("/"));
    await pedir(a.put(entrada, ruta));
  }

  async descripcion(): Promise<string> {
    return "el almacenamiento del navegador";
  }

  async existe(ruta: string): Promise<boolean> {
    return (await this.obtener(ruta)) !== undefined;
  }

  async leerTexto(ruta: string): Promise<string> {
    return new TextDecoder().decode(await this.leerBinario(ruta));
  }

  async escribirTexto(ruta: string, texto: string): Promise<void> {
    await this.escribirBinario(ruta, new TextEncoder().encode(texto));
  }

  async leerBinario(ruta: string): Promise<Uint8Array> {
    const e = await this.obtener(ruta);
    if (!e || e.tipo !== "archivo") throw new Error(`No existe el archivo ${ruta}`);
    return e.datos;
  }

  async escribirBinario(ruta: string, datos: Uint8Array): Promise<void> {
    await this.poner(ruta, { tipo: "archivo", datos });
  }

  async listar(ruta: string): Promise<{ nombre: string; carpeta: boolean }[]> {
    const prefijo = ruta ? `${ruta}/` : "";
    const a = await this.almacen("readonly");
    const rango = prefijo ? IDBKeyRange.bound(prefijo, `${prefijo}\uffff`) : undefined;
    const [claves, valores] = await Promise.all([
      pedir<IDBValidKey[]>(a.getAllKeys(rango)),
      pedir<Entrada[]>(a.getAll(rango)),
    ]);
    const resultado: { nombre: string; carpeta: boolean }[] = [];
    (claves as string[]).forEach((clave, i) => {
      const resto = clave.slice(prefijo.length);
      if (resto && !resto.includes("/")) resultado.push({ nombre: resto, carpeta: valores[i].tipo === "carpeta" });
    });
    return resultado;
  }

  async crearCarpeta(ruta: string): Promise<void> {
    await this.poner(ruta, { tipo: "carpeta" });
  }

  async borrar(ruta: string): Promise<void> {
    const a = await this.almacen("readwrite");
    a.delete(ruta);
    a.delete(IDBKeyRange.bound(`${ruta}/`, `${ruta}/\uffff`));
    await fin(a.transaction);
  }

  async renombrar(de: string, a: string): Promise<void> {
    const almacen = await this.almacen("readwrite");
    const rango = IDBKeyRange.bound(`${de}/`, `${de}/\uffff`);
    const [propia, claves, valores] = await Promise.all([
      pedir<Entrada | undefined>(almacen.get(de)),
      pedir<IDBValidKey[]>(almacen.getAllKeys(rango)),
      pedir<Entrada[]>(almacen.getAll(rango)),
    ]);
    if (propia) {
      almacen.put(propia, a);
      almacen.delete(de);
    }
    (claves as string[]).forEach((clave, i) => almacen.put(valores[i], a + clave.slice(de.length)));
    almacen.delete(rango);
    await fin(almacen.transaction);
  }
}

function fin(t: IDBTransaction): Promise<void> {
  return new Promise((resolver, rechazar) => {
    t.oncomplete = () => resolver();
    t.onerror = () => rechazar(t.error);
    t.onabort = () => rechazar(t.error);
  });
}

function pedir<T>(peticion: IDBRequest): Promise<T> {
  return new Promise((resolver, rechazar) => {
    peticion.onsuccess = () => resolver(peticion.result as T);
    peticion.onerror = () => rechazar(peticion.error);
  });
}
