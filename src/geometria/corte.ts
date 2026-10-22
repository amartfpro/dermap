import type { Malla } from "./aplanador";

type P3 = [number, number, number];

/**
 * Corte por defecto de una manga, calculado en TypeScript para poder mostrarlo antes de aplanar
 * (RF-23). Es el mismo criterio que usa el módulo de geometría: empieza en el punto del primer
 * borde más alejado de `direccionExterna` (la cara que no se ve) y sigue el camino más corto por
 * las aristas hasta el otro borde, penalizando recorrer los bordes.
 *
 * Devuelve null si la zona no es una manga (no tiene exactamente dos bordes).
 */
export function corteSugerido(malla: Malla, direccionExterna: P3): { camino: number[]; extremos: [number, number] } | null {
  const bordes = bordesDe(malla);
  if (bordes.length !== 2) return null;
  const v = malla.vertices;
  const proyeccion = (i: number) => v[3 * i] * direccionExterna[0] + v[3 * i + 1] * direccionExterna[1] + v[3 * i + 2] * direccionExterna[2];
  const a = bordes[0].reduce((mejor, i) => (proyeccion(i) < proyeccion(mejor) ? i : mejor));
  const enBorde = new Uint8Array(v.length / 3);
  const destino = new Uint8Array(v.length / 3);
  for (const i of bordes[0]) enBorde[i] = 1;
  for (const i of bordes[1]) enBorde[i] = destino[i] = 1;
  const camino = caminoMinimo(malla, a, destino, enBorde);
  if (camino.length < 2) return null;
  return { camino, extremos: [a, camino[camino.length - 1]] };
}

/**
 * Corte extra (RF-25) hasta el vértice `objetivo`: el camino más corto desde el borde más
 * cercano, como una pinza de costura. Devuelve los vértices empezando en el borde.
 */
export function corteExtraHasta(malla: Malla, objetivo: number): number[] {
  const bordes = bordesDe(malla);
  const enBorde = new Uint8Array(malla.vertices.length / 3);
  for (const b of bordes) for (const i of b) enBorde[i] = 1;
  if (enBorde[objetivo]) return [];
  return caminoMinimo(malla, objetivo, enBorde, enBorde).reverse();
}

/** Vértice de la malla más cercano a un punto. */
export function verticeMasCercano(malla: Malla, p: P3): number {
  const v = malla.vertices;
  let mejor = 0;
  let distancia = Infinity;
  for (let i = 0; i < v.length / 3; i++) {
    const d = (v[3 * i] - p[0]) ** 2 + (v[3 * i + 1] - p[1]) ** 2 + (v[3 * i + 2] - p[2]) ** 2;
    if (d < distancia) {
      distancia = d;
      mejor = i;
    }
  }
  return mejor;
}

/** Bordes de la malla como listas de vértices (sin ordenar dentro de cada borde). */
export function bordesDe(malla: Malla): number[][] {
  const usos = new Map<string, number>();
  const clave = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  const c = malla.caras;
  for (let f = 0; f < c.length / 3; f++)
    for (let j = 0; j < 3; j++) {
      const k = clave(c[3 * f + j], c[3 * f + ((j + 1) % 3)]);
      usos.set(k, (usos.get(k) ?? 0) + 1);
    }
  // Unión de vértices conectados por aristas de borde.
  const padre = new Map<number, number>();
  const raiz = (x: number): number => {
    let r = x;
    while (padre.get(r) !== r) r = padre.get(r)!;
    padre.set(x, r);
    return r;
  };
  for (const [k, n] of usos) {
    if (n !== 1) continue;
    const [a, b] = k.split(",").map(Number);
    if (!padre.has(a)) padre.set(a, a);
    if (!padre.has(b)) padre.set(b, b);
    padre.set(raiz(a), raiz(b));
  }
  const grupos = new Map<number, number[]>();
  for (const x of padre.keys()) {
    const r = raiz(x);
    const g = grupos.get(r);
    if (g) g.push(x);
    else grupos.set(r, [x]);
  }
  return [...grupos.values()];
}

function caminoMinimo(malla: Malla, desde: number, destino: Uint8Array, enBorde: Uint8Array): number[] {
  const v = malla.vertices;
  const n = v.length / 3;
  const vecinos: [number, number][][] = Array.from({ length: n }, () => []);
  const c = malla.caras;
  for (let f = 0; f < c.length / 3; f++)
    for (let j = 0; j < 3; j++) {
      const a = c[3 * f + j];
      const b = c[3 * f + ((j + 1) % 3)];
      let peso = Math.hypot(v[3 * a] - v[3 * b], v[3 * a + 1] - v[3 * b + 1], v[3 * a + 2] - v[3 * b + 2]);
      if (enBorde[a] && enBorde[b]) peso *= 1000;
      vecinos[a].push([b, peso]);
      vecinos[b].push([a, peso]);
    }
  const distancia = new Float64Array(n).fill(Infinity);
  const anterior = new Int32Array(n).fill(-1);
  const hecho = new Uint8Array(n);
  distancia[desde] = 0;
  // Montículo binario sencillo de [distancia, vértice].
  const monticulo: [number, number][] = [[0, desde]];
  const subir = (i: number) => {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (monticulo[p][0] <= monticulo[i][0]) break;
      [monticulo[p], monticulo[i]] = [monticulo[i], monticulo[p]];
      i = p;
    }
  };
  const bajar = (i: number) => {
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < monticulo.length && monticulo[l][0] < monticulo[m][0]) m = l;
      if (r < monticulo.length && monticulo[r][0] < monticulo[m][0]) m = r;
      if (m === i) break;
      [monticulo[m], monticulo[i]] = [monticulo[i], monticulo[m]];
      i = m;
    }
  };
  let llegada = -1;
  while (monticulo.length) {
    const [d, x] = monticulo[0];
    const ultimo = monticulo.pop()!;
    if (monticulo.length) {
      monticulo[0] = ultimo;
      bajar(0);
    }
    if (hecho[x]) continue;
    hecho[x] = 1;
    if (destino[x] && x !== desde) {
      llegada = x;
      break;
    }
    for (const [y, peso] of vecinos[x]) {
      if (d + peso < distancia[y]) {
        distancia[y] = d + peso;
        anterior[y] = x;
        monticulo.push([distancia[y], y]);
        subir(monticulo.length - 1);
      }
    }
  }
  const camino: number[] = [];
  for (let x = llegada; x !== -1; x = anterior[x]) camino.push(x);
  return camino.reverse();
}
