import { ejeDeLaPierna, ejeDelBrazo, type Cuerpo, type Lado } from "./cuerpo";

type P3 = [number, number, number];

/**
 * Contornos reales del cliente, en cm, tomados con cinta métrica (todos opcionales). Con
 * ellos el modelo se ajusta y los lienzos nuevos salen a la escala real del cliente: el
 * stencil deja de ser aproximado en esas zonas. Se aplican igual a los dos lados.
 */
export interface Medidas {
  /** Brazo, por la parte más ancha del bíceps. */
  brazo?: number;
  /** Antebrazo, por la parte más ancha. */
  antebrazo?: number;
  muneca?: number;
  /** Muslo, a media altura. */
  muslo?: number;
  /** Gemelo, por la parte más ancha. */
  gemelo?: number;
  /** Tobillo, por encima del hueso. */
  tobillo?: number;
}

export type Medida = keyof Medidas;

interface Estacion {
  medida: Medida;
  /** Posición a lo largo del eje del miembro, en cm desde la raíz. */
  s: (l1: number, l2: number) => number;
}

interface Miembro {
  eje: (c: Cuerpo, lado: Lado) => P3[];
  /** El ajuste empieza a esta distancia de la raíz (hombro o cadera), con una rampa. */
  raiz: number;
  estaciones: Estacion[];
  /** Distancia máxima al eje de un vértice del miembro (cm, en un cuerpo de 170 cm). */
  radio: number;
}

const MIEMBROS: Miembro[] = [
  {
    eje: ejeDelBrazo,
    raiz: 4,
    radio: 11,
    estaciones: [
      { medida: "brazo", s: (l1) => 0.55 * l1 },
      { medida: "antebrazo", s: (l1, l2) => l1 + 0.28 * l2 },
      { medida: "muneca", s: (l1, l2) => l1 + l2 - 1.5 },
    ],
  },
  {
    eje: ejeDeLaPierna,
    raiz: 8,
    radio: 16,
    estaciones: [
      { medida: "muslo", s: (l1) => 0.42 * l1 },
      { medida: "gemelo", s: (l1, l2) => l1 + 0.32 * l2 },
      { medida: "tobillo", s: (l1, l2) => l1 + l2 - 4 },
    ],
  },
];

/** Contornos actuales del modelo (lado izquierdo), en cm, medidos como con una cinta. */
export function medirContornos(cuerpo: Cuerpo): Required<Medidas> {
  const r = {} as Required<Medidas>;
  for (const m of MIEMBROS) {
    const datos = analizar(cuerpo, m, "l");
    m.estaciones.forEach((e, i) => (r[e.medida] = datos.contornos[i]));
  }
  return r;
}

/**
 * Cuerpo con los contornos pedidos: cada sección del miembro se escala alrededor de su eje,
 * con el factor interpolado entre las estaciones medidas y una rampa suave desde el hombro o
 * la cadera. Lo que no se ha medido no cambia.
 */
export function aplicarMedidas(cuerpo: Cuerpo, medidas: Medidas): Cuerpo {
  // Dos pasadas: la segunda corrige lo que la interpolación entre estaciones deja (≈ 1 %).
  return ajustar(ajustar(cuerpo, medidas), medidas);
}

function ajustar(cuerpo: Cuerpo, medidas: Medidas): Cuerpo {
  const pedidas = Object.entries(medidas).filter(([, v]) => typeof v === "number" && v > 0);
  if (!pedidas.length) return cuerpo;
  const v = Float64Array.from(cuerpo.vertices);
  for (const m of MIEMBROS) {
    if (!m.estaciones.some((e) => (medidas[e.medida] ?? 0) > 0)) continue;
    for (const lado of ["l", "r"] as Lado[]) {
      const datos = analizar(cuerpo, m, lado);
      // Puntos de control (s, factor): la raíz no cambia; cada estación medida, su factor.
      const control: [number, number][] = [[m.raiz, 1]];
      m.estaciones.forEach((e, i) => {
        const objetivo = medidas[e.medida];
        if (objetivo && objetivo > 0 && datos.contornos[i] > 0) control.push([datos.posiciones[i], objetivo / datos.contornos[i]]);
      });
      if (control.length === 1) continue;
      const factor = (s: number) => {
        if (s <= control[0][0]) return 1;
        for (let k = 1; k < control.length; k++)
          if (s <= control[k][0]) {
            const [s0, f0] = control[k - 1], [s1, f1] = control[k];
            return f0 + ((f1 - f0) * (s - s0)) / (s1 - s0 || 1);
          }
        return control[control.length - 1][1];
      };
      for (const i of datos.miembro) {
        const { s, pie } = proyectar([cuerpo.vertices[3 * i], cuerpo.vertices[3 * i + 1], cuerpo.vertices[3 * i + 2]], datos.eje);
        const f = factor(s);
        for (let c = 0; c < 3; c++) v[3 * i + c] = pie[c] + (cuerpo.vertices[3 * i + c] - pie[c]) * f;
      }
    }
  }
  return { ...cuerpo, vertices: v };
}

/** Vértices del miembro, posiciones de sus estaciones y contornos actuales en ellas. */
function analizar(cuerpo: Cuerpo, m: Miembro, lado: Lado) {
  const eje = m.eje(cuerpo, lado);
  const otro = m.eje(cuerpo, lado === "l" ? "r" : "l");
  const l1 = dist(eje[0], eje[1]), l2 = dist(eje[1], eje[2]);
  const escala = cuerpo.altura / 170;
  const v = cuerpo.vertices;
  const n = v.length / 3;
  const p = (i: number): P3 => [v[3 * i], v[3 * i + 1], v[3 * i + 2]];

  // Vértices del miembro: conectados por la malla con el extremo (mano o tobillo), más allá
  // de la raíz, cerca de su eje y más cerca de él que del miembro del otro lado.
  const vecinos = vecinosDe(cuerpo);
  const info = new Map<number, { s: number; d: number }>();
  const dato = (i: number) => {
    let x = info.get(i);
    if (!x) {
      const q = proyectar(p(i), eje);
      x = { s: q.s, d: q.d };
      info.set(i, x);
    }
    return x;
  };
  const admitido = (i: number) => {
    const { s, d } = dato(i);
    return s > m.raiz * 0.5 && d < m.radio * escala * 1.4 && d < proyectar(p(i), otro).d;
  };
  let semilla = 0, mejor = Infinity;
  for (let i = 0; i < n; i++) {
    const d = dist(p(i), eje[2]);
    if (d < mejor) {
      mejor = d;
      semilla = i;
    }
  }
  const miembro: number[] = [];
  const visto = new Uint8Array(n);
  const pila = [semilla];
  visto[semilla] = 1;
  while (pila.length) {
    const i = pila.pop()!;
    miembro.push(i);
    for (const k of vecinos[i]) {
      if (visto[k] || !admitido(k)) continue;
      visto[k] = 1;
      pila.push(k);
    }
  }

  const posiciones = m.estaciones.map((e) => e.s(l1, l2));
  // Sección exacta: cortes de los triángulos del miembro con el plano perpendicular al eje.
  const enMiembro = new Uint8Array(n);
  for (const i of miembro) enMiembro[i] = 1;
  const caras = cuerpo.caras;
  const contornos = posiciones.map((s0) => {
    const { punto, direccion } = enEje(eje, s0);
    const [u, w] = base(direccion);
    const altura = (i: number) =>
      (v[3 * i] - punto[0]) * direccion[0] + (v[3 * i + 1] - punto[1]) * direccion[1] + (v[3 * i + 2] - punto[2]) * direccion[2];
    const pts: [number, number][] = [];
    for (let f = 0; f < caras.length; f += 3) {
      const t = [caras[f], caras[f + 1], caras[f + 2]];
      if (!enMiembro[t[0]] || !enMiembro[t[1]] || !enMiembro[t[2]]) continue;
      const h = t.map(altura);
      for (let j = 0; j < 3; j++) {
        const a = t[j], b = t[(j + 1) % 3], ha = h[j], hb = h[(j + 1) % 3];
        if ((ha > 0) === (hb > 0) || ha === hb) continue;
        const k = ha / (ha - hb);
        const q: P3 = [0, 1, 2].map((c) => v[3 * a + c] + k * (v[3 * b + c] - v[3 * a + c]) - punto[c]) as P3;
        // Solo la sección alrededor de este punto del eje (no otra parte del miembro).
        if (Math.hypot(...q) > m.radio * escala * 1.4) continue;
        pts.push([q[0] * u[0] + q[1] * u[1] + q[2] * u[2], q[0] * w[0] + q[1] * w[1] + q[2] * w[2]]);
      }
    }
    return perimetroEnvolvente(pts);
  });
  return { eje, miembro, posiciones, contornos };
}

/** Perímetro de la envolvente convexa: lo que mide una cinta alrededor de la sección. */
export function perimetroEnvolvente(puntos: [number, number][]): number {
  if (puntos.length < 3) return 0;
  const p = [...puntos].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cruz = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const abajo: [number, number][] = [];
  for (const q of p) {
    while (abajo.length >= 2 && cruz(abajo[abajo.length - 2], abajo[abajo.length - 1], q) <= 0) abajo.pop();
    abajo.push(q);
  }
  const arriba: [number, number][] = [];
  for (const q of [...p].reverse()) {
    while (arriba.length >= 2 && cruz(arriba[arriba.length - 2], arriba[arriba.length - 1], q) <= 0) arriba.pop();
    arriba.push(q);
  }
  const casco = [...abajo.slice(0, -1), ...arriba.slice(0, -1)];
  let total = 0;
  for (let i = 0; i < casco.length; i++) {
    const a = casco[i], b = casco[(i + 1) % casco.length];
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return total;
}

function proyectar(q: P3, eje: P3[]): { s: number; d: number; pie: P3 } {
  let mejor = { s: 0, d: Infinity, pie: eje[0] };
  let acumulado = 0;
  for (let i = 0; i + 1 < eje.length; i++) {
    const a = eje[i], b = eje[i + 1];
    const ab: P3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const largo = Math.hypot(...ab);
    const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * ab[0] + (q[1] - a[1]) * ab[1] + (q[2] - a[2]) * ab[2]) / (largo * largo)));
    const pie: P3 = [a[0] + t * ab[0], a[1] + t * ab[1], a[2] + t * ab[2]];
    const d = dist(q, pie);
    if (d < mejor.d) mejor = { s: acumulado + t * largo, d, pie };
    acumulado += largo;
  }
  return mejor;
}

function enEje(eje: P3[], s: number): { punto: P3; direccion: P3 } {
  let acumulado = 0;
  for (let i = 0; i + 1 < eje.length; i++) {
    const a = eje[i], b = eje[i + 1];
    const largo = dist(a, b);
    if (s <= acumulado + largo || i + 2 === eje.length) {
      const t = Math.max(0, Math.min(1, (s - acumulado) / largo));
      return {
        punto: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])],
        direccion: [(b[0] - a[0]) / largo, (b[1] - a[1]) / largo, (b[2] - a[2]) / largo],
      };
    }
    acumulado += largo;
  }
  return { punto: eje[0], direccion: [0, -1, 0] };
}

function base(d: P3): [P3, P3] {
  const ref: P3 = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = normalizar([d[1] * ref[2] - d[2] * ref[1], d[2] * ref[0] - d[0] * ref[2], d[0] * ref[1] - d[1] * ref[0]]);
  const w: P3 = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
  return [u, w];
}

const dist = (a: P3, b: P3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function normalizar(a: P3): P3 {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

const cacheVecinos = new WeakMap<Int32Array, number[][]>();
function vecinosDe(cuerpo: Cuerpo): number[][] {
  let vec = cacheVecinos.get(cuerpo.caras);
  if (vec) return vec;
  const conjuntos = Array.from({ length: cuerpo.vertices.length / 3 }, () => new Set<number>());
  const c = cuerpo.caras;
  for (let f = 0; f < c.length; f += 3)
    for (let j = 0; j < 3; j++) {
      const a = c[f + j], b = c[f + ((j + 1) % 3)];
      conjuntos[a].add(b);
      conjuntos[b].add(a);
    }
  vec = conjuntos.map((x) => [...x]);
  cacheVecinos.set(cuerpo.caras, vec);
  return vec;
}
