import { t } from "../i18n";
import type { Simetria } from "../geometria/simetria";
import type { Lienzo } from "./lienzo";
import { contexto, crearLamina, teselasEn, TESELA, type Lamina, type Rect } from "./teselas";

type P2 = [number, number];

/**
 * Lleva el dibujo de un lienzo a otro a través del cuerpo (RF-29): como las dos zonas son
 * triángulos de la misma malla base, cada triángulo común tiene su sitio en los dos lienzos
 * y se copia con la transformación afín que los relaciona. Sirve para rehacer una zona con
 * otro corte, o ampliarla, sin volver a dibujar. Lo que queda fuera de la zona de origen no
 * se toca.
 *
 * Crea una capa nueva en el destino (se puede deshacer) y devuelve cuántos triángulos de
 * la zona de destino tenían dibujo de origen.
 */
export function transferirDibujo(origen: Lienzo, destino: Lienzo, espejo?: Simetria): { comunes: number; total: number } {
  // Triángulo del cuerpo → cara de la zona de origen.
  const enOrigen = new Map<number, number>();
  origen.zona.triangulos.forEach((t, i) => enOrigen.set(t, i));
  const pares: { s: P2[]; d: P2[]; rect: Rect }[] = [];
  destino.zona.triangulos.forEach((t, j) => {
    // En espejo, el triángulo de origen es el reflejo del de destino.
    const ts = espejo ? espejo.triangulos[t] : t;
    const i = ts < 0 ? undefined : enOrigen.get(ts);
    if (i === undefined) return;
    let s = esquinas(origen, i);
    if (espejo) {
      // Las esquinas del reflejo no van en el mismo orden: se emparejan por vértice.
      const c = espejo.caras;
      const orden = [0, 1, 2].map((k) => {
        const reflejo = espejo.vertices[c[3 * t + k]];
        return [0, 1, 2].find((m) => c[3 * ts + m] === reflejo) ?? k;
      });
      s = orden.map((m) => s[m]);
    }
    const d = esquinas(destino, j);
    pares.push({ s, d: ampliar(d, 0.75), rect: caja(d, 2) });
  });
  if (!pares.length) return { comunes: 0, total: destino.zona.triangulos.length };

  // Teselas del dibujo de origen (capas visibles compuestas), bajo demanda.
  const fuente = new Map<string, Lamina | null>();
  const teselaFuente = (tx: number, ty: number): Lamina | null => {
    const clave = `${tx},${ty}`;
    if (fuente.has(clave)) return fuente.get(clave)!;
    const r = { x0: tx * TESELA, y0: ty * TESELA, x1: (tx + 1) * TESELA, y1: (ty + 1) * TESELA };
    const algo = origen.doc.capas.some((c) => c.seVe && c.teselas.has(clave));
    let lamina: Lamina | null = null;
    if (algo) {
      lamina = crearLamina(TESELA, TESELA);
      const ctx = contexto(lamina);
      ctx.translate(-r.x0, -r.y0);
      origen.doc.componer(ctx, r);
    }
    fuente.set(clave, lamina);
    return lamina;
  };

  const doc = destino.doc;
  destino.historial.registrar(doc.instantaneaCapas(espejo ? t("Traer dibujo en espejo de {lienzo}", { lienzo: origen.nombre }) : t("Traer dibujo de {lienzo}", { lienzo: origen.nombre })));
  const capa = doc.añadirCapa(espejo ? t("De «{lienzo}» (espejo)", { lienzo: origen.nombre }) : t("De «{lienzo}»", { lienzo: origen.nombre }));
  let total: Rect | null = null;
  for (const par of pares) {
    const m = afin(par.s, par.d);
    // Parte del origen que cubre el triángulo.
    const rs = caja(par.s, 2);
    const teselasOrigen = teselasEn(rs, origen.doc.ancho, origen.doc.alto)
      .map(([tx, ty]) => [tx, ty, teselaFuente(tx, ty)] as const)
      .filter(([, , l]) => l);
    if (!teselasOrigen.length) continue;
    for (const [dx, dy] of teselasEn(par.rect, doc.ancho, doc.alto)) {
      const lamina = capa.obtenerOCrear(dx, dy);
      const ctx = contexto(lamina);
      ctx.save();
      ctx.translate(-dx * TESELA, -dy * TESELA);
      ctx.beginPath();
      ctx.moveTo(...par.d[0]);
      ctx.lineTo(...par.d[1]);
      ctx.lineTo(...par.d[2]);
      ctx.closePath();
      ctx.clip();
      ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
      ctx.imageSmoothingQuality = "high";
      for (const [tx, ty, l] of teselasOrigen) ctx.drawImage(l!, tx * TESELA, ty * TESELA);
      ctx.restore();
      capa.sucias.add(`${dx},${dy}`);
    }
    total = total ? unir(total, par.rect) : par.rect;
  }
  // Quita las teselas que han quedado vacías (triángulos sin dibujo en el origen).
  for (const [clave, lamina] of capa.teselas) {
    const datos = contexto(lamina).getImageData(0, 0, TESELA, TESELA).data;
    let vacia = true;
    for (let k = 3; k < datos.length; k += 4) if (datos[k]) { vacia = false; break; }
    if (vacia) {
      capa.teselas.delete(clave);
      capa.sucias.add(clave);
    }
  }
  if (total) doc.avisar(total);
  destino.actualizarFantasma();
  return { comunes: pares.length, total: destino.zona.triangulos.length };
}

/** Esquinas de la cara `i` de la zona de un lienzo, en píxeles del documento. */
function esquinas(l: Lienzo, i: number): P2[] {
  const c = l.zona.aplanado.caras;
  return [0, 1, 2].map((k) => l.geo.aLienzo(c[3 * i + k]) as P2);
}

/** Matriz afín que lleva los tres puntos `s` a los tres puntos `d`. */
export function afin(s: P2[], d: P2[]): DOMMatrix {
  const [s0, s1, s2] = s;
  const [d0, d1, d2] = d;
  const a1 = s1[0] - s0[0], b1 = s1[1] - s0[1];
  const a2 = s2[0] - s0[0], b2 = s2[1] - s0[1];
  const det = a1 * b2 - a2 * b1 || 1e-9;
  // Inversa de [[a1 a2] [b1 b2]].
  const i00 = b2 / det, i01 = -a2 / det, i10 = -b1 / det, i11 = a1 / det;
  const p1 = d1[0] - d0[0], q1 = d1[1] - d0[1];
  const p2 = d2[0] - d0[0], q2 = d2[1] - d0[1];
  const a = p1 * i00 + p2 * i10, c = p1 * i01 + p2 * i11;
  const b = q1 * i00 + q2 * i10, dd = q1 * i01 + q2 * i11;
  const e = d0[0] - a * s0[0] - c * s0[1];
  const f = d0[1] - b * s0[0] - dd * s0[1];
  return new DOMMatrix([a, b, c, dd, e, f]);
}

/** Agranda un triángulo `px` píxeles desde su centro, para que no queden rendijas entre vecinos. */
function ampliar(t: P2[], px: number): P2[] {
  const cx = (t[0][0] + t[1][0] + t[2][0]) / 3, cy = (t[0][1] + t[1][1] + t[2][1]) / 3;
  return t.map(([x, y]) => {
    const l = Math.hypot(x - cx, y - cy) || 1;
    return [x + ((x - cx) / l) * px, y + ((y - cy) / l) * px] as P2;
  });
}

function caja(t: P2[], margen: number): Rect {
  return {
    x0: Math.floor(Math.min(...t.map((p) => p[0])) - margen),
    y0: Math.floor(Math.min(...t.map((p) => p[1])) - margen),
    x1: Math.ceil(Math.max(...t.map((p) => p[0])) + margen),
    y1: Math.ceil(Math.max(...t.map((p) => p[1])) + margen),
  };
}

function unir(a: Rect, b: Rect): Rect {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}
