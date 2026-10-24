import type { Capa } from "./capa";
import type { Seleccion } from "./herramientas";
import { PasoCompuesto, type Paso } from "./historial";
import type { Lienzo } from "./lienzo";
import { contexto, desdeClave, TESELA, type Rect } from "./teselas";

/**
 * Transformar capas en su sitio (mover, escalar, girar, voltear): se levanta el dibujo de las
 * capas (una, o todas las de un grupo) a piezas sueltas y se borra de ellas; al aplicar, cada
 * pieza se vuelve a pintar en su capa con la transformación. Todo es un único paso de
 * historial; al cancelar se restaura tal cual.
 */
export interface Levantado {
  /** Caja del dibujo en px del documento. */
  rect: Rect;
  piezas: { capa: Capa; imagen: ImageBitmap }[];
  /** Imagen de todas las piezas juntas, para verla mientras se transforma. */
  vista: ImageBitmap;
  /** Paso que deshace el borrado de las capas (para cancelar o como parte del paso final). */
  borrado: Paso;
}

/** Caja que ocupa el dibujo de las capas (píxeles con algo de opacidad), o null si están vacías. */
export function cajaDelDibujo(capas: Capa[]): Rect | null {
  let r: Rect | null = null;
  for (const capa of capas)
    for (const [clave, tesela] of capa.teselas) {
      const [tx, ty] = desdeClave(clave);
      const datos = contexto(tesela).getImageData(0, 0, TESELA, TESELA).data;
      let x0 = TESELA, y0 = TESELA, x1 = -1, y1 = -1;
      for (let y = 0; y < TESELA; y++)
        for (let x = 0; x < TESELA; x++)
          if (datos[(y * TESELA + x) * 4 + 3] > 0) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
      if (x1 < 0) continue;
      const c = { x0: tx * TESELA + x0, y0: ty * TESELA + y0, x1: tx * TESELA + x1 + 1, y1: ty * TESELA + y1 + 1 };
      r = r ? { x0: Math.min(r.x0, c.x0), y0: Math.min(r.y0, c.y0), x1: Math.max(r.x1, c.x1), y1: Math.max(r.y1, c.y1) } : c;
    }
  return r;
}

/** Levanta el dibujo de las capas y lo borra de ellas. null si no hay nada que transformar. */
export async function levantar(lienzo: Lienzo, capas: Capa[]): Promise<Levantado | null> {
  const doc = lienzo.doc;
  const editables = capas.filter((c) => !c.bloqueadaTotal && c.seVe);
  const rect = cajaDelDibujo(editables);
  if (!rect) return null;
  const w = rect.x1 - rect.x0, h = rect.y1 - rect.y0;
  const piezas: Levantado["piezas"] = [];
  const conjunto = new OffscreenCanvas(w, h);
  const cc = conjunto.getContext("2d")!;
  for (const capa of editables) {
    const lamina = new OffscreenCanvas(w, h);
    const ctx = lamina.getContext("2d")!;
    let algo = false;
    for (const [clave, tesela] of capa.teselas) {
      const [tx, ty] = desdeClave(clave);
      ctx.drawImage(tesela, tx * TESELA - rect.x0, ty * TESELA - rect.y0);
      algo = true;
    }
    if (!algo) continue;
    piezas.push({ capa, imagen: await createImageBitmap(lamina) });
    cc.globalAlpha = capa.opacidadTotal;
    cc.drawImage(lamina, 0, 0);
  }
  if (!piezas.length) return null;
  const pasos: Paso[] = [];
  for (const { capa } of piezas) {
    const paso = doc.editar(capa, rect, "Transformar", (ctx) => ctx.clearRect(rect.x0, rect.y0, w, h), false);
    if (paso) pasos.push(paso);
  }
  lienzo.actualizarFantasma();
  return { rect, piezas, vista: await createImageBitmap(conjunto), borrado: new PasoCompuesto("Transformar", pasos) };
}

/**
 * Levanta lo que hay dentro de una selección con lazo en la capa activa (para moverlo,
 * escalarlo o girarlo en su misma capa) y lo borra de ella. null si dentro no hay dibujo.
 */
export async function levantarSeleccion(lienzo: Lienzo, sel: Seleccion): Promise<Levantado | null> {
  const capa = lienzo.doc.activa;
  if (capa.bloqueadaTotal || !capa.seVe) return null;
  const lamina = sel.extraer(lienzo);
  if (!lamina) return null;
  const imagen = await createImageBitmap(lamina);
  const borrado = lienzo.doc.editar(
    capa,
    sel.rect,
    "Mover selección",
    (ctx) => {
      ctx.globalCompositeOperation = "destination-out";
      ctx.fill(sel.camino);
    },
    false,
  );
  if (!borrado) return null;
  lienzo.actualizarFantasma();
  return { rect: sel.rect, piezas: [{ capa, imagen }], vista: imagen, borrado };
}

/**
 * Pinta las piezas en sus capas con `matriz` (de px de la pieza a px del documento) y registra
 * todo (borrado + pintado) como un solo paso.
 */
export function aplicar(lienzo: Lienzo, levantado: Levantado, matriz: DOMMatrix, descripcion = "Transformar"): void {
  const doc = lienzo.doc;
  const { width: w, height: h } = levantado.vista;
  const p = [
    matriz.transformPoint({ x: 0, y: 0 }),
    matriz.transformPoint({ x: w, y: 0 }),
    matriz.transformPoint({ x: w, y: h }),
    matriz.transformPoint({ x: 0, y: h }),
  ];
  const destino: Rect = {
    x0: Math.max(0, Math.floor(Math.min(...p.map((q) => q.x))) - 1),
    y0: Math.max(0, Math.floor(Math.min(...p.map((q) => q.y))) - 1),
    x1: Math.min(doc.ancho, Math.ceil(Math.max(...p.map((q) => q.x))) + 1),
    y1: Math.min(doc.alto, Math.ceil(Math.max(...p.map((q) => q.y))) + 1),
  };
  const pasos: Paso[] = [levantado.borrado];
  if (destino.x1 > destino.x0 && destino.y1 > destino.y0)
    for (const { capa, imagen } of levantado.piezas) {
      const paso = doc.editar(capa, destino, "Transformar", (ctx) => {
        ctx.transform(matriz.a, matriz.b, matriz.c, matriz.d, matriz.e, matriz.f);
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(imagen, 0, 0);
      });
      if (paso) pasos.push(paso);
    }
  lienzo.historial.registrar(new PasoCompuesto(descripcion, pasos));
  lienzo.actualizarFantasma();
}

/** Cancela: devuelve el dibujo a las capas tal como estaba. */
export async function cancelar(lienzo: Lienzo, levantado: Levantado): Promise<void> {
  await levantado.borrado.deshacer();
  lienzo.actualizarFantasma();
}
