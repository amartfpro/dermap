import type { Aplanado, Malla } from "./aplanador";

export interface Deformacion {
  /** Error de longitud de cada triángulo: max(σ1 − 1, 1 − σ2). 0,02 = 2 %. */
  porCara: Float64Array;
  /** Porcentaje del área con error ≤ 2 %. */
  areaDentroDel2: number;
  /** Error en el percentil 95 del área. */
  p95: number;
  /** Error máximo. */
  maximo: number;
}

/** Calcula la deformación, opcionalmente solo en los triángulos que cumplan `filtro`. */
export function medirDeformacion(
  malla: Malla,
  aplanado: Aplanado,
  filtro: (centro: [number, number, number]) => boolean = () => true,
): Deformacion {
  const nF = aplanado.caras.length / 3;
  const porCara = new Float64Array(nF);
  const muestras: { error: number; area: number }[] = [];
  let areaTotal = 0;
  for (let f = 0; f < nF; f++) {
    const s1 = aplanado.estiramiento[2 * f];
    const s2 = aplanado.estiramiento[2 * f + 1];
    porCara[f] = Math.max(s1 - 1, 1 - s2);

    const vs = [0, 1, 2].map((j) => aplanado.origen[aplanado.caras[3 * f + j]]);
    const p = vs.map((v) => [malla.vertices[3 * v], malla.vertices[3 * v + 1], malla.vertices[3 * v + 2]]);
    const centro: [number, number, number] = [0, 1, 2].map((c) => (p[0][c] + p[1][c] + p[2][c]) / 3) as [number, number, number];
    if (!filtro(centro)) continue;
    const area = areaTriangulo(p[0], p[1], p[2]);
    muestras.push({ error: porCara[f], area });
    areaTotal += area;
  }
  muestras.sort((a, b) => a.error - b.error);
  let acumulada = 0;
  let p95 = 0;
  let dentro = 0;
  for (const m of muestras) {
    acumulada += m.area;
    if (m.error <= 0.02) dentro += m.area;
    if (acumulada <= 0.95 * areaTotal) p95 = m.error;
  }
  return {
    porCara,
    areaDentroDel2: (100 * dentro) / areaTotal,
    p95,
    maximo: muestras.length ? muestras[muestras.length - 1].error : 0,
  };
}

function areaTriangulo(a: number[], b: number[], c: number[]): number {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const x = u[1] * v[2] - u[2] * v[1];
  const y = u[2] * v[0] - u[0] * v[2];
  const z = u[0] * v[1] - u[1] * v[0];
  return 0.5 * Math.hypot(x, y, z);
}
