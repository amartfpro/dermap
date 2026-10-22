import { proyectarEnPolilinea } from "../geometria/seleccion";
import { ejeDeLaPierna, ejeDelBrazo, type Cuerpo, type Lado } from "./cuerpo";

type P3 = [number, number, number];

/**
 * Postura del cuerpo (RF-13), en grados. 0 = la postura de la malla base (brazos en «A»).
 *  - codo / rodilla: flexión (0 = recto).
 *  - hombro: + sube el brazo hacia la «T», − lo baja hacia el costado.
 *  - cadera: + abre la pierna, − la cierra.
 * Solo cambia lo que se ve: los lienzos no se tocan.
 */
export interface Pose {
  hombroL: number;
  hombroR: number;
  codoL: number;
  codoR: number;
  caderaL: number;
  caderaR: number;
  rodillaL: number;
  rodillaR: number;
}

export const POSE_RECTA: Pose = { hombroL: 0, hombroR: 0, codoL: 0, codoR: 0, caderaL: 0, caderaR: 0, rodillaL: 0, rodillaR: 0 };

/** Límites de cada articulación (grados). */
export const LIMITES_POSE: Record<keyof Pose, [number, number]> = {
  hombroL: [-40, 50],
  hombroR: [-40, 50],
  codoL: [0, 140],
  codoR: [0, 140],
  caderaL: [-12, 35],
  caderaR: [-12, 35],
  rodillaL: [0, 140],
  rodillaR: [0, 140],
};

export const esRecta = (p: Pose) => (Object.keys(POSE_RECTA) as (keyof Pose)[]).every((k) => !p[k]);

/** Media anchura de la transición alrededor de cada articulación, en cm. */
const TRANSICION = { codo: 4, rodilla: 4, hombro: 7, cadera: 8 };

/**
 * Gira las articulaciones de la más cercana al tronco a la más lejana (hombro → codo,
 * cadera → rodilla), moviendo los vértices del miembro con una transición suave (como un
 * esqueleto con pesos repartidos). Es una aproximación: no simula músculo ni pliegues, pero
 * basta para ver cómo se estira el diseño y para tener una postura más natural.
 */
export function aplicarPose(cuerpo: Cuerpo, pose: Pose): Cuerpo {
  if (esRecta(pose)) return cuerpo;
  const v = Float64Array.from(cuerpo.vertices);
  const x = cuerpo.complexion;
  const grosor = (cuerpo.altura / 170) * (1 + 0.5 * ((x?.peso ?? 0.5) - 0.5) + 0.25 * ((x?.musculatura ?? 0.5) - 0.5));
  const articulaciones: Record<string, P3> = {};
  for (const [k, p] of Object.entries(cuerpo.articulaciones)) articulaciones[k] = [...p] as P3;

  for (const lado of ["l", "r"] as Lado[]) {
    const signo = lado === "l" ? 1 : -1;
    const L = lado === "l";
    // Brazo: hombro (en el plano frontal) y luego codo (hacia delante).
    const ejeBrazo = ejeDelBrazo(cuerpo, lado);
    const hombro = L ? pose.hombroL ?? 0 : pose.hombroR ?? 0;
    if (hombro) {
      const xs = Math.abs(ejeBrazo[0][0]);
      girarMiembro(cuerpo, v, articulaciones, {
        eje: ejeBrazo,
        tramo: 0,
        transicion: TRANSICION.hombro * grosor,
        radio: 12 * grosor,
        alcance: 10 * grosor,
        // El costado del tronco no sigue al brazo: peso lateral a partir de unos cm por dentro del hombro.
        lateral: (px) => suave((px * signo - (xs - 5 * grosor)) / (5 * grosor)),
        pivote: `${lado}-shoulder`,
        ejeGiro: () => [0, 0, signo],
        grados: hombro,
      });
    }
    const codo = L ? pose.codoL : pose.codoR;
    if (codo) {
      girarMiembro(cuerpo, v, articulaciones, {
        eje: ejeBrazo,
        tramo: 1,
        transicion: TRANSICION.codo,
        radio: 9 * grosor,
        pivote: `${lado}-elbow`,
        // Perpendicular al brazo (ya girado por el hombro) y a la dirección hacia la que se dobla.
        ejeGiro: (a) => normalizar(cruz(normalizar(restar(a[`${lado}-elbow`], a[`${lado}-shoulder`])), [0, 0, 1])),
        grados: codo,
      });
    }
    // Pierna: cadera (abrir/cerrar) y luego rodilla (hacia atrás).
    const ejePierna = ejeDeLaPierna(cuerpo, lado);
    const cadera = L ? pose.caderaL ?? 0 : pose.caderaR ?? 0;
    if (cadera) {
      girarMiembro(cuerpo, v, articulaciones, {
        eje: ejePierna,
        tramo: 0,
        transicion: TRANSICION.cadera * grosor,
        radio: 16 * grosor,
        alcance: 15 * grosor,
        // La entrepierna y la otra pierna no se mueven.
        lateral: (px) => suave((px * signo - 0.5) / (4 * grosor)),
        pivote: `${lado}-upper-leg`,
        ejeGiro: () => [0, 0, signo],
        grados: cadera,
      });
    }
    const rodilla = L ? pose.rodillaL : pose.rodillaR;
    if (rodilla) {
      girarMiembro(cuerpo, v, articulaciones, {
        eje: ejePierna,
        tramo: 1,
        transicion: TRANSICION.rodilla,
        radio: 12 * grosor,
        pivote: `${lado}-knee`,
        ejeGiro: (a) => normalizar(cruz(normalizar(restar(a[`${lado}-knee`], a[`${lado}-upper-leg`])), [0, 0, -1])),
        grados: rodilla,
      });
    }
  }
  return { ...cuerpo, vertices: v, articulaciones };
}

interface Giro {
  /** Eje del miembro en la postura base (raíz → articulación media → extremo). */
  eje: P3[];
  /** 0: gira en la raíz (hombro, cadera); 1: en la articulación media (codo, rodilla). */
  tramo: 0 | 1;
  transicion: number;
  /** Las articulaciones a menos de esta distancia del eje, más allá del giro, giran con él. */
  radio: number;
  /**
   * Distancia máxima al eje (cm) de los vértices que se mueven: en hombro y cadera evita que el
   * relleno baje por el costado del tronco hasta las piernas.
   */
  alcance?: number;
  /** Peso extra según la coordenada x de la postura base (para separar el miembro del tronco). */
  lateral?: (x: number) => number;
  pivote: string;
  ejeGiro: (articulaciones: Record<string, P3>) => P3;
  grados: number;
}

/**
 * Gira, alrededor de la articulación (ya movida por las anteriores), los vértices conectados
 * por la malla con el extremo del miembro sin volver por encima de la transición. Así entran
 * los dedos y el pie enteros y nunca el resto del cuerpo. Los pesos salen de la postura base.
 */
function girarMiembro(cuerpo: Cuerpo, v: Float64Array, articulaciones: Record<string, P3>, g: Giro): void {
  const base = cuerpo.vertices;
  const [a, j, b] = g.eje;
  const hastaGiro = g.tramo === 0 ? 0 : Math.hypot(j[0] - a[0], j[1] - a[1], j[2] - a[2]);
  const umbral = hastaGiro - g.transicion;
  const pivote = articulaciones[g.pivote];
  const ejeGiro = g.ejeGiro(articulaciones);
  const angulo = (g.grados * Math.PI) / 180;
  const vec = vecinosDe(cuerpo);
  const n = base.length / 3;
  const sDe = new Float64Array(n).fill(NaN);
  const dDe = new Float64Array(n);
  // Antes de la raíz la proyección se queda en 0: ahí se usa la distancia (negativa) a lo largo
  // del primer tramo, para que el tronco quede por debajo del umbral y nunca se mueva.
  const dirRaiz = normalizar(restar(j, a));
  const primerTramo = Math.hypot(j[0] - a[0], j[1] - a[1], j[2] - a[2]);
  const s = (i: number) => {
    if (Number.isNaN(sDe[i])) {
      const p: P3 = [base[3 * i], base[3 * i + 1], base[3 * i + 2]];
      const pr = proyectarEnPolilinea(p, g.eje);
      sDe[i] = pr.s > 1e-6 ? pr.s : Math.min(0, (p[0] - a[0]) * dirRaiz[0] + (p[1] - a[1]) * dirRaiz[1] + (p[2] - a[2]) * dirRaiz[2]);
      dDe[i] = pr.d;
    }
    return sDe[i];
  };
  let semilla = 0, mejor = Infinity;
  for (let i = 0; i < n; i++) {
    const d = (base[3 * i] - b[0]) ** 2 + (base[3 * i + 1] - b[1]) ** 2 + (base[3 * i + 2] - b[2]) ** 2;
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
    let peso = suave((s(i) - umbral) / (2 * g.transicion));
    if (g.lateral) peso *= g.lateral(base[3 * i]);
    if (peso > 0) {
      const q = sumar(pivote, rotar(restar([v[3 * i], v[3 * i + 1], v[3 * i + 2]], pivote), ejeGiro, angulo * peso));
      v[3 * i] = q[0];
      v[3 * i + 1] = q[1];
      v[3 * i + 2] = q[2];
    }
    for (const k of vec[i]) {
      // El límite de distancia solo cuenta en el primer tramo (junto al tronco): la mano, los
      // dedos y el pie quedan lejos del eje pero son del miembro.
      if (visto[k] || s(k) < umbral || (g.alcance && s(k) < primerTramo && dDe[k] > g.alcance)) continue;
      visto[k] = 1;
      pila.push(k);
    }
  }
  // Las articulaciones de más allá giran enteras (codo, mano, tobillo, dedos…).
  for (const [nombre, pos] of Object.entries(cuerpo.articulaciones)) {
    if (nombre === g.pivote) continue;
    const { s: sj, d } = proyectarEnPolilinea(pos, g.eje);
    if (d <= g.radio && sj > hastaGiro + g.transicion * 0.5 && (!g.lateral || g.lateral(pos[0]) > 0.5))
      articulaciones[nombre] = sumar(pivote, rotar(restar(articulaciones[nombre], pivote), ejeGiro, angulo));
  }
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
