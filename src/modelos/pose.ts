import type { Cuerpo, Lado } from "./cuerpo";
import {
  deltaMush,
  hueso,
  HUESO_DE_ARTICULACION,
  huesosAfectados,
  mascaraArticulaciones,
  moverConHueso,
  posar,
  posicionesHuesos,
  type GiroHueso,
} from "./esqueleto";

type P3 = [number, number, number];

/**
 * Postura del cuerpo (RF-13), en grados. 0 = la postura de la malla base (brazos en «A»).
 *  - hombro: + sube el brazo de lado hacia la «T», − lo baja hacia el costado.
 *  - brazo: + lleva el brazo hacia delante, − hacia atrás.
 *  - codo / rodilla: flexión (0 = recto).
 *  - muneca: + dobla la mano hacia la palma.
 *  - cadera: + abre la pierna, − la cierra.
 *  - pierna: + levanta la pierna hacia delante, − hacia atrás.
 *  - torso / cabeza: giro a la izquierda (+) o a la derecha (−).
 * Se aplica con el esqueleto de MakeHuman (esqueleto.ts). Solo cambia lo que se ve: los
 * lienzos se aplanan siempre en la postura base.
 */
export interface Pose {
  hombroL: number;
  hombroR: number;
  brazoL: number;
  brazoR: number;
  codoL: number;
  codoR: number;
  munecaL: number;
  munecaR: number;
  caderaL: number;
  caderaR: number;
  piernaL: number;
  piernaR: number;
  rodillaL: number;
  rodillaR: number;
  torso: number;
  cabeza: number;
}

export const POSE_RECTA: Pose = {
  hombroL: 0,
  hombroR: 0,
  brazoL: 0,
  brazoR: 0,
  codoL: 0,
  codoR: 0,
  munecaL: 0,
  munecaR: 0,
  caderaL: 0,
  caderaR: 0,
  piernaL: 0,
  piernaR: 0,
  rodillaL: 0,
  rodillaR: 0,
  torso: 0,
  cabeza: 0,
};

/** Límites de cada articulación (grados). */
export const LIMITES_POSE: Record<keyof Pose, [number, number]> = {
  hombroL: [-45, 50],
  hombroR: [-45, 50],
  brazoL: [-30, 80],
  brazoR: [-30, 80],
  codoL: [0, 145],
  codoR: [0, 145],
  munecaL: [-60, 60],
  munecaR: [-60, 60],
  caderaL: [-15, 45],
  caderaR: [-15, 45],
  piernaL: [-30, 110],
  piernaR: [-30, 110],
  rodillaL: [0, 145],
  rodillaR: [0, 145],
  torso: [-45, 45],
  cabeza: [-70, 70],
};

export const esRecta = (p: Pose) => (Object.keys(POSE_RECTA) as (keyof Pose)[]).every((k) => !p[k]);

const rad = (g: number) => (g * Math.PI) / 180;

/** Giros de los huesos de MakeHuman para una postura. */
export function girosDePose(cuerpo: Cuerpo, pose: Pose): GiroHueso[] {
  const { cabezas, colas } = posicionesHuesos(cuerpo);
  const dir = (b: number): P3 => normalizar(restar(colas[b], cabezas[b]));
  const giros: GiroHueso[] = [];
  const g = (nombre: string, eje: P3, grados: number | undefined) => {
    if (grados) giros.push({ hueso: hueso(nombre), eje, angulo: rad(grados) });
  };
  for (const lado of ["l", "r"] as Lado[]) {
    const L = lado === "l";
    const s = L ? ".L" : ".R";
    const signo = L ? 1 : -1;
    const v = (k: string) => (pose as unknown as Record<string, number>)[k + (L ? "L" : "R")] ?? 0;
    // Hombro: abrir/cerrar en el plano frontal y adelantar/atrasar en el sagital. Por encima de
    // la horizontal, parte del movimiento lo hace la clavícula (como en el cuerpo real).
    const abd = v("hombro");
    const extra = Math.max(0, abd - 30) * 0.35;
    g(`shoulder01${s}`, [0, 0, signo], extra);
    g(`upperarm01${s}`, [0, 0, signo], abd - extra);
    // Adelante/atrás en el plano del brazo y «delante» (no de lado, aunque el brazo esté en «A»).
    // Parte la hace la escápula (hombro01), como en el cuerpo real; así el deltoides no se abulta.
    const brazoRaiz = dir(hueso(`upperarm01${s}`));
    const ejeFlex = normalizar(cruz(brazoRaiz, [0, 0, 1]));
    g(`shoulder01${s}`, ejeFlex, v("brazo") * 0.25);
    g(`upperarm01${s}`, ejeFlex, v("brazo") * 0.75);
    // Codo: perpendicular al brazo y a «delante», en la postura base.
    const brazo = dir(hueso(`upperarm02${s}`));
    g(`lowerarm01${s}`, normalizar(cruz(brazo, [0, 0, 1])), v("codo"));
    // Muñeca: hacia la palma (la palma mira hacia el cuerpo y algo hacia atrás en la «A»).
    const antebrazo = dir(hueso(`lowerarm02${s}`));
    g(`wrist${s}`, normalizar(cruz(antebrazo, [signo, 0, 0])), v("muneca"));
    // Cadera.
    g(`upperleg01${s}`, [0, 0, signo], v("cadera"));
    g(`upperleg01${s}`, [1, 0, 0], -v("pierna"));
    // Rodilla: hacia atrás.
    const muslo = dir(hueso(`upperleg02${s}`));
    g(`lowerleg01${s}`, normalizar(cruz(muslo, [0, 0, -1])), v("rodilla"));
  }
  // Torso y cabeza: el giro se reparte entre las vértebras para que no se pliegue.
  for (const n of ["spine04", "spine03", "spine02", "spine01"]) g(n, [0, 1, 0], pose.torso / 4);
  for (const n of ["neck01", "neck02", "neck03"]) g(n, [0, 1, 0], pose.cabeza / 3);
  return giros;
}

export function aplicarPose(cuerpo: Cuerpo, pose: Pose): Cuerpo {
  if (esRecta(pose)) return cuerpo;
  const giros = girosDePose(cuerpo, pose);
  const r = posar(cuerpo, giros);
  // Delta Mush en las zonas de articulación (hombros, axilas, caderas, codos…).
  const mascara = mascaraArticulaciones(cuerpo.caras, cuerpo.vertices.length / 3, huesosAfectados(giros));
  r.vertices = deltaMush(cuerpo.vertices, r.vertices, cuerpo.caras, mascara);
  const articulaciones: Record<string, P3> = {};
  for (const [nombre, pos] of Object.entries(cuerpo.articulaciones)) {
    const b = HUESO_DE_ARTICULACION.get(nombre);
    articulaciones[nombre] = b === undefined ? pos : moverConHueso(r, b, pos);
  }
  return { ...cuerpo, vertices: r.vertices, articulaciones };
}

const restar = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cruz = (a: P3, b: P3): P3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function normalizar(a: P3): P3 {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
