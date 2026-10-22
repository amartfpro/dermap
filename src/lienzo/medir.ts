import type { Capa } from "./capa";
import { PX_POR_MM } from "./geometria-zona";
import type { Lienzo } from "./lienzo";
import { contexto, crearLamina, desdeClave, TESELA } from "./teselas";

export interface MedidaDiseno {
  /** Superficie con tinta, en cm² de piel (aproximada: el aplanado deforma poco). */
  tintaCm2: number;
  /** Caja que contiene el diseño, en cm. */
  anchoCm: number;
  altoCm: number;
}

/**
 * Mide lo dibujado en las capas visibles que van al stencil, dentro de la zona: sirve para
 * presupuestar (muchos estudios cobran por tamaño) y para la ficha del cliente.
 * Devuelve null si no hay nada dibujado.
 */
export function medirDiseno(lienzo: Lienzo, filtro: (c: Capa) => boolean = (c) => c.visible && c.enStencil): MedidaDiseno | null {
  const doc = lienzo.doc;
  const claves = new Set<string>();
  for (const capa of doc.capas) if (filtro(capa)) for (const k of capa.teselas.keys()) claves.add(k);
  if (!claves.size) return null;
  const lamina = crearLamina(TESELA, TESELA);
  const ctx = contexto(lamina);
  let n = 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const clave of claves) {
    const [tx, ty] = desdeClave(clave);
    const r = { x0: tx * TESELA, y0: ty * TESELA, x1: (tx + 1) * TESELA, y1: (ty + 1) * TESELA };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, TESELA, TESELA);
    ctx.save();
    ctx.translate(-r.x0, -r.y0);
    ctx.clip(lienzo.geo.recorte);
    doc.componer(ctx, r, filtro);
    ctx.restore();
    const datos = ctx.getImageData(0, 0, TESELA, TESELA).data;
    for (let y = 0; y < TESELA; y++)
      for (let x = 0; x < TESELA; x++) {
        // Se cuenta lo que dejaría marca: más de un 25 % de opacidad.
        if (datos[4 * (y * TESELA + x) + 3] < 64) continue;
        n++;
        const gx = r.x0 + x, gy = r.y0 + y;
        if (gx < x0) x0 = gx;
        if (gx > x1) x1 = gx;
        if (gy < y0) y0 = gy;
        if (gy > y1) y1 = gy;
      }
  }
  if (!n) return null;
  const pxPorCm = PX_POR_MM * 10;
  return {
    tintaCm2: n / (pxPorCm * pxPorCm),
    anchoCm: (x1 - x0 + 1) / pxPorCm,
    altoCm: (y1 - y0 + 1) / pxPorCm,
  };
}
