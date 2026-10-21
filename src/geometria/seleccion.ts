import type { Malla } from "./aplanador";

type P3 = [number, number, number];

/**
 * Zona seleccionada sobre una malla base: los triángulos elegidos y la submalla
 * reindexada que se envía al aplanador.
 */
export interface Seleccion {
  /** Índices de triángulos de la malla base (lo que se guarda en el proyecto). */
  triangulos: Int32Array;
  /** Submalla con solo los vértices usados. */
  malla: Malla;
  /** Para cada vértice de la submalla, su índice en la malla base. */
  verticeBase: Int32Array;
}

/** Construye la submalla de un conjunto de triángulos, quedándose con la mayor pieza conexa. */
export function submalla(base: Malla, triangulos: Iterable<number>): Seleccion {
  const lista = mayorComponente(base, [...triangulos]);
  const nuevo = new Map<number, number>();
  const verticeBase: number[] = [];
  const caras = new Int32Array(lista.length * 3);
  lista.forEach((t, i) => {
    for (let j = 0; j < 3; j++) {
      const v = base.caras[3 * t + j];
      let n = nuevo.get(v);
      if (n === undefined) {
        n = verticeBase.length;
        nuevo.set(v, n);
        verticeBase.push(v);
      }
      caras[3 * i + j] = n;
    }
  });
  const vertices = new Float64Array(verticeBase.length * 3);
  verticeBase.forEach((v, i) => vertices.set(base.vertices.subarray(3 * v, 3 * v + 3), 3 * i));
  return {
    triangulos: Int32Array.from(lista),
    malla: { vertices, caras },
    verticeBase: Int32Array.from(verticeBase),
  };
}

/**
 * Selecciona los triángulos alrededor de un eje (polilínea), por ejemplo hombro → codo → muñeca.
 * Entra un triángulo si sus tres vértices están entre las distancias `desde` y `hasta` medidas a lo
 * largo del eje (cm desde el primer punto) y a menos de `radio` cm del eje. Así se elige una manga
 * o un tramo de ella sin arrastrar el torso.
 */
export function seleccionarPorEje(base: Malla, eje: P3[], desde: number, hasta: number, radio: number): Seleccion {
  const nV = base.vertices.length / 3;
  const dentro = new Uint8Array(nV);
  for (let v = 0; v < nV; v++) {
    const p: P3 = [base.vertices[3 * v], base.vertices[3 * v + 1], base.vertices[3 * v + 2]];
    const { s, d } = proyectarEnPolilinea(p, eje);
    dentro[v] = s >= desde && s <= hasta && d <= radio ? 1 : 0;
  }
  const elegidos = new Set<number>();
  for (let t = 0; t < base.caras.length / 3; t++)
    if (dentro[base.caras[3 * t]] && dentro[base.caras[3 * t + 1]] && dentro[base.caras[3 * t + 2]]) elegidos.add(t);
  return submalla(base, suavizarSeleccion(base, elegidos));
}

/**
 * Suaviza el borde de una selección de triángulos: rellena los huecos de un triángulo
 * (con 2 o 3 vecinos seleccionados) y quita las puntas (con 0 o 1). Los triángulos de la
 * malla base son alargados y una selección a pincel deja bordes dentados sin esto.
 */
export function suavizarSeleccion(base: Malla, seleccion: Set<number>, pasadas = 3): Set<number> {
  const vecinos = vecinosPorArista(base);
  let actual = new Set(seleccion);
  for (let p = 0; p < pasadas; p++) {
    const siguiente = new Set(actual);
    const candidatos = new Set<number>();
    for (const t of actual) {
      candidatos.add(t);
      for (const v of vecinos[t]) candidatos.add(v);
    }
    let cambios = 0;
    for (const t of candidatos) {
      const n = vecinos[t].reduce((s, v) => s + (actual.has(v) ? 1 : 0), 0);
      if (!actual.has(t) && n >= 2) {
        siguiente.add(t);
        cambios++;
      } else if (actual.has(t) && n <= 1) {
        siguiente.delete(t);
        cambios++;
      }
    }
    actual = siguiente;
    if (cambios === 0) break;
  }
  return actual;
}

const cacheVecinos = new WeakMap<Malla, number[][]>();

/** Para cada triángulo, los triángulos que comparten una arista con él. */
function vecinosPorArista(base: Malla): number[][] {
  const guardado = cacheVecinos.get(base);
  if (guardado) return guardado;
  const n = base.caras.length / 3;
  const porArista = new Map<string, number>();
  const vecinos: number[][] = Array.from({ length: n }, () => []);
  for (let t = 0; t < n; t++)
    for (let j = 0; j < 3; j++) {
      const a = base.caras[3 * t + j];
      const b = base.caras[3 * t + ((j + 1) % 3)];
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      const otro = porArista.get(k);
      if (otro === undefined) porArista.set(k, t);
      else {
        vecinos[t].push(otro);
        vecinos[otro].push(t);
      }
    }
  cacheVecinos.set(base, vecinos);
  return vecinos;
}

/** Longitud total de una polilínea. */
export function longitud(eje: P3[]): number {
  let total = 0;
  for (let i = 0; i + 1 < eje.length; i++) total += Math.hypot(...resta(eje[i + 1], eje[i]));
  return total;
}

/** Distancia a lo largo de la polilínea (s) del punto más cercano, y distancia al eje (d). */
export function proyectarEnPolilinea(p: P3, eje: P3[]): { s: number; d: number } {
  let mejor = { s: 0, d: Infinity };
  let acumulado = 0;
  for (let i = 0; i + 1 < eje.length; i++) {
    const a = eje[i];
    const ab = resta(eje[i + 1], a);
    const largo = Math.hypot(...ab);
    const ap = resta(p, a);
    const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (largo * largo)));
    const d = Math.hypot(ap[0] - t * ab[0], ap[1] - t * ab[1], ap[2] - t * ab[2]);
    if (d < mejor.d) mejor = { s: acumulado + t * largo, d };
    acumulado += largo;
  }
  return mejor;
}

function resta(a: P3, b: P3): P3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** Mayor grupo de triángulos conectados por aristas (descarta islas sueltas de la selección). */
function mayorComponente(base: Malla, triangulos: number[]): number[] {
  if (triangulos.length === 0) return [];
  const porArista = new Map<string, number[]>();
  const clave = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  triangulos.forEach((t, i) => {
    for (let j = 0; j < 3; j++) {
      const k = clave(base.caras[3 * t + j], base.caras[3 * t + ((j + 1) % 3)]);
      const lista = porArista.get(k);
      if (lista) lista.push(i);
      else porArista.set(k, [i]);
    }
  });
  const grupo = new Int32Array(triangulos.length).fill(-1);
  let mejor = -1;
  let mejorTamano = 0;
  for (let inicio = 0; inicio < triangulos.length; inicio++) {
    if (grupo[inicio] >= 0) continue;
    const pila = [inicio];
    grupo[inicio] = inicio;
    let tamano = 0;
    while (pila.length) {
      const i = pila.pop()!;
      tamano++;
      const t = triangulos[i];
      for (let j = 0; j < 3; j++) {
        for (const vecino of porArista.get(clave(base.caras[3 * t + j], base.caras[3 * t + ((j + 1) % 3)]))!) {
          if (grupo[vecino] < 0) {
            grupo[vecino] = inicio;
            pila.push(vecino);
          }
        }
      }
    }
    if (tamano > mejorTamano) {
      mejorTamano = tamano;
      mejor = inicio;
    }
  }
  return triangulos.filter((_, i) => grupo[i] === mejor);
}
