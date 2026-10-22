/**
 * Teselado de Phong (Boubekeur y Alexa, 2008) para que el cuerpo se vea redondeado sin
 * aristas en la silueta. Cada triángulo se divide en k² y los puntos nuevos se curvan según las
 * normales de sus vértices. Es local: un punto de una arista depende solo de los dos vértices
 * de esa arista, así que el cuerpo y las zonas de los lienzos (mallas distintas que comparten
 * vértices) dan exactamente la misma superficie y no se separan.
 *
 * Solo afecta a lo que se ve: la selección, los cortes y el aplanado usan la malla original.
 */
export interface PlanTeselado {
  k: number;
  /** Para cada vértice de salida: los tres vértices de origen y sus pesos (u, v; w = 1 − u − v). */
  a: Uint32Array;
  b: Uint32Array;
  c: Uint32Array;
  u: Float32Array;
  v: Float32Array;
  /** Triángulos de salida: los k² de cada triángulo de origen van seguidos, en orden. */
  indice: Uint32Array;
  /** Número de vértices de salida. */
  n: number;
}

/** Cuánto se curva la superficie (3/4 es el valor recomendado por los autores). */
const ALFA = 0.75;

export function crearPlanTeselado(caras: ArrayLike<number>, nVertices: number, k: number): PlanTeselado {
  const nT = caras.length / 3;
  // Aristas únicas (con el vértice menor primero).
  const aristas = new Map<number, number>();
  const listaAristas: [number, number][] = [];
  const clave = (x: number, y: number) => (x < y ? x * nVertices + y : y * nVertices + x);
  for (let t = 0; t < nT; t++)
    for (let j = 0; j < 3; j++) {
      const x = caras[3 * t + j], y = caras[3 * t + ((j + 1) % 3)];
      const c = clave(x, y);
      if (!aristas.has(c)) {
        aristas.set(c, listaAristas.length);
        listaAristas.push(x < y ? [x, y] : [y, x]);
      }
    }
  const porArista = k - 1;
  const porCara = ((k - 1) * (k - 2)) / 2;
  const n = nVertices + listaAristas.length * porArista + nT * porCara;
  const A = new Uint32Array(n), B = new Uint32Array(n), C = new Uint32Array(n);
  const U = new Float32Array(n), V = new Float32Array(n);
  for (let i = 0; i < nVertices; i++) {
    A[i] = B[i] = C[i] = i;
    U[i] = 1;
  }
  const baseAristas = nVertices;
  listaAristas.forEach(([x, y], e) => {
    for (let m = 1; m < k; m++) {
      const o = baseAristas + e * porArista + (m - 1);
      A[o] = x;
      B[o] = y;
      C[o] = y;
      U[o] = 1 - m / k;
      V[o] = m / k;
    }
  });
  const baseCaras = baseAristas + listaAristas.length * porArista;
  const indice = new Uint32Array(nT * k * k * 3);
  let q = 0;
  const idInterior = new Map<number, number>();
  for (let t = 0; t < nT; t++) {
    const pa = caras[3 * t], pb = caras[3 * t + 1], pc = caras[3 * t + 2];
    // Punto de la rejilla (r hacia B, s hacia C).
    let interior = 0;
    idInterior.clear();
    const punto = (r: number, s: number): number => {
      const l = k - r - s;
      if (r === 0 && s === 0) return pa;
      if (r === k) return pb;
      if (s === k) return pc;
      if (s === 0) return enArista(pa, pb, r);
      if (r === 0) return enArista(pa, pc, s);
      if (l === 0) return enArista(pb, pc, s);
      const ck = r * (k + 1) + s;
      let id = idInterior.get(ck);
      if (id === undefined) {
        id = baseCaras + t * porCara + interior++;
        idInterior.set(ck, id);
        A[id] = pa;
        B[id] = pb;
        C[id] = pc;
        U[id] = l / k;
        V[id] = r / k;
      }
      return id;
    };
    // m-ésimo punto de la arista x → y.
    const enArista = (x: number, y: number, m: number): number => {
      const e = aristas.get(clave(x, y))!;
      return baseAristas + e * porArista + (x < y ? m - 1 : k - 1 - m);
    };
    for (let r = 0; r < k; r++)
      for (let s = 0; s < k - r; s++) {
        indice[q++] = punto(r, s);
        indice[q++] = punto(r + 1, s);
        indice[q++] = punto(r, s + 1);
        if (r + s + 2 <= k) {
          indice[q++] = punto(r + 1, s);
          indice[q++] = punto(r + 1, s + 1);
          indice[q++] = punto(r, s + 1);
        }
      }
  }
  return { k, a: A, b: B, c: C, u: U, v: V, indice, n };
}

/**
 * Calcula posiciones y normales (y coordenadas de textura, si se dan) de la malla teselada.
 * `normales` deben ser unitarias.
 */
export function evaluarTeselado(
  plan: PlanTeselado,
  posiciones: ArrayLike<number>,
  normales: ArrayLike<number>,
  salidaPos: Float32Array,
  salidaNorm: Float32Array,
  uv?: ArrayLike<number>,
  salidaUv?: Float32Array,
): void {
  const { a, b, c, u, v, n } = plan;
  for (let o = 0; o < n; o++) {
    const i = a[o], j = b[o], l = c[o];
    const wu = u[o], wv = v[o], ww = 1 - wu - wv;
    const ix = 3 * i, jx = 3 * j, lx = 3 * l;
    // Punto lineal.
    const px = wu * posiciones[ix] + wv * posiciones[jx] + ww * posiciones[lx];
    const py = wu * posiciones[ix + 1] + wv * posiciones[jx + 1] + ww * posiciones[lx + 1];
    const pz = wu * posiciones[ix + 2] + wv * posiciones[jx + 2] + ww * posiciones[lx + 2];
    let nx = wu * normales[ix] + wv * normales[jx] + ww * normales[lx];
    let ny = wu * normales[ix + 1] + wv * normales[jx + 1] + ww * normales[lx + 1];
    let nz = wu * normales[ix + 2] + wv * normales[jx + 2] + ww * normales[lx + 2];
    if (wu === 1) {
      salidaPos[3 * o] = px;
      salidaPos[3 * o + 1] = py;
      salidaPos[3 * o + 2] = pz;
    } else {
      // Proyección del punto lineal en el plano tangente de cada vértice, mezclada.
      let qx = 0, qy = 0, qz = 0;
      for (const [w, x] of [
        [wu, ix],
        [wv, jx],
        [ww, lx],
      ] as const) {
        if (!w) continue;
        const d = (px - posiciones[x]) * normales[x] + (py - posiciones[x + 1]) * normales[x + 1] + (pz - posiciones[x + 2]) * normales[x + 2];
        qx += w * (px - d * normales[x]);
        qy += w * (py - d * normales[x + 1]);
        qz += w * (pz - d * normales[x + 2]);
      }
      salidaPos[3 * o] = (1 - ALFA) * px + ALFA * qx;
      salidaPos[3 * o + 1] = (1 - ALFA) * py + ALFA * qy;
      salidaPos[3 * o + 2] = (1 - ALFA) * pz + ALFA * qz;
    }
    const ln = Math.hypot(nx, ny, nz) || 1;
    nx /= ln;
    ny /= ln;
    nz /= ln;
    salidaNorm[3 * o] = nx;
    salidaNorm[3 * o + 1] = ny;
    salidaNorm[3 * o + 2] = nz;
    if (uv && salidaUv) {
      salidaUv[2 * o] = wu * uv[2 * i] + wv * uv[2 * j] + ww * uv[2 * l];
      salidaUv[2 * o + 1] = wu * uv[2 * i + 1] + wv * uv[2 * j + 1] + ww * uv[2 * l + 1];
    }
  }
}
