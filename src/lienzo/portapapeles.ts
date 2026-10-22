import type { Lienzo } from "./lienzo";
import { TESELA, type Rect } from "./teselas";

/**
 * Portapapeles interno de Dermap (RF-33): una capa copiada, a escala real. Al pegarla en
 * el mismo lienzo vuelve a su sitio; en otro lienzo aparece centrada y al mismo tamaño
 * (todos los lienzos están a 300 ppp), lista para moverla o girarla.
 */
export interface Copia {
  imagen: ImageBitmap;
  nombre: string;
  lienzoId: string;
  rect: Rect;
}

let copia: Copia | null = null;

export function hayCopia(): boolean {
  return copia !== null;
}

export function obtenerCopia(): Copia | null {
  return copia;
}

/** Copia la capa activa. Devuelve false si está vacía. */
export async function copiarCapa(lienzo: Lienzo): Promise<boolean> {
  const capa = lienzo.doc.activa;
  if (!capa.teselas.size) return false;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const clave of capa.teselas.keys()) {
    const [tx, ty] = clave.split(",").map(Number);
    x0 = Math.min(x0, tx * TESELA);
    y0 = Math.min(y0, ty * TESELA);
    x1 = Math.max(x1, (tx + 1) * TESELA);
    y1 = Math.max(y1, (ty + 1) * TESELA);
  }
  const lamina = new OffscreenCanvas(x1 - x0, y1 - y0);
  const ctx = lamina.getContext("2d")!;
  for (const [clave, t] of capa.teselas) {
    const [tx, ty] = clave.split(",").map(Number);
    ctx.drawImage(t, tx * TESELA - x0, ty * TESELA - y0);
  }
  copia?.imagen.close();
  copia = { imagen: await createImageBitmap(lamina), nombre: capa.nombre, lienzoId: lienzo.id, rect: { x0, y0, x1, y1 } };
  return true;
}
