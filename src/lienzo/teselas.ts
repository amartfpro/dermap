/**
 * Utilidades de teselas y rectángulos para el motor de dibujo.
 *
 * Cada capa es una rejilla dispersa de teselas de 512 × 512 px: solo existen las que tienen
 * contenido. Así un lienzo de manga a 300 ppp (≈ 7.000 × 4.000 px) no ocupa 120 MB por capa
 * si casi todo está vacío (ver «Documento de diseño», Motor de dibujo).
 */

export const TESELA = 512;

/** Superficie de dibujo: OffscreenCanvas si existe (WebView2, Chrome), si no un <canvas>. */
export type Lamina = OffscreenCanvas | HTMLCanvasElement;
export type Contexto2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

export function crearLamina(ancho: number, alto: number): Lamina {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(ancho, alto);
  return Object.assign(document.createElement("canvas"), { width: ancho, height: alto });
}

export function contexto(lamina: Lamina): Contexto2D {
  return lamina.getContext("2d") as Contexto2D;
}

export function claveTesela(tx: number, ty: number): string {
  return `${tx},${ty}`;
}

export function desdeClave(clave: string): [number, number] {
  const [tx, ty] = clave.split(",").map(Number);
  return [tx, ty];
}

/** Rectángulo en píxeles del documento: [x0, x1) × [y0, y1). */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const rectVacio = (): Rect => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });

export function esVacio(r: Rect): boolean {
  return r.x1 <= r.x0 || r.y1 <= r.y0;
}

export function unir(a: Rect, b: Rect): Rect {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

export function intersecar(a: Rect, b: Rect): Rect {
  return { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
}

export function ampliar(r: Rect, margen: number): Rect {
  return { x0: r.x0 - margen, y0: r.y0 - margen, x1: r.x1 + margen, y1: r.y1 + margen };
}

/** Redondea hacia fuera a píxeles enteros. */
export function entero(r: Rect): Rect {
  return { x0: Math.floor(r.x0), y0: Math.floor(r.y0), x1: Math.ceil(r.x1), y1: Math.ceil(r.y1) };
}

/** Teselas que tocan un rectángulo, recortado a [0, ancho) × [0, alto). */
export function teselasEn(r: Rect, ancho: number, alto: number): [number, number][] {
  const tx0 = Math.max(0, Math.floor(r.x0 / TESELA));
  const ty0 = Math.max(0, Math.floor(r.y0 / TESELA));
  const tx1 = Math.min(Math.ceil(ancho / TESELA) - 1, Math.floor((r.x1 - 1) / TESELA));
  const ty1 = Math.min(Math.ceil(alto / TESELA) - 1, Math.floor((r.y1 - 1) / TESELA));
  const lista: [number, number][] = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) lista.push([tx, ty]);
  return lista;
}

/** Rectángulo que ocupa un punto transformado por una matriz, con un radio alrededor. */
export function rectDePunto(x: number, y: number, radio: number): Rect {
  return { x0: x - radio, y0: y - radio, x1: x + radio, y1: y + radio };
}

/** Caja que contiene un rectángulo tras aplicarle una matriz. */
export function transformarRect(r: Rect, m: DOMMatrix): Rect {
  const esquinas = [
    m.transformPoint({ x: r.x0, y: r.y0 }),
    m.transformPoint({ x: r.x1, y: r.y0 }),
    m.transformPoint({ x: r.x0, y: r.y1 }),
    m.transformPoint({ x: r.x1, y: r.y1 }),
  ];
  return {
    x0: Math.min(...esquinas.map((p) => p.x)),
    y0: Math.min(...esquinas.map((p) => p.y)),
    x1: Math.max(...esquinas.map((p) => p.x)),
    y1: Math.max(...esquinas.map((p) => p.y)),
  };
}

/**
 * Conjunto de regiones sucias. Un trazo que cruza una costura modifica dos zonas alejadas
 * del lienzo; unirlas en un único rectángulo obligaría a recomponer casi todo el lienzo.
 * Se fusionan solo las regiones que se tocan (y, por encima de 16, todas).
 */
export class RegionSucia {
  private rects: Rect[] = [];

  get vacia(): boolean {
    return this.rects.length === 0;
  }

  añadir(r: Rect): void {
    if (esVacio(r)) return;
    let actual = r;
    let fusionado = true;
    while (fusionado) {
      fusionado = false;
      for (let i = 0; i < this.rects.length; i++) {
        if (!esVacio(intersecar(ampliar(this.rects[i], 32), actual))) {
          actual = unir(actual, this.rects[i]);
          this.rects.splice(i, 1);
          fusionado = true;
          break;
        }
      }
    }
    this.rects.push(actual);
    if (this.rects.length > 16) this.rects = [this.rects.reduce(unir)];
  }

  /** Devuelve las regiones y deja el conjunto vacío. */
  vaciar(): Rect[] {
    const r = this.rects;
    this.rects = [];
    return r;
  }
}
