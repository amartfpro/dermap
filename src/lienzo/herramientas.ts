import { t } from "../i18n";
import type { Lienzo } from "./lienzo";
import { fijarCopia } from "./portapapeles";
import { teselasEn, TESELA, type Rect } from "./teselas";

type P = { x: number; y: number };

/** Diferencia máxima por canal (0–255) para considerar un píxel del mismo color al rellenar. */
const TOLERANCIA = 40;

/**
 * Cubo de relleno (RF-34): rellena con el color del pincel la zona cerrada bajo el punto,
 * mirando todas las capas visibles (así se rellena en una capa de color lo que delimitan las
 * líneas de otra) y escribiendo en la capa activa. La zona se amplía 1 px para meterse bajo
 * el borde suavizado de las líneas y nunca sale del contorno del lienzo.
 */
export function rellenar(lienzo: Lienzo, x: number, y: number, color: string, opacidad: number): boolean {
  const doc = lienzo.doc;
  const capa = doc.activa;
  if (capa.bloqueadaTotal || !capa.seVe) return false;
  const W = doc.ancho, H = doc.alto;
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= W || y >= H) return false;

  // Imagen compuesta de todo el documento (capas visibles), con lo de fuera de la zona opaco
  // para que haga de barrera.
  const compuesta = new OffscreenCanvas(W, H);
  const cc = compuesta.getContext("2d", { willReadFrequently: true })!;
  doc.componer(cc, { x0: 0, y0: 0, x1: W, y1: H });
  cc.globalCompositeOperation = "destination-over";
  cc.fillStyle = "#fff";
  cc.fill(lienzo.geo.recorte);
  cc.globalCompositeOperation = "source-over";
  const pixeles = new Uint32Array(cc.getImageData(0, 0, W, H).data.buffer);
  const semilla = pixeles[y * W + x];
  if ((semilla >>> 24) === 0) return false; // fuera de la zona: el fondo queda transparente
  const r0 = semilla & 255, g0 = (semilla >> 8) & 255, b0 = (semilla >> 16) & 255, a0 = semilla >>> 24;
  const parecido = (p: number) =>
    Math.abs((p & 255) - r0) <= TOLERANCIA &&
    Math.abs(((p >> 8) & 255) - g0) <= TOLERANCIA &&
    Math.abs(((p >> 16) & 255) - b0) <= TOLERANCIA &&
    Math.abs((p >>> 24) - a0) <= TOLERANCIA;

  // Relleno por líneas horizontales.
  const mascara = new Uint8Array(W * H);
  const pila = [x, y];
  let x0 = x, x1 = x, y0 = y, y1 = y;
  while (pila.length) {
    const py = pila.pop()!;
    let px = pila.pop()!;
    let i = py * W + px;
    while (px > 0 && !mascara[i - 1] && parecido(pixeles[i - 1])) {
      px--;
      i--;
    }
    let arriba = false, abajo = false;
    for (; px < W && !mascara[i] && parecido(pixeles[i]); px++, i++) {
      mascara[i] = 1;
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py > 0) {
        const s = !mascara[i - W] && parecido(pixeles[i - W]);
        if (s && !arriba) pila.push(px, py - 1);
        arriba = s;
      }
      if (py < H - 1) {
        const s = !mascara[i + W] && parecido(pixeles[i + W]);
        if (s && !abajo) pila.push(px, py + 1);
        abajo = s;
      }
    }
    if (py < y0) y0 = py;
    if (py > y1) y1 = py;
  }

  // Imagen del relleno (ampliada 1 px) en su caja.
  const rx0 = Math.max(0, x0 - 1), ry0 = Math.max(0, y0 - 1);
  const rw = Math.min(W, x1 + 2) - rx0, rh = Math.min(H, y1 + 2) - ry0;
  const [cr, cg, cb] = [1, 3, 5].map((k) => parseInt(color.slice(k, k + 2), 16));
  const imagen = new ImageData(rw, rh);
  const d = imagen.data;
  for (let yy = 0; yy < rh; yy++)
    for (let xx = 0; xx < rw; xx++) {
      const gx = rx0 + xx, gy = ry0 + yy, i = gy * W + gx;
      const dentro =
        mascara[i] ||
        (gx > 0 && mascara[i - 1]) || (gx < W - 1 && mascara[i + 1]) ||
        (gy > 0 && mascara[i - W]) || (gy < H - 1 && mascara[i + W]);
      if (!dentro) continue;
      const o = 4 * (yy * rw + xx);
      d[o] = cr;
      d[o + 1] = cg;
      d[o + 2] = cb;
      d[o + 3] = 255;
    }
  const lamina = new OffscreenCanvas(rw, rh);
  lamina.getContext("2d")!.putImageData(imagen, 0, 0);
  const rect = { x0: rx0, y0: ry0, x1: rx0 + rw, y1: ry0 + rh };
  const paso = doc.editar(capa, rect, "Relleno", (ctx) => {
    ctx.clip(lienzo.geo.recorte);
    ctx.globalAlpha = opacidad;
    ctx.drawImage(lamina, rx0, ry0);
  });
  if (paso) lienzo.historial.registrar(paso);
  lienzo.actualizarFantasma();
  return !!paso;
}

/** Selección con lazo sobre el lienzo (RF-34). */
export class Seleccion {
  readonly camino = new Path2D();
  readonly rect: Rect;

  constructor(readonly puntos: P[]) {
    puntos.forEach((p, i) => (i ? this.camino.lineTo(p.x, p.y) : this.camino.moveTo(p.x, p.y)));
    this.camino.closePath();
    const xs = puntos.map((p) => p.x), ys = puntos.map((p) => p.y);
    this.rect = {
      x0: Math.floor(Math.min(...xs)) - 1,
      y0: Math.floor(Math.min(...ys)) - 1,
      x1: Math.ceil(Math.max(...xs)) + 1,
      y1: Math.ceil(Math.max(...ys)) + 1,
    };
  }

  /** Píxeles de la capa activa dentro de la selección, recortados a su caja. */
  extraer(lienzo: Lienzo): OffscreenCanvas | null {
    const capa = lienzo.doc.activa;
    const r = this.rect;
    const w = r.x1 - r.x0, h = r.y1 - r.y0;
    if (w <= 0 || h <= 0) return null;
    const lamina = new OffscreenCanvas(w, h);
    const ctx = lamina.getContext("2d")!;
    ctx.translate(-r.x0, -r.y0);
    ctx.clip(this.camino);
    let algo = false;
    for (const [tx, ty] of teselasEn(r, lienzo.doc.ancho, lienzo.doc.alto)) {
      const t = capa.teselas.get(`${tx},${ty}`);
      if (!t) continue;
      ctx.drawImage(t, tx * TESELA, ty * TESELA);
      algo = true;
    }
    return algo ? lamina : null;
  }

  borrar(lienzo: Lienzo, descripcion = "Borrar selección"): boolean {
    const capa = lienzo.doc.activa;
    if (capa.bloqueadaTotal) return false;
    const paso = lienzo.doc.editar(
      capa,
      this.rect,
      descripcion,
      (ctx) => {
        ctx.globalCompositeOperation = "destination-out";
        ctx.fill(this.camino);
      },
      false,
    );
    if (paso) lienzo.historial.registrar(paso);
    lienzo.actualizarFantasma();
    return !!paso;
  }

  async copiar(lienzo: Lienzo): Promise<boolean> {
    const lamina = this.extraer(lienzo);
    if (!lamina) return false;
    await fijarCopia(await createImageBitmap(lamina), t("{nombre} (selección)", { nombre: lienzo.doc.activa.nombre }), lienzo.id, this.rect);
    return true;
  }
}

/** Puntos del contorno de una forma, para trazarla con el pincel actual (RF-34). */
export function puntosDeForma(tipo: "linea" | "rectangulo" | "elipse", a: P, b: P): P[] {
  if (tipo === "linea") return [a, b];
  if (tipo === "rectangulo")
    return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }, a];
  const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
  const rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
  const n = Math.max(24, Math.ceil((Math.PI * (rx + ry)) / 20));
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = (2 * Math.PI * i) / n;
    return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) };
  });
}

/** Restringe el segundo punto con Mayús: línea a múltiplos de 15°, rectángulo y elipse proporcionados. */
export function restringir(tipo: "linea" | "rectangulo" | "elipse", a: P, b: P): P {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (tipo === "linea") {
    const angulo = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12);
    const l = Math.hypot(dx, dy);
    return { x: a.x + l * Math.cos(angulo), y: a.y + l * Math.sin(angulo) };
  }
  const lado = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: a.x + Math.sign(dx || 1) * lado, y: a.y + Math.sign(dy || 1) * lado };
}
