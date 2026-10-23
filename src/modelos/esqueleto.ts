import datos from "./esqueleto.json";
import type { Cuerpo } from "./cuerpo";

type P3 = [number, number, number];
/** Cuaternión (x, y, z, w). */
type Q = [number, number, number, number];

type Ref = { c: string } | { v: number[] } | { e: string[]; t: number };
interface Hueso {
  n: string;
  p: number;
  cabeza: Ref;
  cola: Ref;
}

/**
 * Esqueleto de MakeHuman (rig «default» de MPFB, CC0) con sus pesos por vértice. Las
 * posiciones de los huesos se calculan del cuerpo actual (complexión y medidas incluidas), así
 * que el esqueleto siempre encaja con el cliente.
 */
export const HUESOS: Hueso[] = datos.huesos as Hueso[];
const indiceHueso = new Map(HUESOS.map((h, i) => [h.n, i]));
const INDICES = base64(datos.indices);
const PESOS = base64(datos.pesos);

function base64(s: string): Uint8Array {
  const bin = atob(s);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}

export function hueso(nombre: string): number {
  const i = indiceHueso.get(nombre);
  if (i === undefined) throw new Error(`Hueso desconocido: ${nombre}`);
  return i;
}

function punto(cuerpo: Cuerpo, r: Ref): P3 {
  if ("c" in r) return cuerpo.articulaciones[r.c] ?? [0, 0, 0];
  if ("v" in r) {
    const v = cuerpo.vertices;
    const s: P3 = [0, 0, 0];
    for (const i of r.v) for (let k = 0; k < 3; k++) s[k] += v[3 * i + k];
    return s.map((x) => x / r.v.length) as P3;
  }
  const a = cuerpo.articulaciones[r.e[0]], b = cuerpo.articulaciones[r.e[1]];
  return [0, 1, 2].map((k) => a[k] + r.t * (b[k] - a[k])) as P3;
}

/** Cabeza y cola de cada hueso en el cuerpo dado (en reposo). */
export function posicionesHuesos(cuerpo: Cuerpo): { cabezas: P3[]; colas: P3[] } {
  return { cabezas: HUESOS.map((h) => punto(cuerpo, h.cabeza)), colas: HUESOS.map((h) => punto(cuerpo, h.cola)) };
}

/** Giro de un hueso alrededor de su cabeza: eje en coordenadas del cuerpo en reposo. */
export interface GiroHueso {
  hueso: number;
  eje: P3;
  /** Radianes. */
  angulo: number;
}

/**
 * Pone el cuerpo en una postura: cada hueso hereda los giros de sus padres y la piel se
 * deforma con skinning de cuaterniones duales (conserva el volumen en codos y rodillas, sin el
 * «efecto caramelo» del skinning lineal). Devuelve las posiciones nuevas y la transformación
 * de cada hueso (para mover también las articulaciones).
 */
export function posar(cuerpo: Cuerpo, giros: GiroHueso[]): { vertices: Float64Array; rotaciones: Q[]; traslaciones: P3[] } {
  const { cabezas } = posicionesHuesos(cuerpo);
  const propio = new Map<number, Q>();
  for (const g of giros) {
    if (!g.angulo) continue;
    const q = cuatEje(g.eje, g.angulo);
    propio.set(g.hueso, propio.has(g.hueso) ? mulQ(q, propio.get(g.hueso)!) : q);
  }
  const n = HUESOS.length;
  const rot: Q[] = new Array(n);
  const tra: P3[] = new Array(n);
  // Los padres van antes que los hijos (orden del archivo).
  for (let b = 0; b < n; b++) {
    const qr = propio.get(b) ?? [0, 0, 0, 1];
    const h = cabezas[b];
    // Giro alrededor de la cabeza: p → R(p − h) + h.
    const tr = sub(h, rotarQ(qr, h));
    const p = HUESOS[b].p;
    if (p < 0) {
      rot[b] = qr;
      tra[b] = tr;
    } else {
      rot[b] = mulQ(rot[p], qr);
      tra[b] = add(rotarQ(rot[p], tr), tra[p]);
    }
  }
  // Cuaterniones duales de cada hueso.
  const real = new Float64Array(n * 4), dual = new Float64Array(n * 4);
  for (let b = 0; b < n; b++) {
    const q = rot[b], t = tra[b];
    real.set(q, 4 * b);
    // dual = ½ · (t, 0) · q
    const d = mulQ([t[0], t[1], t[2], 0], q);
    dual.set([d[0] / 2, d[1] / 2, d[2] / 2, d[3] / 2], 4 * b);
  }
  const v0 = cuerpo.vertices;
  const nv = v0.length / 3;
  const v = new Float64Array(v0.length);
  for (let i = 0; i < nv; i++) {
    let rx = 0, ry = 0, rz = 0, rw = 0, dx = 0, dy = 0, dz = 0, dw = 0;
    let r0x = 0, r0y = 0, r0z = 0, r0w = 0;
    for (let k = 0; k < 4; k++) {
      const w8 = PESOS[4 * i + k];
      if (!w8) continue;
      const b = INDICES[4 * i + k];
      let w = w8 / 255;
      const o = 4 * b;
      if (k === 0) {
        r0x = real[o];
        r0y = real[o + 1];
        r0z = real[o + 2];
        r0w = real[o + 3];
      } else if (real[o] * r0x + real[o + 1] * r0y + real[o + 2] * r0z + real[o + 3] * r0w < 0) w = -w; // mismo hemisferio
      rx += w * real[o];
      ry += w * real[o + 1];
      rz += w * real[o + 2];
      rw += w * real[o + 3];
      dx += w * dual[o];
      dy += w * dual[o + 1];
      dz += w * dual[o + 2];
      dw += w * dual[o + 3];
    }
    const px = v0[3 * i], py = v0[3 * i + 1], pz = v0[3 * i + 2];
    const len = Math.hypot(rx, ry, rz, rw);
    if (!len) {
      v[3 * i] = px;
      v[3 * i + 1] = py;
      v[3 * i + 2] = pz;
      continue;
    }
    rx /= len;
    ry /= len;
    rz /= len;
    rw /= len;
    dx /= len;
    dy /= len;
    dz /= len;
    dw /= len;
    // Traslación: t = 2 · dual · conj(real)
    const t = mulQ([dx, dy, dz, dw], [-rx, -ry, -rz, rw]);
    const p = rotarQ([rx, ry, rz, rw], [px, py, pz]);
    v[3 * i] = p[0] + 2 * t[0];
    v[3 * i + 1] = p[1] + 2 * t[1];
    v[3 * i + 2] = p[2] + 2 * t[2];
  }
  return { vertices: v, rotaciones: rot, traslaciones: tra };
}

/** Aplica la transformación de un hueso a un punto. */
export function moverConHueso(r: { rotaciones: Q[]; traslaciones: P3[] }, b: number, p: P3): P3 {
  return add(rotarQ(r.rotaciones[b], p), r.traslaciones[b]);
}

/** Hueso que mueve cada articulación: aquel cuya cabeza (o, si no, cola) es esa articulación. */
export const HUESO_DE_ARTICULACION: Map<string, number> = (() => {
  const m = new Map<string, number>();
  HUESOS.forEach((h, i) => {
    if ("c" in h.cola && !m.has(h.cola.c)) m.set(h.cola.c, i);
  });
  HUESOS.forEach((h, i) => {
    if ("c" in h.cabeza) m.set(h.cabeza.c, i);
  });
  return m;
})();

// ── Cuaterniones ─────────────────────────────────────────────────────────────

function cuatEje(eje: P3, angulo: number): Q {
  const l = Math.hypot(...eje) || 1;
  const s = Math.sin(angulo / 2) / l;
  return [eje[0] * s, eje[1] * s, eje[2] * s, Math.cos(angulo / 2)];
}

function mulQ(a: Q, b: Q): Q {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function rotarQ(q: Q, p: P3): P3 {
  const [x, y, z, w] = q;
  // t = 2 · (q.xyz × p)
  const tx = 2 * (y * p[2] - z * p[1]);
  const ty = 2 * (z * p[0] - x * p[2]);
  const tz = 2 * (x * p[1] - y * p[0]);
  return [p[0] + w * tx + (y * tz - z * ty), p[1] + w * ty + (z * tx - x * tz), p[2] + w * tz + (x * ty - y * tx)];
}

const add = (a: P3, b: P3): P3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

// ── Delta Mush ───────────────────────────────────────────────────────────────

/**
 * Delta Mush (Mancewicz et al., 2014): corrige los pliegues y abultamientos del skinning en
 * hombros, axilas y caderas. Se suaviza la malla posada y se le devuelven los detalles de la
 * malla en reposo, guardados como desplazamientos en un marco local de cada vértice. En reposo
 * el resultado es exactamente el cuerpo original, y las zonas que se mueven rígidas no cambian.
 */
interface DatosMush {
  vecinos: Int32Array;
  inicio: Int32Array;
  /** Desplazamiento en reposo (vértice − suavizado), en el marco local (t, b, n). */
  delta: Float64Array;
}

const ITERACIONES_MUSH = 12;
const cacheMush = new WeakMap<Float64Array, DatosMush>();

function vecindario(caras: Int32Array, n: number): { vecinos: Int32Array; inicio: Int32Array } {
  const conj = Array.from({ length: n }, () => new Set<number>());
  for (let f = 0; f < caras.length; f += 3)
    for (let j = 0; j < 3; j++) {
      const a = caras[f + j], b = caras[f + ((j + 1) % 3)];
      conj[a].add(b);
      conj[b].add(a);
    }
  const inicio = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) inicio[i + 1] = inicio[i] + conj[i].size;
  const vecinos = new Int32Array(inicio[n]);
  conj.forEach((s, i) => vecinos.set([...s], inicio[i]));
  return { vecinos, inicio };
}

function suavizar(p: Float64Array, vecinos: Int32Array, inicio: Int32Array, iter: number): Float64Array {
  let a = Float64Array.from(p);
  let b = new Float64Array(p.length);
  const n = p.length / 3;
  for (let k = 0; k < iter; k++) {
    for (let i = 0; i < n; i++) {
      let sx = 0, sy = 0, sz = 0;
      const i0 = inicio[i], i1 = inicio[i + 1];
      for (let j = i0; j < i1; j++) {
        const v = vecinos[j];
        sx += a[3 * v];
        sy += a[3 * v + 1];
        sz += a[3 * v + 2];
      }
      const m = i1 - i0 || 1;
      // Mitad hacia la media de los vecinos: suavizado estable.
      b[3 * i] = 0.5 * a[3 * i] + (0.5 * sx) / m;
      b[3 * i + 1] = 0.5 * a[3 * i + 1] + (0.5 * sy) / m;
      b[3 * i + 2] = 0.5 * a[3 * i + 2] + (0.5 * sz) / m;
    }
    [a, b] = [b, a];
  }
  return a;
}

/** Marco local (tangente, binormal, normal) de cada vértice de una malla suavizada. */
function marco(s: Float64Array, vecinos: Int32Array, inicio: Int32Array, i: number, normales: Float64Array): number[] {
  const nx = normales[3 * i], ny = normales[3 * i + 1], nz = normales[3 * i + 2];
  const v = vecinos[inicio[i]];
  let tx = s[3 * v] - s[3 * i], ty = s[3 * v + 1] - s[3 * i + 1], tz = s[3 * v + 2] - s[3 * i + 2];
  const d = tx * nx + ty * ny + tz * nz;
  tx -= d * nx;
  ty -= d * ny;
  tz -= d * nz;
  const lt = Math.hypot(tx, ty, tz) || 1;
  tx /= lt;
  ty /= lt;
  tz /= lt;
  // b = n × t
  return [tx, ty, tz, ny * tz - nz * ty, nz * tx - nx * tz, nx * ty - ny * tx, nx, ny, nz];
}

function normalesDe(p: Float64Array, caras: Int32Array): Float64Array {
  const n = new Float64Array(p.length);
  for (let f = 0; f < caras.length; f += 3) {
    const a = caras[f], b = caras[f + 1], c = caras[f + 2];
    const ux = p[3 * b] - p[3 * a], uy = p[3 * b + 1] - p[3 * a + 1], uz = p[3 * b + 2] - p[3 * a + 2];
    const vx = p[3 * c] - p[3 * a], vy = p[3 * c + 1] - p[3 * a + 1], vz = p[3 * c + 2] - p[3 * a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    for (const i of [a, b, c]) {
      n[3 * i] += cx;
      n[3 * i + 1] += cy;
      n[3 * i + 2] += cz;
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l;
    n[i + 1] /= l;
    n[i + 2] /= l;
  }
  return n;
}

function datosMush(reposo: Float64Array, caras: Int32Array): DatosMush {
  const cache = cacheMush.get(reposo);
  if (cache) return cache;
  const n = reposo.length / 3;
  const { vecinos, inicio } = vecindario(caras, n);
  const s = suavizar(reposo, vecinos, inicio, ITERACIONES_MUSH);
  const normales = normalesDe(s, caras);
  const delta = new Float64Array(reposo.length);
  for (let i = 0; i < n; i++) {
    const m = marco(s, vecinos, inicio, i, normales);
    const dx = reposo[3 * i] - s[3 * i], dy = reposo[3 * i + 1] - s[3 * i + 1], dz = reposo[3 * i + 2] - s[3 * i + 2];
    delta[3 * i] = dx * m[0] + dy * m[1] + dz * m[2];
    delta[3 * i + 1] = dx * m[3] + dy * m[4] + dz * m[5];
    delta[3 * i + 2] = dx * m[6] + dy * m[7] + dz * m[8];
  }
  const datos = { vecinos, inicio, delta };
  cacheMush.set(reposo, datos);
  return datos;
}

/**
 * Aplica Delta Mush a una malla posada, solo donde `mascara` > 0 (0–1 por vértice): así las
 * manos, los pies y la cara conservan exactamente su forma.
 */
export function deltaMush(reposo: Float64Array, posada: Float64Array, caras: Int32Array, mascara: Float32Array): Float64Array {
  const { vecinos, inicio, delta } = datosMush(reposo, caras);
  const s = suavizar(posada, vecinos, inicio, ITERACIONES_MUSH);
  const normales = normalesDe(s, caras);
  const out = Float64Array.from(posada);
  const n = posada.length / 3;
  for (let i = 0; i < n; i++) {
    const w = mascara[i];
    if (!w) continue;
    const m = marco(s, vecinos, inicio, i, normales);
    const a = delta[3 * i], b = delta[3 * i + 1], c = delta[3 * i + 2];
    for (let k = 0; k < 3; k++) {
      const corregido = s[3 * i + k] + a * m[k] + b * m[3 + k] + c * m[6 + k];
      out[3 * i + k] = (1 - w) * posada[3 * i + k] + w * corregido;
    }
  }
  return out;
}

/**
 * Máscara de Delta Mush para unos huesos girados: vértices que reparten peso entre un hueso
 * girado y otro que no lo está (las zonas de articulación), con un borde suave.
 */
export function mascaraArticulaciones(caras: Int32Array, nv: number, girados: Set<number>): Float32Array {
  const mezcla = new Float32Array(nv);
  for (let i = 0; i < nv; i++) {
    let enGiro = 0;
    for (let k = 0; k < 4; k++) if (girados.has(INDICES[4 * i + k])) enGiro += PESOS[4 * i + k] / 255;
    // 1 en el reparto 50/50, 0 si todo el peso está de un lado.
    mezcla[i] = Math.min(1, 4 * enGiro * (1 - enGiro));
  }
  // Se ensancha y suaviza el borde.
  const { vecinos, inicio } = vecindario(caras, nv);
  let a = mezcla;
  for (let k = 0; k < 6; k++) {
    const b = new Float32Array(nv);
    for (let i = 0; i < nv; i++) {
      let m = a[i];
      for (let j = inicio[i]; j < inicio[i + 1]; j++) m = Math.max(m, a[vecinos[j]] * 0.85);
      b[i] = m;
    }
    a = b;
  }
  return a;
}

/** Huesos que heredan algún giro (los girados y todos sus descendientes). */
export function huesosAfectados(giros: GiroHueso[]): Set<number> {
  const s = new Set(giros.filter((g) => g.angulo).map((g) => g.hueso));
  HUESOS.forEach((h, i) => {
    if (h.p >= 0 && s.has(h.p)) s.add(i);
  });
  return s;
}
