import { t } from "../i18n";
import { Capa, nuevoId, type ModoFusion } from "../lienzo/capa";
import { aBlob, DocumentoLienzo } from "../lienzo/documento";
import { PPP, PX_POR_MM } from "../lienzo/geometria-zona";
import { Lienzo } from "../lienzo/lienzo";
import { contexto, crearLamina, desdeClave } from "../lienzo/teselas";
import { desempaquetarZona, empaquetarZona, nombreSeguro } from "./formato";
import {
  VERSION_FORMATO,
  type DatosLienzo,
  type NodoArbol,
  type NodoCarpeta,
  type NodoLienzo,
  type Proyecto,
  type ModeloCuerpo,
  type FichaCliente,
} from "./modelo";
import { escribirTextoSeguro, type SistemaArchivos } from "./sistema-archivos";

const ARCHIVO_PROYECTO = "proyecto.json";
/** Vista 3D del proyecto guardada al cerrarlo, para la pantalla de inicio. */
export const ARCHIVO_PORTADA = "portada.png";
/** Guardado automático: tras unos segundos sin cambios, y como mucho cada 2 minutos (RNF-11). */
const ESPERA_GUARDADO_MS = 10_000;
const MAXIMO_SIN_GUARDAR_MS = 120_000;

export type EstadoGuardado = "guardado" | "pendiente" | "guardando" | "error";

export interface ResumenProyecto {
  carpeta: string;
  nombre: string;
  cliente: string;
  /** Fecha ISO de la última modificación. */
  modificado: string;
  lienzos: number;
  /** Imagen de portada (vista 3D al cerrar) o, si no hay, miniatura del primer lienzo. */
  portada: string | null;
}

/** Proyectos (carpetas con proyecto.json) de la raíz, ordenados por nombre. */
export async function listarProyectos(fs: SistemaArchivos): Promise<ResumenProyecto[]> {
  const resultado: ResumenProyecto[] = [];
  for (const e of await fs.listar("")) {
    if (!e.carpeta) continue;
    try {
      const datos = JSON.parse(await fs.leerTexto(`${e.nombre}/${ARCHIVO_PROYECTO}`)) as Proyecto;
      const lienzos: NodoLienzo[] = [];
      const recorrer = (l: NodoArbol[]) => l.forEach((n) => (n.tipo === "lienzo" ? lienzos.push(n) : recorrer(n.hijos)));
      recorrer(datos.arbol ?? []);
      let portada: string | null = `${e.nombre}/${ARCHIVO_PORTADA}`;
      if (!(await fs.existe(portada))) portada = lienzos.length ? `${e.nombre}/${lienzos[0].carpeta}/miniatura.png` : null;
      resultado.push({
        carpeta: e.nombre,
        nombre: datos.nombre ?? e.nombre,
        cliente: datos.ficha?.cliente ?? "",
        modificado: datos.ficha?.modificado ?? "",
        lienzos: lienzos.length,
        portada,
      });
    } catch {
      // Carpeta sin proyecto.json o con el archivo dañado: no es un proyecto.
    }
  }
  // Lo último que se ha tocado, primero.
  return resultado.sort((a, b) => b.modificado.localeCompare(a.modificado) || a.nombre.localeCompare(b.nombre, "es"));
}

interface EstadoEnDisco {
  zonaGuardada: boolean;
  capasEnDisco: Set<string>;
}

/**
 * Proyecto abierto: los datos de proyecto.json, los lienzos cargados y el guardado automático.
 *
 * Eventos: «arbol» (cambió el árbol: nombres, orden, carpetas, visibilidad) y «guardado»
 * (cambió el estado de guardado).
 */
export class ProyectoAbierto extends EventTarget {
  readonly lienzos = new Map<string, Lienzo>();
  /** Lienzos del árbol que no se pudieron abrir (id → motivo). Se conservan en el árbol y en disco. */
  readonly noAbiertos = new Map<string, string>();
  estadoGuardado: EstadoGuardado = "guardado";
  ultimoError = "";

  private enDisco = new Map<string, EstadoEnDisco>();
  private temporizador: ReturnType<typeof setTimeout> | null = null;
  private primerCambioSinGuardar = 0;
  private guardando: Promise<void> | null = null;
  private repetirGuardado = false;
  private oyentes = new Map<Lienzo, () => void>();

  private constructor(
    readonly fs: SistemaArchivos,
    readonly carpeta: string,
    public datos: Proyecto,
  ) {
    super();
  }

  static async crear(fs: SistemaArchivos, nombre: string): Promise<ProyectoAbierto> {
    let carpeta = nombreSeguro(nombre);
    for (let n = 2; await fs.existe(carpeta); n++) carpeta = `${nombreSeguro(nombre)} (${n})`;
    const ahora = new Date().toISOString();
    const datos: Proyecto = {
      version: VERSION_FORMATO,
      id: nuevoId(),
      nombre,
      ficha: { cliente: nombre, notas: "", creado: ahora, modificado: ahora },
      modelo: { altura: 170, complexion: 0.5, sexo: 0.5, musculatura: 0.5, tonoPiel: "#d8a98a", versionMalla: "makehuman-base-1" },
      arbol: [],
    };
    await fs.crearCarpeta(carpeta);
    await escribirTextoSeguro(fs, `${carpeta}/${ARCHIVO_PROYECTO}`, JSON.stringify(datos, null, 2));
    return new ProyectoAbierto(fs, carpeta, datos);
  }

  static async abrir(fs: SistemaArchivos, carpeta: string, progreso?: (texto: string) => void): Promise<ProyectoAbierto> {
    const datos = migrar(JSON.parse(await fs.leerTexto(`${carpeta}/${ARCHIVO_PROYECTO}`)));
    const p = new ProyectoAbierto(fs, carpeta, datos);
    const nodos = p.nodosLienzo();
    for (const [i, nodo] of nodos.entries()) {
      progreso?.(t("Abriendo «{nombre}» ({i} de {total})…", { nombre: nodo.nombre, i: i + 1, total: nodos.length }));
      try {
        p.registrar(await p.cargarLienzo(nodo));
      } catch (error) {
        // Se queda en el árbol (y sus archivos en disco) para no perderlo al guardar.
        console.error(`No se pudo abrir el lienzo ${nodo.carpeta}`, error);
        p.noAbiertos.set(nodo.id, error instanceof Error ? error.message : String(error));
      }
    }
    return p;
  }

  get nombre(): string {
    return this.datos.nombre;
  }

  // ── Árbol ─────────────────────────────────────────────────────────────────────

  /** Lienzos en orden de dibujo (recorrido en profundidad del árbol). */
  nodosLienzo(lista: NodoArbol[] = this.datos.arbol): NodoLienzo[] {
    return lista.flatMap((n) => (n.tipo === "lienzo" ? [n] : this.nodosLienzo(n.hijos)));
  }

  buscar(id: string): { nodo: NodoArbol; lista: NodoArbol[]; padre: NodoCarpeta | null } | null {
    const recorrer = (lista: NodoArbol[], padre: NodoCarpeta | null): ReturnType<ProyectoAbierto["buscar"]> => {
      for (const nodo of lista) {
        if (nodo.id === id) return { nodo, lista, padre };
        if (nodo.tipo === "carpeta") {
          const r = recorrer(nodo.hijos, nodo);
          if (r) return r;
        }
      }
      return null;
    };
    return recorrer(this.datos.arbol, null);
  }

  /** Lienzos en orden de dibujo, con su visibilidad efectiva (la suya y la de sus carpetas). */
  ordenDeDibujo(): Lienzo[] {
    const resultado: Lienzo[] = [];
    const recorrer = (lista: NodoArbol[], visible: boolean) => {
      for (const n of lista) {
        if (n.tipo === "carpeta") recorrer(n.hijos, visible && n.visible);
        else {
          const l = this.lienzos.get(n.id);
          if (!l) continue;
          l.visible = visible && n.visible;
          resultado.push(l);
        }
      }
    };
    recorrer(this.datos.arbol, true);
    return resultado;
  }

  async añadirLienzo(lienzo: Lienzo, enCarpeta: string | null = null): Promise<void> {
    const nodo: NodoLienzo = {
      tipo: "lienzo",
      id: lienzo.id,
      nombre: lienzo.nombre,
      visible: true,
      carpeta: `${nombreSeguro(lienzo.nombre)}_${lienzo.id}.lienzo`,
    };
    this.listaDe(enCarpeta).push(nodo);
    this.registrar(lienzo);
    this.cambioArbol();
    // Se guarda en segundo plano: el lienzo se puede usar ya.
    void this.guardar();
  }

  async duplicarLienzo(id: string): Promise<Lienzo | null> {
    const origen = this.lienzos.get(id);
    const encontrado = this.buscar(id);
    if (!origen || !encontrado) return null;
    const doc = new DocumentoLienzo(origen.doc.ancho, origen.doc.alto, PX_POR_MM, false);
    for (const capa of origen.doc.capas) doc.capas.push(capa.duplicar(nuevoId(), capa.nombre));
    doc.activa = doc.capas[origen.doc.capas.indexOf(origen.doc.activa)] ?? doc.capas[0];
    const copia = new Lienzo(nuevoId(), this.nombreLibre(t("{nombre} copia", { nombre: origen.nombre })), origen.zona, doc);
    copia.cuadricula = origen.cuadricula;
    copia.tonoPiel = origen.tonoPiel;
    copia.actualizarFantasma();
    const nodo: NodoLienzo = {
      tipo: "lienzo",
      id: copia.id,
      nombre: copia.nombre,
      visible: true,
      carpeta: `${nombreSeguro(copia.nombre)}_${copia.id}.lienzo`,
    };
    encontrado.lista.splice(encontrado.lista.indexOf(encontrado.nodo) + 1, 0, nodo);
    this.registrar(copia);
    this.cambioArbol();
    void this.guardar();
    return copia;
  }

  crearCarpeta(nombre: string, enCarpeta: string | null = null): NodoCarpeta {
    const nodo: NodoCarpeta = { tipo: "carpeta", id: nuevoId(), nombre, visible: true, abierta: true, hijos: [] };
    this.listaDe(enCarpeta).push(nodo);
    this.cambioArbol();
    return nodo;
  }

  renombrar(id: string, nombre: string): void {
    const e = this.buscar(id);
    if (!e || !nombre.trim()) return;
    e.nodo.nombre = nombre.trim();
    this.lienzos.get(id)?.cambiar({ nombre: nombre.trim() });
    this.cambioArbol();
  }

  alternarVisible(id: string): void {
    const e = this.buscar(id);
    if (!e) return;
    e.nodo.visible = !e.nodo.visible;
    this.cambioArbol();
  }

  alternarAbierta(id: string): void {
    const e = this.buscar(id);
    if (e?.nodo.tipo !== "carpeta") return;
    e.nodo.abierta = !e.nodo.abierta;
    this.cambioArbol(false);
  }

  /**
   * Mueve un nodo: dentro de la carpeta `destino` (al final) o, si `antesDe` se indica, justo
   * antes de ese nodo y en su misma lista. Con ambos nulos va al final de la raíz.
   */
  mover(id: string, destino: string | null, antesDe: string | null = null): void {
    const e = this.buscar(id);
    if (!e) return;
    // Una carpeta no puede entrar en sí misma ni en sus descendientes.
    if (e.nodo.tipo === "carpeta" && (destino !== null || antesDe !== null)) {
      const objetivo = destino ?? antesDe!;
      if (objetivo === id || buscarEn(e.nodo.hijos, objetivo)) return;
    }
    e.lista.splice(e.lista.indexOf(e.nodo), 1);
    if (antesDe) {
      const ref = this.buscar(antesDe);
      if (ref) ref.lista.splice(ref.lista.indexOf(ref.nodo), 0, e.nodo);
      else this.datos.arbol.push(e.nodo);
    } else {
      this.listaDe(destino).push(e.nodo);
    }
    this.cambioArbol();
  }

  /** Elimina un nodo (y, si es carpeta, todo lo que contiene), también del disco. */
  async eliminar(id: string): Promise<Lienzo[]> {
    const e = this.buscar(id);
    if (!e) return [];
    e.lista.splice(e.lista.indexOf(e.nodo), 1);
    const nodos = e.nodo.tipo === "lienzo" ? [e.nodo] : this.nodosLienzo(e.nodo.hijos);
    const quitados: Lienzo[] = [];
    for (const n of nodos) {
      const l = this.lienzos.get(n.id);
      if (l) {
        this.oyentes.get(l)?.();
        this.oyentes.delete(l);
        this.lienzos.delete(n.id);
        quitados.push(l);
      }
      this.enDisco.delete(n.id);
      try {
        if (await this.fs.existe(`${this.carpeta}/${n.carpeta}`)) await this.fs.borrar(`${this.carpeta}/${n.carpeta}`);
      } catch (error) {
        console.error("No se pudo borrar la carpeta del lienzo", error);
      }
    }
    this.cambioArbol();
    return quitados;
  }

  /**
   * Cambia el cuerpo del proyecto. El tono de piel se aplica también a todos los lienzos
   * (la tinta se ve mezclada con la piel, RF-41). Emite «modelo».
   */
  cambiarModelo(cambios: Partial<ModeloCuerpo>): void {
    this.datos.modelo = { ...this.datos.modelo, ...cambios };
    if (cambios.tonoPiel) for (const l of this.lienzos.values()) l.cambiar({ tonoPiel: cambios.tonoPiel });
    this.dispatchEvent(new Event("modelo"));
    this.programarGuardado();
  }

  /** Cambia la ficha del cliente (RF-05). Emite «ficha». */
  cambiarFicha(cambios: Partial<Omit<FichaCliente, "creado" | "modificado">>): void {
    this.datos.ficha = { ...this.datos.ficha, ...cambios };
    this.dispatchEvent(new Event("ficha"));
    this.programarGuardado();
  }

  renombrarProyecto(nombre: string): void {
    if (!nombre.trim()) return;
    this.datos.nombre = nombre.trim();
    this.datos.ficha.cliente = nombre.trim();
    this.cambioArbol(false);
  }

  private listaDe(carpeta: string | null): NodoArbol[] {
    if (!carpeta) return this.datos.arbol;
    const e = this.buscar(carpeta);
    return e?.nodo.tipo === "carpeta" ? e.nodo.hijos : this.datos.arbol;
  }

  private nombreLibre(base: string): string {
    const nombres = new Set(this.nodosLienzo().map((n) => n.nombre));
    if (!nombres.has(base)) return base;
    let n = 2;
    while (nombres.has(`${base} ${n}`)) n++;
    return `${base} ${n}`;
  }

  private cambioArbol(afectaDibujo = true): void {
    this.dispatchEvent(new CustomEvent("arbol", { detail: { afectaDibujo } }));
    this.programarGuardado();
  }

  private registrar(lienzo: Lienzo): void {
    this.lienzos.set(lienzo.id, lienzo);
    const alCambiar = () => this.programarGuardado();
    lienzo.addEventListener("historial", alCambiar);
    lienzo.addEventListener("capas", alCambiar);
    lienzo.addEventListener("propiedades", alCambiar);
    this.oyentes.set(lienzo, () => {
      lienzo.removeEventListener("historial", alCambiar);
      lienzo.removeEventListener("capas", alCambiar);
      lienzo.removeEventListener("propiedades", alCambiar);
    });
  }

  /** Deja de escuchar los lienzos (al cerrar el proyecto). */
  cerrar(): void {
    for (const quitar of this.oyentes.values()) quitar();
    this.oyentes.clear();
    if (this.temporizador) clearTimeout(this.temporizador);
  }

  // ── Guardado ──────────────────────────────────────────────────────────────────

  get hayCambios(): boolean {
    return this.estadoGuardado === "pendiente" || this.estadoGuardado === "error" || this.estadoGuardado === "guardando";
  }

  programarGuardado(): void {
    const ahora = Date.now();
    if (this.estadoGuardado !== "pendiente") this.primerCambioSinGuardar = ahora;
    this.fijarEstado("pendiente");
    if (this.temporizador) clearTimeout(this.temporizador);
    const espera = Math.max(0, Math.min(ESPERA_GUARDADO_MS, this.primerCambioSinGuardar + MAXIMO_SIN_GUARDAR_MS - ahora));
    this.temporizador = setTimeout(() => void this.guardar(), espera);
  }

  /** Guarda todo lo pendiente. Si ya hay un guardado en curso, se repite al terminar. */
  async guardar(): Promise<void> {
    if (this.temporizador) clearTimeout(this.temporizador);
    this.temporizador = null;
    if (this.guardando) {
      this.repetirGuardado = true;
      return this.guardando;
    }
    this.guardando = (async () => {
      do {
        this.repetirGuardado = false;
        this.fijarEstado("guardando");
        try {
          for (const nodo of this.nodosLienzo()) {
            const l = this.lienzos.get(nodo.id);
            if (l) await this.guardarLienzo(l, nodo);
          }
          // proyecto.json es pequeño: se reescribe en cada guardado (fecha de modificación incluida).
          this.datos.ficha.modificado = new Date().toISOString();
          await escribirTextoSeguro(this.fs, `${this.carpeta}/${ARCHIVO_PROYECTO}`, JSON.stringify(this.datos, null, 2));
          this.ultimoError = "";
          this.fijarEstado(this.repetirGuardado ? "pendiente" : "guardado");
        } catch (error) {
          this.ultimoError = error instanceof Error ? error.message : String(error);
          console.error("Error al guardar", error);
          this.fijarEstado("error");
          break;
        }
      } while (this.repetirGuardado);
    })();
    try {
      await this.guardando;
    } finally {
      this.guardando = null;
    }
  }

  private async guardarLienzo(l: Lienzo, nodo: NodoLienzo): Promise<void> {
    const fs = this.fs;
    const dir = `${this.carpeta}/${nodo.carpeta}`;
    let estado = this.enDisco.get(l.id);
    if (!estado) {
      estado = { zonaGuardada: false, capasEnDisco: new Set() };
      this.enDisco.set(l.id, estado);
    }
    if (!estado.zonaGuardada) {
      await fs.crearCarpeta(dir);
      await fs.escribirBinario(`${dir}/zona.bin`, empaquetarZona(l.zona));
      estado.zonaGuardada = true;
      l.modificado = true;
    }
    let pixeles = false;
    for (const capa of l.doc.capas) {
      if (!estado.capasEnDisco.has(capa.id)) {
        // Capa nueva en disco (o recuperada al deshacer su borrado): se escriben todas sus teselas.
        await fs.crearCarpeta(`${dir}/capas/${capa.id}`);
        for (const clave of capa.teselas.keys()) capa.sucias.add(clave);
        estado.capasEnDisco.add(capa.id);
        l.modificado = true;
      }
      for (const clave of [...capa.sucias]) {
        capa.sucias.delete(clave);
        pixeles = true;
        const [tx, ty] = desdeClave(clave);
        const ruta = `${dir}/capas/${capa.id}/t_${tx}_${ty}.png`;
        const tesela = capa.teselas.get(clave);
        try {
          if (tesela) await fs.escribirBinario(ruta, new Uint8Array(await (await aBlob(tesela)).arrayBuffer()));
          else if (await fs.existe(ruta)) await fs.borrar(ruta);
        } catch (error) {
          capa.sucias.add(clave);
          throw error;
        }
      }
    }
    for (const id of [...estado.capasEnDisco]) {
      if (l.doc.capas.some((c) => c.id === id)) continue;
      await fs.borrar(`${dir}/capas/${id}`);
      estado.capasEnDisco.delete(id);
      l.modificado = true;
    }
    if (l.modificado || pixeles) {
      const datos: DatosLienzo = {
        version: VERSION_FORMATO,
        id: l.id,
        nombre: l.nombre,
        ppp: PPP,
        ancho: l.doc.ancho,
        alto: l.doc.alto,
        cuadricula: l.cuadricula,
        tonoPiel: l.tonoPiel,
        tipo: l.zona.aplanado.tipo,
        capaActiva: l.doc.activa.id,
        capas: l.doc.capas.map((c) => ({
          id: c.id,
          nombre: c.nombre,
          visible: c.visible,
          bloqueada: c.bloqueada,
          opacidad: c.opacidad,
          modo: c.modo,
          enStencil: c.enStencil,
        })),
      };
      await escribirTextoSeguro(fs, `${dir}/lienzo.json`, JSON.stringify(datos, null, 2));
      l.modificado = false;
    }
    if (pixeles) await fs.escribirBinario(`${dir}/miniatura.png`, await miniatura(l));
  }

  private async cargarLienzo(nodo: NodoLienzo): Promise<Lienzo> {
    const fs = this.fs;
    const dir = `${this.carpeta}/${nodo.carpeta}`;
    const datos = JSON.parse(await fs.leerTexto(`${dir}/lienzo.json`)) as DatosLienzo;
    const zona = desempaquetarZona(await fs.leerBinario(`${dir}/zona.bin`));
    const doc = new DocumentoLienzo(datos.ancho, datos.alto, PX_POR_MM, false);
    for (const dc of datos.capas) {
      const capa = new Capa(dc.id, dc.nombre);
      capa.visible = dc.visible;
      capa.bloqueada = dc.bloqueada;
      capa.opacidad = dc.opacidad;
      capa.modo = dc.modo as ModoFusion;
      capa.enStencil = dc.enStencil ?? true;
      let archivos: { nombre: string }[] = [];
      try {
        archivos = await fs.listar(`${dir}/capas/${dc.id}`);
      } catch {
        // Capa sin teselas en disco.
      }
      // Las teselas de una capa se leen y descodifican en paralelo.
      await Promise.all(
        archivos.map(async (a) => {
          const m = /^t_(\d+)_(\d+)\.png$/.exec(a.nombre);
          if (!m) return;
          const bytes = await fs.leerBinario(`${dir}/capas/${dc.id}/${a.nombre}`);
          const imagen = await createImageBitmap(new Blob([bytes as BlobPart], { type: "image/png" }));
          contexto(capa.obtenerOCrear(Number(m[1]), Number(m[2]))).drawImage(imagen, 0, 0);
          imagen.close();
        }),
      );
      doc.capas.push(capa);
    }
    if (doc.capas.length === 0) doc.capas.push(new Capa(nuevoId(), t("Líneas")));
    doc.activa = doc.capas.find((c) => c.id === datos.capaActiva) ?? doc.capas[doc.capas.length - 1];
    const lienzo = new Lienzo(datos.id, nodo.nombre, zona, doc);
    if (datos.cuadricula === false || (datos.tonoPiel && datos.tonoPiel !== lienzo.tonoPiel)) {
      lienzo.cuadricula = datos.cuadricula !== false;
      lienzo.tonoPiel = datos.tonoPiel || lienzo.tonoPiel;
      lienzo.componerPrevia(lienzo.rectCompleto());
    }
    lienzo.actualizarFantasma();
    lienzo.modificado = false;
    this.enDisco.set(lienzo.id, { zonaGuardada: true, capasEnDisco: new Set(datos.capas.map((c) => c.id)) });
    return lienzo;
  }

  private fijarEstado(estado: EstadoGuardado): void {
    if (this.estadoGuardado === estado) return;
    this.estadoGuardado = estado;
    this.dispatchEvent(new Event("guardado"));
  }
}

/** Miniatura PNG de 256 px de ancho: papel dentro de la zona y la tinta encima. */
async function miniatura(l: Lienzo): Promise<Uint8Array> {
  const ancho = 256;
  const alto = Math.max(1, Math.round((ancho * l.geo.altoPrevia) / l.geo.anchoPrevia));
  const c = crearLamina(ancho, alto);
  const ctx = contexto(c);
  ctx.drawImage(l.geo.mascara, 0, 0, ancho, alto);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = "#f4efe9";
  ctx.fillRect(0, 0, ancho, alto);
  ctx.globalCompositeOperation = "source-over";
  ctx.drawImage(l.tinta, 0, 0, ancho, alto);
  return new Uint8Array(await (await aBlob(c)).arrayBuffer());
}

/** Adapta proyectos guardados con versiones anteriores del formato. */
function migrar(datos: Proyecto): Proyecto {
  if (datos.version === 1) {
    // Versión 1: árbol con lienzos sin carpeta asignada y carpetas sin estado abierto/cerrado.
    const recorrer = (lista: NodoArbol[]): NodoArbol[] =>
      lista.map((n) =>
        n.tipo === "carpeta"
          ? { ...n, abierta: n.abierta ?? true, hijos: recorrer(n.hijos) }
          : { ...n, carpeta: n.carpeta ?? `${nombreSeguro(n.nombre)}_${n.id}.lienzo` },
      );
    datos = { ...datos, version: 2, arbol: recorrer(datos.arbol ?? []) };
  }
  if (datos.version > VERSION_FORMATO)
    throw new Error(t("Este proyecto se guardó con una versión más reciente de Dermap. Actualiza la aplicación."));
  return datos;
}

function buscarEn(lista: NodoArbol[], id: string): boolean {
  return lista.some((n) => n.id === id || (n.tipo === "carpeta" && buscarEn(n.hijos, id)));
}
