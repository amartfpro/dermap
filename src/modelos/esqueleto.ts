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
