import { Capa, nuevoId, operacionCanvas, type ModoFusion } from "./capa";
import type { Paso } from "./historial";
import { Trazo, type AjustesPincel } from "./pincel";
import {
  claveTesela,
  contexto,
  crearLamina,
  desdeClave,
  esVacio,
  teselasEn,
  TESELA,
  type Contexto2D,
  type Lamina,
  type Rect,
} from "./teselas";

/**
 * Documento de lienzo: las capas de píxeles a resolución de impresión y el trazo en curso.
 * Emite «cambio» (detail: Rect en px del documento) cuando cambian píxeles visibles y
 * «capas» cuando cambia la lista o las propiedades de las capas.
 */
export class DocumentoLienzo extends EventTarget {
  capas: Capa[] = [];
  activa!: Capa;
  trazo: Trazo | null = null;
  private readonly temporal = crearLamina(TESELA, TESELA);

  constructor(
    readonly ancho: number,
    readonly alto: number,
    readonly pxPorMm: number,
    crearCapaInicial = true,
  ) {
    super();
    if (crearCapaInicial) {
      const capa = new Capa(nuevoId(), "Líneas");
      this.capas.push(capa);
      this.activa = capa;
    }
  }

  // ── Capas ─────────────────────────────────────────────────────────────────────

  añadirCapa(nombre = this.nombreLibre(), encimaDe: Capa | null = this.activa ?? null): Capa {
    const capa = new Capa(nuevoId(), nombre);
    const i = encimaDe ? this.capas.indexOf(encimaDe) + 1 : this.capas.length;
    this.capas.splice(i, 0, capa);
    this.activa = capa;
    this.avisarCapas();
    return capa;
  }

  insertarCapa(capa: Capa, indice = this.capas.length): void {
    this.capas.splice(indice, 0, capa);
    this.activa = capa;
    this.avisarCapas();
    this.avisarTodo();
  }

  eliminarCapa(capa: Capa): void {
    if (this.capas.length <= 1) return;
    const i = this.capas.indexOf(capa);
    if (i < 0) return;
    this.capas.splice(i, 1);
    if (this.activa === capa) this.activa = this.capas[Math.max(0, i - 1)];
    this.avisarCapas();
    this.avisarTodo();
  }

  moverCapa(capa: Capa, indice: number): void {
    const i = this.capas.indexOf(capa);
    if (i < 0) return;
    this.capas.splice(i, 1);
    this.capas.splice(Math.max(0, Math.min(this.capas.length, indice)), 0, capa);
    this.avisarCapas();
    this.avisarTodo();
  }

  seleccionarCapa(capa: Capa): void {
    this.activa = capa;
    this.avisarCapas();
  }

  cambiarCapa(capa: Capa, cambios: Partial<Pick<Capa, "nombre" | "visible" | "bloqueada" | "opacidad" | "modo" | "enStencil">>): void {
    Object.assign(capa, cambios);
    this.avisarCapas();
    if ("visible" in cambios || "opacidad" in cambios || "modo" in cambios) this.avisarTodo();
  }

  /** Paso de historial que restaura la estructura actual de capas (no sus píxeles). */
  instantaneaCapas(descripcion: string): Paso {
    return new PasoEstructura(this, descripcion);
  }

  private nombreLibre(): string {
    let n = this.capas.length + 1;
    while (this.capas.some((c) => c.nombre === `Capa ${n}`)) n++;
    return `Capa ${n}`;
  }

  // ── Trazos ────────────────────────────────────────────────────────────────────

  empezarTrazo(ajustes: AjustesPincel): Trazo | null {
    if (this.activa.bloqueada || !this.activa.visible) return null;
    this.trazo = new Trazo(this.activa, { ...ajustes }, this.pxPorMm, this.ancho, this.alto);
    return this.trazo;
  }

  /** Funde el trazo con su capa y devuelve el paso para deshacerlo. */
  terminarTrazo(): Paso | null {
    const trazo = this.trazo;
    this.trazo = null;
    if (!trazo || trazo.buffer.size === 0) return null;
    const capa = trazo.capa;
    const antes = new Map<string, Copia>();
    for (const [clave, buffer] of trazo.buffer) {
      const existente = capa.teselas.get(clave);
      antes.set(clave, existente ? copiarLamina(existente) : null);
      if (!existente && trazo.ajustes.herramienta === "goma") continue;
      const [tx, ty] = desdeClave(clave);
      capa.sucias.add(clave);
      const ctx = contexto(capa.obtenerOCrear(tx, ty));
      ctx.globalAlpha = trazo.ajustes.opacidad;
      ctx.globalCompositeOperation = trazo.ajustes.herramienta === "goma" ? "destination-out" : "source-over";
      ctx.drawImage(buffer, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
    // No hace falta avisar: la vista ya mostraba la capa con el trazo combinado encima, que es
    // exactamente el resultado de la fusión. Recomponer todo el trazo costaría cientos de ms.
    return new PasoTeselas(this, capa, antes, trazo.ajustes.herramienta === "goma" ? "Borrar" : "Trazo");
  }

  /**
   * Edita la capa dentro de `rect` con `pintar`, que dibuja en coordenadas del documento
   * (se llama una vez por tesela, ya trasladada). Devuelve el paso para deshacerlo. Lo usan
   * el relleno, las formas y las selecciones.
   */
  editar(capa: Capa, rect: Rect, descripcion: string, pintar: (ctx: Contexto2D) => void, crear = true): Paso | null {
    const antes = new Map<string, Copia>();
    for (const [tx, ty] of teselasEn(rect, this.ancho, this.alto)) {
      const clave = claveTesela(tx, ty);
      const existente = capa.teselas.get(clave);
      if (!existente && !crear) continue;
      antes.set(clave, existente ? copiarLamina(existente) : null);
      const ctx = contexto(capa.obtenerOCrear(tx, ty));
      ctx.save();
      ctx.translate(-tx * TESELA, -ty * TESELA);
      pintar(ctx);
      ctx.restore();
      capa.sucias.add(clave);
    }
    if (!antes.size) return null;
    this.avisar(rect);
    return new PasoTeselas(this, capa, antes, descripcion);
  }

  cancelarTrazo(): void {
    const trazo = this.trazo;
    this.trazo = null;
    if (trazo) this.avisar(trazo.rect);
  }

  // ── Composición ───────────────────────────────────────────────────────────────

  /**
   * Dibuja las capas visibles (con el trazo en curso) que tocan `rect` en `ctx`, cuya
   * transformación ya debe llevar del documento al destino. El llamador recorta a `rect`.
   * `solape` (en px del documento) agranda cada tesela al dibujarla escalada, para que el
   * suavizado de los bordes no deje rendijas entre teselas vecinas.
   */
  componer(ctx: Contexto2D, rect: Rect, filtro: (c: Capa) => boolean = (c) => c.visible, solape = 0): void {
    for (const capa of this.capas) {
      if (!filtro(capa)) continue;
      ctx.globalAlpha = capa.opacidad;
      ctx.globalCompositeOperation = operacionCanvas(capa.modo);
      const trazo = this.trazo?.capa === capa ? this.trazo : null;
      for (const [tx, ty] of teselasEn(rect, this.ancho, this.alto)) {
        const clave = claveTesela(tx, ty);
        const tesela = capa.teselas.get(clave);
        const buffer = trazo?.buffer.get(clave);
        let fuente: Lamina | undefined = tesela;
        if (buffer && trazo) fuente = this.combinar(tesela, buffer, trazo);
        if (fuente)
          solape > 0
            ? ctx.drawImage(fuente, tx * TESELA, ty * TESELA, TESELA + solape, TESELA + solape)
            : ctx.drawImage(fuente, tx * TESELA, ty * TESELA);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  /** Tesela de la capa con el trazo en curso aplicado encima (o borrando, si es la goma). */
  private combinar(tesela: Lamina | undefined, buffer: Lamina, trazo: Trazo): Lamina | undefined {
    if (!tesela && trazo.ajustes.herramienta === "goma") return undefined;
    const ctx = contexto(this.temporal);
    ctx.clearRect(0, 0, TESELA, TESELA);
    if (tesela) ctx.drawImage(tesela, 0, 0);
    ctx.globalAlpha = trazo.ajustes.opacidad;
    ctx.globalCompositeOperation = trazo.ajustes.herramienta === "goma" ? "destination-out" : "source-over";
    ctx.drawImage(buffer, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    return this.temporal;
  }

  // ── Avisos ────────────────────────────────────────────────────────────────────

  avisar(rect: Rect): void {
    if (esVacio(rect)) return;
    this.dispatchEvent(new CustomEvent<Rect>("cambio", { detail: rect }));
  }

  avisarTodo(): void {
    this.avisar({ x0: 0, y0: 0, x1: this.ancho, y1: this.alto });
  }

  avisarCapas(): void {
    this.dispatchEvent(new Event("capas"));
  }
}

/** Rectángulo de documento que ocupan unas teselas. */
function rectDeClaves(claves: Iterable<string>): Rect {
  let r: Rect = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const clave of claves) {
    const [tx, ty] = desdeClave(clave);
    r = {
      x0: Math.min(r.x0, tx * TESELA),
      y0: Math.min(r.y0, ty * TESELA),
      x1: Math.max(r.x1, (tx + 1) * TESELA),
      y1: Math.max(r.y1, (ty + 1) * TESELA),
    };
  }
  return r;
}

/**
 * Copia de una tesela para el historial: primero una copia en otra superficie (rápida, sin
 * leer píxeles de la GPU) y, en segundo plano, comprimida a PNG.
 */
type Copia = Lamina | Blob | null;

function copiarLamina(origen: Lamina): Lamina {
  const copia = crearLamina(TESELA, TESELA);
  contexto(copia).drawImage(origen, 0, 0);
  return copia;
}

/**
 * Paso que restaura el contenido de unas teselas de una capa. Las copias se guardan primero
 * sin comprimir y se comprimen a PNG en segundo plano para que el historial ocupe poco.
 */
class PasoTeselas implements Paso {
  private copias: Map<string, Copia>;

  constructor(
    private readonly doc: DocumentoLienzo,
    private readonly capa: Capa,
    copias: Map<string, Copia>,
    readonly descripcion: string,
  ) {
    this.copias = copias;
    setTimeout(() => void this.comprimir(), 0);
  }

  bytes(): number {
    let total = 0;
    for (const c of this.copias.values()) total += c instanceof Blob ? c.size : c ? TESELA * TESELA * 4 : 0;
    return total;
  }

  private async comprimir(): Promise<void> {
    for (const [clave, c] of this.copias) {
      if (c === null || c instanceof Blob) continue;
      const blob = await aBlob(c);
      // Puede haberse deshecho mientras tanto: solo se sustituye si sigue siendo la misma copia.
      if (this.copias.get(clave) === c) this.copias.set(clave, blob);
    }
  }

  async deshacer(): Promise<Paso> {
    const actuales = new Map<string, Copia>();
    for (const clave of this.copias.keys()) {
      const t = this.capa.teselas.get(clave);
      actuales.set(clave, t ? copiarLamina(t) : null);
    }
    // Las copias comprimidas se descomprimen antes de tocar la capa, para no dejarla a medias.
    const imagenes = new Map<string, CanvasImageSource>();
    for (const [clave, c] of this.copias) if (c instanceof Blob) imagenes.set(clave, await createImageBitmap(c));
    for (const [clave, c] of this.copias) {
      this.capa.sucias.add(clave);
      if (c === null) {
        this.capa.teselas.delete(clave);
        continue;
      }
      const [tx, ty] = desdeClave(clave);
      const ctx = contexto(this.capa.obtenerOCrear(tx, ty));
      ctx.clearRect(0, 0, TESELA, TESELA);
      ctx.drawImage(imagenes.get(clave) ?? (c as Lamina), 0, 0);
    }
    this.doc.avisar(rectDeClaves(this.copias.keys()));
    return new PasoTeselas(this.doc, this.capa, actuales, this.descripcion);
  }
}

interface EstadoCapa {
  capa: Capa;
  nombre: string;
  visible: boolean;
  bloqueada: boolean;
  opacidad: number;
  modo: ModoFusion;
  enStencil: boolean;
}

/** Paso que restaura la lista de capas, su orden y sus propiedades. */
class PasoEstructura implements Paso {
  private readonly capas: EstadoCapa[];
  private readonly activa: Capa;

  constructor(
    private readonly doc: DocumentoLienzo,
    readonly descripcion: string,
  ) {
    this.capas = doc.capas.map((capa) => ({
      capa,
      nombre: capa.nombre,
      visible: capa.visible,
      bloqueada: capa.bloqueada,
      opacidad: capa.opacidad,
      modo: capa.modo,
      enStencil: capa.enStencil,
    }));
    this.activa = doc.activa;
  }

  bytes(): number {
    return 1024;
  }

  async deshacer(): Promise<Paso> {
    const inverso = new PasoEstructura(this.doc, this.descripcion);
    this.doc.capas = this.capas.map((e) => {
      Object.assign(e.capa, {
        nombre: e.nombre,
        visible: e.visible,
        bloqueada: e.bloqueada,
        opacidad: e.opacidad,
        modo: e.modo,
        enStencil: e.enStencil,
      });
      return e.capa;
    });
    this.doc.activa = this.doc.capas.includes(this.activa) ? this.activa : this.doc.capas[0];
    this.doc.avisarCapas();
    this.doc.avisarTodo();
    return inverso;
  }
}

export function aBlob(lamina: Lamina): Promise<Blob> {
  if ("convertToBlob" in lamina) return lamina.convertToBlob({ type: "image/png" });
  return new Promise((resolver, rechazar) =>
    lamina.toBlob((b) => (b ? resolver(b) : rechazar(new Error("No se pudo comprimir la tesela"))), "image/png"),
  );
}
