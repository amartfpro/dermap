import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { aBlob } from "../lienzo/documento";
import { PPP } from "../lienzo/geometria-zona";
import type { Lienzo } from "../lienzo/lienzo";
import { contexto, crearLamina, desdeClave, intersecar, TESELA, type Lamina, type Rect } from "../lienzo/teselas";

/**
 * Exportación del stencil a escala real (RF-50) en PDF A4 —dividido en piezas si no cabe en
 * una hoja (RF-51)— o en PNG a 300 ppp, con las capas elegidas (RF-54).
 */
export interface OpcionesStencil {
  /** Ids de las capas que se incluyen. */
  capas: Set<string>;
  /** Convierte a negro puro sobre blanco (impresora térmica de stencil). */
  soloLineas: boolean;
  /** Dibuja el contorno de la zona (discontinuo) y la costura del corte (raya y punto). */
  contorno: boolean;
  formato: "pdf" | "png";
}

const MM_POR_PULGADA = 25.4;
const PT_POR_MM = 72 / MM_POR_PULGADA;
const PX_POR_MM = PPP / MM_POR_PULGADA;
const A4: [number, number] = [210, 297];
/** Márgenes de la hoja en mm: laterales, superior (cabecera) e inferior (regla). */
const MARGEN = { lado: 8, arriba: 14, abajo: 20 };
const SOLAPE_MM = 10;

export interface Pieza {
  rect: Rect; // px del documento
  fila: number;
  columna: number;
}

export interface Plan {
  rect: Rect;
  apaisado: boolean;
  filas: number;
  columnas: number;
  piezas: Pieza[];
}

/** Zona del documento que se exporta: lo dibujado en las capas elegidas, dentro de la zona. */
export function rectContenido(lienzo: Lienzo, capas: Set<string>): Rect {
  const zona = rectZona(lienzo);
  let r: Rect = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const capa of lienzo.doc.capas) {
    if (!capas.has(capa.id)) continue;
    for (const clave of capa.teselas.keys()) {
      const [tx, ty] = desdeClave(clave);
      r = {
        x0: Math.min(r.x0, tx * TESELA),
        y0: Math.min(r.y0, ty * TESELA),
        x1: Math.max(r.x1, (tx + 1) * TESELA),
        y1: Math.max(r.y1, (ty + 1) * TESELA),
      };
    }
  }
  if (!Number.isFinite(r.x0)) return zona;
  const i = intersecar(r, zona);
  return i.x1 > i.x0 && i.y1 > i.y0 ? i : zona;
}

/** Caja del contorno de la zona, con 3 mm de margen. */
function rectZona(lienzo: Lienzo): Rect {
  const puntos = lienzo.geo.bordes.flat();
  const m = 3 * PX_POR_MM;
  return {
    x0: Math.max(0, Math.floor(Math.min(...puntos.map((p) => p[0])) - m)),
    y0: Math.max(0, Math.floor(Math.min(...puntos.map((p) => p[1])) - m)),
    x1: Math.min(lienzo.doc.ancho, Math.ceil(Math.max(...puntos.map((p) => p[0])) + m)),
    y1: Math.min(lienzo.doc.alto, Math.ceil(Math.max(...puntos.map((p) => p[1])) + m)),
  };
}

/** Reparte el contenido en hojas A4 con solape, en la orientación que necesite menos hojas. */
export function planificar(rect: Rect): Plan {
  const anchoMm = (rect.x1 - rect.x0) / PX_POR_MM;
  const altoMm = (rect.y1 - rect.y0) / PX_POR_MM;
  const opciones = [false, true].map((apaisado) => {
    const [pw, ph] = areaUtil(apaisado);
    const columnas = anchoMm <= pw ? 1 : Math.ceil((anchoMm - SOLAPE_MM) / (pw - SOLAPE_MM));
    const filas = altoMm <= ph ? 1 : Math.ceil((altoMm - SOLAPE_MM) / (ph - SOLAPE_MM));
    return { apaisado, columnas, filas };
  });
  const mejor = opciones[0].columnas * opciones[0].filas <= opciones[1].columnas * opciones[1].filas ? opciones[0] : opciones[1];
  const [pw, ph] = areaUtil(mejor.apaisado);
  const paso = [(pw - SOLAPE_MM) * PX_POR_MM, (ph - SOLAPE_MM) * PX_POR_MM];
  const piezas: Pieza[] = [];
  for (let fila = 0; fila < mejor.filas; fila++)
    for (let columna = 0; columna < mejor.columnas; columna++) {
      const x0 = rect.x0 + columna * paso[0];
      const y0 = rect.y0 + fila * paso[1];
      piezas.push({
        fila,
        columna,
        rect: {
          x0: Math.round(x0),
          y0: Math.round(y0),
          x1: Math.round(Math.min(rect.x1, x0 + pw * PX_POR_MM)),
          y1: Math.round(Math.min(rect.y1, y0 + ph * PX_POR_MM)),
        },
      });
    }
  return { rect, ...mejor, piezas };
}

function areaUtil(apaisado: boolean): [number, number] {
  const [w, h] = apaisado ? [A4[1], A4[0]] : A4;
  return [w - 2 * MARGEN.lado, h - MARGEN.arriba - MARGEN.abajo];
}

/** Dibuja una región del stencil a 300 ppp sobre blanco. */
export function renderizar(lienzo: Lienzo, r: Rect, opciones: OpcionesStencil): Lamina {
  const ancho = r.x1 - r.x0;
  const alto = r.y1 - r.y0;
  const c = crearLamina(ancho, alto);
  const ctx = contexto(c);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, ancho, alto);
  ctx.save();
  ctx.translate(-r.x0, -r.y0);
  ctx.clip(lienzo.geo.recorte);
  lienzo.doc.componer(ctx, r, (capa) => opciones.capas.has(capa.id));
  ctx.restore();
  if (opciones.soloLineas) umbralizar(ctx, ancho, alto);
  if (opciones.contorno) {
    ctx.save();
    ctx.translate(-r.x0, -r.y0);
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 0.25 * PX_POR_MM;
    ctx.setLineDash([2 * PX_POR_MM, 1.5 * PX_POR_MM]);
    ctx.stroke(lienzo.geo.contorno);
    ctx.lineWidth = 0.35 * PX_POR_MM;
    ctx.setLineDash([4 * PX_POR_MM, 1 * PX_POR_MM, 0.6 * PX_POR_MM, 1 * PX_POR_MM]);
    ctx.stroke(lienzo.geo.costura);
    ctx.restore();
  }
  return c;
}

/** Negro puro donde la tinta oscurece más de la mitad; blanco en el resto. */
function umbralizar(ctx: ReturnType<typeof contexto>, ancho: number, alto: number): void {
  const img = ctx.getImageData(0, 0, ancho, alto);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const luz = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = luz < 128 ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

export interface ResultadoExportacion {
  bytes: Uint8Array;
  extension: "pdf" | "png";
  hojas: number;
}

export async function exportarStencil(
  lienzo: Lienzo,
  opciones: OpcionesStencil,
  progreso?: (texto: string) => void,
): Promise<ResultadoExportacion> {
  const rect = rectContenido(lienzo, opciones.capas);
  if (opciones.formato === "png") {
    progreso?.("Generando la imagen…");
    const png = new Uint8Array(await (await aBlob(renderizar(lienzo, rect, opciones))).arrayBuffer());
    return { bytes: conResolucion(png, PPP), extension: "png", hojas: 1 };
  }

  const plan = planificar(rect);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Stencil · ${lienzo.nombre}`);
  pdf.setCreator("Dermap");
  const fuente = await pdf.embedFont(StandardFonts.Helvetica);
  const total = plan.piezas.length;
  for (const [i, pieza] of plan.piezas.entries()) {
    progreso?.(`Generando hoja ${i + 1} de ${total}…`);
    const [w, h] = plan.apaisado ? [A4[1], A4[0]] : A4;
    const pagina = pdf.addPage([w * PT_POR_MM, h * PT_POR_MM]);
    const imagen = await pdf.embedPng(await (await aBlob(renderizar(lienzo, pieza.rect, opciones))).arrayBuffer());
    const anchoMm = (pieza.rect.x1 - pieza.rect.x0) / PX_POR_MM;
    const altoMm = (pieza.rect.y1 - pieza.rect.y0) / PX_POR_MM;
    // Coordenadas PDF: origen abajo a la izquierda, en puntos.
    const x = MARGEN.lado;
    const yArriba = h - MARGEN.arriba;
    pagina.drawImage(imagen, {
      x: x * PT_POR_MM,
      y: (yArriba - altoMm) * PT_POR_MM,
      width: anchoMm * PT_POR_MM,
      height: altoMm * PT_POR_MM,
    });
    marcarSolapes(pagina, plan, pieza, x, yArriba, anchoMm, altoMm);
    const titulo =
      total > 1
        ? `${lienzo.nombre} · hoja ${i + 1} de ${total} (fila ${pieza.fila + 1}, columna ${pieza.columna + 1}) · escala 1:1`
        : `${lienzo.nombre} · escala 1:1`;
    texto(pagina, fuente, `Dermap · ${titulo}`, MARGEN.lado, h - 8, 8);
    regla(pagina, fuente, MARGEN.lado, 9);
  }
  return { bytes: await pdf.save(), extension: "pdf", hojas: total };
}

/** Bandas de solape con las hojas vecinas: borde punteado y a qué hoja unir. */
function marcarSolapes(pagina: PDFPage, plan: Plan, pieza: Pieza, x: number, yArriba: number, anchoMm: number, altoMm: number): void {
  const gris = rgb(0.45, 0.45, 0.45);
  const linea = (x0: number, y0: number, x1: number, y1: number) =>
    pagina.drawLine({
      start: { x: x0 * PT_POR_MM, y: y0 * PT_POR_MM },
      end: { x: x1 * PT_POR_MM, y: y1 * PT_POR_MM },
      thickness: 0.4,
      color: gris,
      dashArray: [3, 2],
    });
  const yAbajo = yArriba - altoMm;
  // Marco de la pieza.
  linea(x, yArriba, x + anchoMm, yArriba);
  linea(x, yAbajo, x + anchoMm, yAbajo);
  linea(x, yAbajo, x, yArriba);
  linea(x + anchoMm, yAbajo, x + anchoMm, yArriba);
  // Inicio del solape con la hoja de la derecha y con la de abajo.
  if (pieza.columna < plan.columnas - 1) linea(x + anchoMm - SOLAPE_MM, yAbajo, x + anchoMm - SOLAPE_MM, yArriba);
  if (pieza.fila < plan.filas - 1) linea(x, yAbajo + SOLAPE_MM, x + anchoMm, yAbajo + SOLAPE_MM);
}

/** Regla de 10 cm con marcas cada milímetro, para comprobar la escala de impresión. */
function regla(pagina: PDFPage, fuente: PDFFont, xMm: number, yMm: number): void {
  const negro = rgb(0, 0, 0);
  const pt = (mm: number) => mm * PT_POR_MM;
  pagina.drawLine({ start: { x: pt(xMm), y: pt(yMm) }, end: { x: pt(xMm + 100), y: pt(yMm) }, thickness: 0.6, color: negro });
  for (let mm = 0; mm <= 100; mm++) {
    const largo = mm % 10 === 0 ? 3 : mm % 5 === 0 ? 2 : 1;
    pagina.drawLine({ start: { x: pt(xMm + mm), y: pt(yMm) }, end: { x: pt(xMm + mm), y: pt(yMm + largo) }, thickness: 0.3, color: negro });
    if (mm % 10 === 0) texto(pagina, fuente, String(mm / 10), xMm + mm - 0.6, yMm + 3.6, 6);
  }
  texto(pagina, fuente, "Imprime al 100 % (sin ajustar a la página)", xMm + 104, yMm + 2.6, 7);
  texto(pagina, fuente, "y comprueba que esta regla mide 10 cm.", xMm + 104, yMm - 0.4, 7);
}

function texto(pagina: PDFPage, fuente: PDFFont, t: string, xMm: number, yMm: number, tamano: number): void {
  // Las fuentes estándar del PDF solo cubren Latin-1: el resto de caracteres se sustituye.
  t = t.replace(/[^\u0020-\u007e\u00a0-\u00ff]/g, "?");
  pagina.drawText(t, { x: xMm * PT_POR_MM, y: yMm * PT_POR_MM, size: tamano, font: fuente, color: rgb(0.2, 0.2, 0.2) });
}

/** Añade al PNG un bloque pHYs con la resolución, para que se imprima a tamaño real. */
function conResolucion(png: Uint8Array, ppp: number): Uint8Array {
  const pxPorMetro = Math.round((ppp / MM_POR_PULGADA) * 1000);
  const datos = new Uint8Array(9);
  const vista = new DataView(datos.buffer);
  vista.setUint32(0, pxPorMetro);
  vista.setUint32(4, pxPorMetro);
  datos[8] = 1; // unidad: metro
  const tipo = new TextEncoder().encode("pHYs");
  const bloque = new Uint8Array(12 + datos.length);
  const v = new DataView(bloque.buffer);
  v.setUint32(0, datos.length);
  bloque.set(tipo, 4);
  bloque.set(datos, 8);
  v.setUint32(8 + datos.length, crc32(bloque.subarray(4, 8 + datos.length)));
  // Tras la firma (8 bytes) y el bloque IHDR (25 bytes).
  const fin = 33;
  const salida = new Uint8Array(png.length + bloque.length);
  salida.set(png.subarray(0, fin), 0);
  salida.set(bloque, fin);
  salida.set(png.subarray(fin), fin + bloque.length);
  return salida;
}

let tablaCrc: Uint32Array | null = null;
function crc32(datos: Uint8Array): number {
  if (!tablaCrc) {
    tablaCrc = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tablaCrc[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of datos) crc = tablaCrc[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
