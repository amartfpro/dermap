import { proyectarEnPolilinea } from "../geometria/seleccion";
import { ejeDeLaPierna, ejeDelBrazo, type Cuerpo, type Lado } from "./cuerpo";

type P3 = [number, number, number];

/**
 * Postura para ver cómo se deforma el diseño al doblar codos y rodillas (RF-13). Solo cambia
 * lo que se ve: los lienzos no se tocan. Grados de flexión, 0 = recto.
 */
export interface Pose {
  codoL: number;
  codoR: number;
  rodillaL: number;
  rodillaR: number;
}

export const POSE_RECTA: Pose = { codoL: 0, codoR: 0, rodillaL: 0, rodillaR: 0 };

export const esRecta = (p: Pose) => !p.codoL && !p.codoR && !p.rodillaL && !p.rodillaR;

/** Media anchura de la transición alrededor de la articulación, en cm. */
const TRANSICION = 4;

/**
 * Dobla las articulaciones girando los vértices del miembro más allá de la articulación,
 * con una transición suave (como un esqueleto con pesos repartidos). Es una aproximación:
 * no simula músculo ni pliegues, pero basta para ver cómo se estira el diseño.
 */
export function aplicarPose(cuerpo: Cuerpo, pose: Pose): Cuerpo {
  if (esRecta(pose)) return cuerpo;
  const v = Float64Array.from(cuerpo.vertices);
  const x = cuerpo.complexion;
  const grosor = (cuerpo.altura / 170) * (1 + 0.5 * ((x?.peso ?? 0.5) - 0.5) + 0.25 * ((x?.musculatura ?? 0.5) - 0.5));
  const miembros: { eje: P3[]; grados: number; radio: number; hacia: P3 }[] = [];
  for (const lado of ["l", "r"] as Lado[]) {
    // El codo lleva el antebrazo hacia delante; la rodilla, la pierna hacia atrás.
    miembros.push({ eje: ejeDelBrazo(cuerpo, lado), grados: lado === "l" ? pose.codoL : pose.codoR, radio: 9 * grosor, hacia: [0, 0, 1] });
    miembros.push({ eje: ejeDeLaPierna(cuerpo, lado), grados: lado === "l" ? pose.rodillaL : pose.rodillaR, radio: 12 * grosor, hacia: [0, 0, -1] });
  }
  const articulaciones = { ...cuerpo.articulaciones };
  for (const m of miembros) {
    if (!m.grados) continue;
    const [a, j, b] = m.eje;
    const hastaJunta = Math.hypot(j[0] - a[0], j[1] - a[1], j[2] - a[2]);
    // Eje de giro: perpendicular al segmento superior y a la dirección hacia la que se dobla.
    const sup = normalizar(restar(j, a));
    const eje = normalizar(cruz(sup, m.hacia));
    const angulo = (m.grados * Math.PI) / 180;
    const girar = (p: P3, t: number): P3 => sumar(j, rotar(restar(p, j), eje, angulo * t));
    // Vértices del miembro más allá de la articulación: los conectados por la malla con el
    // extremo (mano o tobillo) sin volver por encima de la transición. Así entran los dedos y
    // el pie enteros y nunca el torso ni la otra pierna.
    const umbral = hastaJunta - TRANSICION;
    const vec = vecinosDe(cuerpo);
    const n = v.length / 3;
    const sDe = new Float64Array(n).fill(NaN);
    const s = (i: number) => {
      if (Number.isNaN(sDe[i])) sDe[i] = proyectarEnPolilinea([cuerpo.vertices[3 * i], cuerpo.vertices[3 * i + 1], cuerpo.vertices[3 * i + 2]], m.eje).s;
      return sDe[i];
    };
    let semilla = 0, mejor = Infinity;
    for (let i = 0; i < n; i++) {
      const d = (cuerpo.vertices[3 * i] - b[0]) ** 2 + (cuerpo.vertices[3 * i + 1] - b[1]) ** 2 + (cuerpo.vertices[3 * i + 2] - b[2]) ** 2;
      if (d < mejor) {
        mejor = d;
        semilla = i;
      }
    }
    const visto = new Uint8Array(n);
    const pila = [semilla];
    visto[semilla] = 1;
    while (pila.length) {
      const i = pila.pop()!;
      const t = suave((s(i) - umbral) / (2 * TRANSICION));
      const q = girar([cuerpo.vertices[3 * i], cuerpo.vertices[3 * i + 1], cuerpo.vertices[3 * i + 2]], t);
      // Las rodillas y codos parten de la postura ya doblada por las demás articulaciones.
      v[3 * i] += q[0] - cuerpo.vertices[3 * i];
      v[3 * i + 1] += q[1] - cuerpo.vertices[3 * i + 1];
      v[3 * i + 2] += q[2] - cuerpo.vertices[3 * i + 2];
      for (const k of vec[i]) {
        if (visto[k] || s(k) < umbral) continue;
        visto[k] = 1;
        pila.push(k);
      }
    }
    // Las articulaciones de más allá giran enteras (mano, tobillo, dedos…).
    for (const [nombre, pos] of Object.entries(articulaciones)) {
      const { s, d } = proyectarEnPolilinea(pos, m.eje);
      if (d <= m.radio && s > hastaJunta + TRANSICION) articulaciones[nombre] = girar(pos, 1);
    }
  }
  return { ...cuerpo, vertices: v, articulaciones };
}

const vecinosCache = new WeakMap<Int32Array, number[][]>();

/** Vecinos por arista de cada vértice (la topología es la misma para todos los cuerpos). */
function vecinosDe(cuerpo: Cuerpo): number[][] {
  let vec = vecinosCache.get(cuerpo.caras);
  if (vec) return vec;
  const n = cuerpo.vertices.length / 3;
  const conjuntos = Array.from({ length: n }, () => new Set<number>());
  const c = cuerpo.caras;
  for (let f = 0; f < c.length; f += 3)
    for (let j = 0; j < 3; j++) {
      const a = c[f + j], b = c[f + ((j + 1) % 3)];
      conjuntos[a].add(b);
      conjuntos[b].add(a);
    }
  vec = conjuntos.map((x) => [...x]);
  vecinosCache.set(cuerpo.caras, vec);
  return vec;
}

const suave = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const restar = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const sumar = (a: P3, b: P3): P3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const cruz = (a: P3, b: P3): P3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function normalizar(a: P3): P3 {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
/** Rodrigues: gira `p` un ángulo alrededor del eje unitario `k`. */
function rotar(p: P3, k: P3, angulo: number): P3 {
  const c = Math.cos(angulo), s = Math.sin(angulo);
  const kp = cruz(k, p);
  const kd = k[0] * p[0] + k[1] * p[1] + k[2] * p[2];
  return [0, 1, 2].map((i) => p[i] * c + kp[i] * s + k[i] * kd * (1 - c)) as P3;
}
