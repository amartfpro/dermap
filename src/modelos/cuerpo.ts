import type { Malla } from "../geometria/aplanador";
import datos from "./cuerpo-base.json";

/**
 * Malla base del cuerpo (MakeHuman, CC0), en centímetros y con los pies en y = 0.
 * Es la misma topología para todos los proyectos: una zona se guarda como lista de
 * triángulos de esta malla (ver «Documento de diseño», principio 1).
 */
export interface Cuerpo extends Malla {
  altura: number;
  /** Complexión aplicada (ver formas.ts); sin ella, es la malla base sin deformar. */
  complexion?: import("./formas").Complexion;
  articulaciones: Record<string, [number, number, number]>;
}

export type Lado = "l" | "r";

/** Lee el formato «DMC1» generado por scripts/convertir-makehuman.ts. */
export function leerCuerpo(bytes: ArrayBuffer): Cuerpo {
  const vista = new DataView(bytes);
  const firma = String.fromCharCode(...new Uint8Array(bytes, 0, 4));
  if (firma !== "DMC1") throw new Error("Formato de malla desconocido");
  const nV = vista.getUint32(4, true);
  const nT = vista.getUint32(8, true);
  const posiciones = new Float32Array(bytes, 12, nV * 3);
  const indices = new Uint16Array(bytes, 12 + nV * 12, nT * 3);
  return {
    vertices: Float64Array.from(posiciones),
    caras: Int32Array.from(indices),
    altura: datos.altura,
    articulaciones: datos.articulaciones as unknown as Record<string, [number, number, number]>,
  };
}

/** Carga el cuerpo base en el navegador. */
export async function cargarCuerpo(): Promise<Cuerpo> {
  const url = (await import("./cuerpo-base.bin?url")).default;
  return leerCuerpo(await (await fetch(url)).arrayBuffer());
}

/** Eje del brazo: hombro → codo → muñeca (la articulación «hand» de MakeHuman). */
export function ejeDelBrazo(cuerpo: Cuerpo, lado: Lado): [number, number, number][] {
  const a = cuerpo.articulaciones;
  return [a[`${lado}-shoulder`], a[`${lado}-elbow`], a[`${lado}-hand`]];
}

/** Eje de la pierna: cadera → rodilla → tobillo. */
export function ejeDeLaPierna(cuerpo: Cuerpo, lado: Lado): [number, number, number][] {
  const a = cuerpo.articulaciones;
  return [a[`${lado}-upper-leg`], a[`${lado}-knee`], a[`${lado}-ankle`]];
}
