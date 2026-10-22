import type { Cuerpo } from "./cuerpo";

/**
 * Complexión del cuerpo del proyecto (RF-12). Los valores van de 0 a 1 como los macros de
 * MakeHuman (0,5 = término medio); la altura es la real en centímetros.
 */
export interface Complexion {
  /** 0 = mujer, 1 = hombre. */
  sexo: number;
  musculatura: number;
  /** Peso / volumen: 0 = delgada, 1 = robusta. */
  peso: number;
  altura: number;
}

export const COMPLEXION_INICIAL: Complexion = { sexo: 0.5, musculatura: 0.5, peso: 0.5, altura: 170 };

export const ALTURA_MINIMA = 140;
export const ALTURA_MAXIMA = 210;

interface Forma {
  indices: Uint16Array;
  /** Desplazamientos en unidades de `escala` cm. */
  delta: Int16Array;
  /** Desplazamiento de cada articulación, en cm. */
  juntas: Float32Array;
}

/** Targets de forma de MakeHuman (scripts/convertir-formas.ts). */
export interface Formas {
  formas: Map<string, Forma>;
  articulaciones: string[];
  escala: number;
}

export function leerFormas(bytes: ArrayBuffer): Formas {
  const vista = new DataView(bytes);
  if (String.fromCharCode(...new Uint8Array(bytes, 0, 4)) !== "DMF1") throw new Error("Formato de formas desconocido");
  const largo = vista.getUint32(4, true);
  const cabecera = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 8, largo))) as {
    formas: string[];
    articulaciones: string[];
    escala: number;
  };
  const alinear = (x: number) => (x + 3) & ~3;
  let p = alinear(8 + largo);
  const formas = new Map<string, Forma>();
  for (const nombre of cabecera.formas) {
    const n = vista.getUint32(p, true);
    p += 4;
    const indices = new Uint16Array(bytes, p, n);
    p = alinear(p + 2 * n);
    const delta = new Int16Array(bytes, p, 3 * n);
    p = alinear(p + 6 * n);
    const juntas = new Float32Array(bytes, p, 3 * cabecera.articulaciones.length);
    p += 12 * cabecera.articulaciones.length;
    formas.set(nombre, { indices, delta, juntas });
  }
  return { formas, articulaciones: cabecera.articulaciones, escala: cabecera.escala };
}

export async function cargarFormas(): Promise<Formas> {
  const url = (await import("./cuerpo-formas.bin?url")).default;
  return leerFormas(await (await fetch(url)).arrayBuffer());
}

/** Reparto de un macro de MakeHuman entre sus extremos: 0 → min, 0,5 → average, 1 → max. */
function tramos(x: number): Record<"min" | "average" | "max", number> {
  return x < 0.5
    ? { min: 1 - x / 0.5, average: x / 0.5, max: 0 }
    : { min: 0, average: 1 - (x - 0.5) / 0.5, max: (x - 0.5) / 0.5 };
}

/**
 * Cuerpo con la complexión pedida. Misma topología que la malla base (los lienzos se
 * guardan como triángulos de ella y la siguen al cambiar la complexión), pies en y = 0
 * y la altura exacta pedida.
 */
export function aplicarComplexion(base: Cuerpo, formas: Formas, c: Complexion): Cuerpo {
  const v = Float64Array.from(base.vertices);
  const nombres = formas.articulaciones;
  const juntas = new Float64Array(nombres.length * 3);
  nombres.forEach((n, j) => juntas.set(base.articulaciones[n] ?? [0, 0, 0], 3 * j));

  const sumar = (destino: Float64Array, nombre: string, peso: number) => {
    const f = formas.formas.get(nombre);
    if (!f || Math.abs(peso) < 1e-4) return;
    const k = peso * formas.escala;
    for (let i = 0; i < f.indices.length; i++) {
      const o = 3 * f.indices[i];
      destino[o] += f.delta[3 * i] * k;
      destino[o + 1] += f.delta[3 * i + 1] * k;
      destino[o + 2] += f.delta[3 * i + 2] * k;
    }
    for (let j = 0; j < juntas.length; j++) juntas[j] += f.juntas[j] * peso;
  };

  const sexos = { female: 1 - c.sexo, male: c.sexo };
  const musculo = tramos(c.musculatura);
  const peso = tramos(c.peso);
  for (const [sexo, ws] of Object.entries(sexos)) {
    sumar(v, sexo, ws);
    for (const [m, wm] of Object.entries(musculo))
      for (const [w, ww] of Object.entries(peso)) sumar(v, `${sexo}-${m}muscle-${w}weight`, ws * wm * ww);
  }

  // Altura: primero las formas de altura de MakeHuman (cambian las proporciones, no solo el
  // tamaño) y luego un escalado uniforme pequeño hasta la altura exacta.
  const medir = (x: Float64Array) => {
    let min = Infinity, max = -Infinity;
    for (let i = 1; i < x.length; i += 3) {
      if (x[i] < min) min = x[i];
      if (x[i] > max) max = x[i];
    }
    return { min, alto: max - min };
  };
  const alto0 = medir(v).alto;
  const extremo = c.altura >= alto0 ? "maxheight" : "minheight";
  const conAltura = Float64Array.from(v);
  const juntasAntes = Float64Array.from(juntas);
  for (const [sexo, ws] of Object.entries(sexos)) sumar(conAltura, `${sexo}-${extremo}`, ws);
  const alto1 = medir(conAltura).alto;
  const t = alto1 !== alto0 ? Math.min(1, Math.max(0, (c.altura - alto0) / (alto1 - alto0))) : 0;
  for (let i = 0; i < v.length; i++) v[i] += (conAltura[i] - v[i]) * t;
  for (let j = 0; j < juntas.length; j++) juntas[j] = juntasAntes[j] + (juntas[j] - juntasAntes[j]) * t;

  const { min, alto } = medir(v);
  const escala = c.altura / alto;
  for (let i = 0; i < v.length; i += 3) {
    v[i] *= escala;
    v[i + 1] = (v[i + 1] - min) * escala;
    v[i + 2] *= escala;
  }
  const articulaciones: Record<string, [number, number, number]> = { ...base.articulaciones };
  nombres.forEach((n, j) => {
    articulaciones[n] = [juntas[3 * j] * escala, (juntas[3 * j + 1] - min) * escala, juntas[3 * j + 2] * escala];
  });
  return { vertices: v, caras: base.caras, altura: c.altura, articulaciones, complexion: { ...c } };
}
