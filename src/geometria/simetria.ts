import type { Malla } from "./aplanador";

/**
 * Simetría izquierda–derecha del cuerpo base (la malla de MakeHuman es simétrica respecto
 * al plano x = 0). Sirve para llevar un diseño a la zona simétrica en espejo.
 */
export interface Simetria {
  /** Vértice simétrico de cada vértice. */
  vertices: Int32Array;
  /** Triángulo simétrico de cada triángulo (-1 si no lo hay). */
  triangulos: Int32Array;
  /** Caras de la malla base (para emparejar las esquinas de un triángulo con las de su reflejo). */
  caras: Int32Array;
}

let actual: Simetria | null = null;

/** Calcula la simetría del cuerpo base (una vez, al cargarlo, con la postura recta). */
export function prepararSimetria(cuerpo: Malla): Simetria {
  actual = calcularSimetria(cuerpo);
  return actual;
}

export function simetriaActual(): Simetria | null {
  return actual;
}

export function calcularSimetria(m: Malla): Simetria {
  const v = m.vertices;
  const n = v.length / 3;
  // Rejilla de 1 cm para buscar el vecino más cercano de (−x, y, z).
  const celda = 1;
  const clave = (x: number, y: number, z: number) => `${Math.floor(x / celda)},${Math.floor(y / celda)},${Math.floor(z / celda)}`;
  const rejilla = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const k = clave(v[3 * i], v[3 * i + 1], v[3 * i + 2]);
    const l = rejilla.get(k);
    if (l) l.push(i);
    else rejilla.set(k, [i]);
  }
  const vertices = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const x = -v[3 * i], y = v[3 * i + 1], z = v[3 * i + 2];
    let mejor = -1, d = Infinity;
    for (let radio = 1; radio <= 3 && mejor < 0; radio++) {
      const cx = Math.floor(x / celda), cy = Math.floor(y / celda), cz = Math.floor(z / celda);
      for (let a = -radio; a <= radio; a++)
        for (let b = -radio; b <= radio; b++)
          for (let c = -radio; c <= radio; c++) {
            for (const j of rejilla.get(`${cx + a},${cy + b},${cz + c}`) ?? []) {
              const e = (v[3 * j] - x) ** 2 + (v[3 * j + 1] - y) ** 2 + (v[3 * j + 2] - z) ** 2;
              if (e < d) {
                d = e;
                mejor = j;
              }
            }
          }
    }
    vertices[i] = mejor;
  }
  const caras = m.caras;
  const nT = caras.length / 3;
  const porVertices = new Map<string, number>();
  const ordenada = (a: number, b: number, c: number) => [a, b, c].sort((p, q) => p - q).join(",");
  for (let t = 0; t < nT; t++) porVertices.set(ordenada(caras[3 * t], caras[3 * t + 1], caras[3 * t + 2]), t);
  const triangulos = new Int32Array(nT).fill(-1);
  for (let t = 0; t < nT; t++) {
    const a = vertices[caras[3 * t]], b = vertices[caras[3 * t + 1]], c = vertices[caras[3 * t + 2]];
    if (a < 0 || b < 0 || c < 0) continue;
    triangulos[t] = porVertices.get(ordenada(a, b, c)) ?? -1;
  }
  return { vertices, triangulos, caras };
}
