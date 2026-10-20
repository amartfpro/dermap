import type { Malla } from "./aplanador";

/**
 * Brazo de prueba para el prototipo, hasta integrar la malla de MakeHuman.
 *
 * Eje Y a lo largo del brazo (muñeca en y = -36, hombro en y = 39), unidades en cm.
 * Sección elíptica que cambia a lo largo del brazo (antebrazo aplanado, bíceps más
 * redondo), con un abultamiento muscular desplazado: así el aplanado no es trivial
 * como en un cilindro perfecto.
 */

/** Perfil: [altura y, radio medio, achatamiento (rx/rz)]. Contornos de un adulto medio. */
const PERFIL: [number, number, number][] = [
  [-36, 2.4, 1.25], // muñeca (≈ 16 cm de contorno)
  [-30, 2.7, 1.3],
  [-22, 3.7, 1.22],
  [-14, 4.3, 1.15], // antebrazo (≈ 27 cm)
  [-6, 4.0, 1.08],
  [-1, 3.9, 1.05], // codo
  [6, 4.2, 1.0],
  [16, 4.8, 0.95], // bíceps (≈ 30 cm)
  [28, 5.2, 0.98],
  [36, 5.6, 1.05], // axila / hombro
  [39, 5.8, 1.08],
];

/** Interpola el perfil con Catmull-Rom para que la superficie sea suave. */
function perfilEn(y: number): { radio: number; achatamiento: number } {
  const i = Math.max(1, Math.min(PERFIL.length - 3, PERFIL.findIndex((p) => p[0] > y) - 1));
  const [p0, p1, p2, p3] = [PERFIL[i - 1], PERFIL[i], PERFIL[i + 1], PERFIL[i + 2]];
  const t = Math.min(1, Math.max(0, (y - p1[0]) / (p2[0] - p1[0])));
  const cr = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t ** 3);
  return { radio: cr(p0[1], p1[1], p2[1], p3[1]), achatamiento: cr(p0[2], p1[2], p2[2], p3[2]) };
}

export function puntoDelBrazo(y: number, angulo: number): [number, number, number] {
  const { radio, achatamiento } = perfilEn(y);
  // Músculo del antebrazo y del bíceps, en la cara delantera (+z).
  const musculo =
    0.35 * Math.exp(-(((y + 16) / 6) ** 2)) * Math.max(0, Math.cos(angulo - 1.9)) ** 2 +
    0.45 * Math.exp(-(((y - 16) / 7) ** 2)) * Math.max(0, Math.cos(angulo - Math.PI / 2)) ** 2;
  const r = radio + musculo;
  const rx = r * Math.sqrt(achatamiento);
  const rz = r / Math.sqrt(achatamiento);
  return [rx * Math.cos(angulo), y, rz * Math.sin(angulo)];
}

/**
 * Manga abierta (tubo) entre dos alturas, como la que seleccionaría el usuario.
 * `alrededor` y `alLargo` fijan la resolución de la malla.
 */
export function mangaDePrueba(
  desde = -33,
  hasta = 32,
  alrededor = 48,
  alLargo = 32,
): Malla {
  const vertices = new Float64Array(alrededor * (alLargo + 1) * 3);
  let k = 0;
  for (let j = 0; j <= alLargo; j++) {
    const y = desde + ((hasta - desde) * j) / alLargo;
    for (let i = 0; i < alrededor; i++) {
      const p = puntoDelBrazo(y, (2 * Math.PI * i) / alrededor);
      vertices[k++] = p[0];
      vertices[k++] = p[1];
      vertices[k++] = p[2];
    }
  }
  const caras = new Int32Array(alrededor * alLargo * 6);
  k = 0;
  for (let j = 0; j < alLargo; j++) {
    for (let i = 0; i < alrededor; i++) {
      const a = j * alrededor + i;
      const b = j * alrededor + ((i + 1) % alrededor);
      const c = a + alrededor;
      const d = b + alrededor;
      // Diagonal alterna para no sesgar la malla en una dirección.
      if ((i + j) % 2 === 0) {
        caras.set([a, c, b, b, c, d], k);
      } else {
        caras.set([a, c, d, a, d, b], k);
      }
      k += 6;
    }
  }
  return { vertices, caras };
}

/** Brazo completo, de muñeca a hombro, cerrado por los extremos. Solo para mostrarlo en el visor. */
export function brazoCompleto(alrededor = 64, alLargo = 60): Malla {
  const tubo = mangaDePrueba(-36, 39, alrededor, alLargo);
  const nV = tubo.vertices.length / 3;
  const vertices = new Float64Array(tubo.vertices.length + 6);
  vertices.set(tubo.vertices);
  vertices.set([0, -36.6, 0, 0, 39.6, 0], tubo.vertices.length);
  const tapas: number[] = [];
  const ultimo = alLargo * alrededor;
  for (let i = 0; i < alrededor; i++) {
    const s = (i + 1) % alrededor;
    tapas.push(nV, i, s); // tapa de la muñeca, hacia fuera (−y)
    tapas.push(nV + 1, ultimo + s, ultimo + i); // tapa del hombro (+y)
  }
  const caras = new Int32Array(tubo.caras.length + tapas.length);
  caras.set(tubo.caras);
  caras.set(tapas, tubo.caras.length);
  return { vertices, caras };
}

/** Recorta un parche (zona con un solo borde) de la manga: una ventana en el antebrazo. */
export function parcheDePrueba(alrededor = 48, alLargo = 32): Malla {
  const manga = mangaDePrueba(-33, 32, alrededor, alLargo);
  const nF = manga.caras.length / 3;
  const dentro = (v: number) => {
    const y = manga.vertices[v * 3 + 1];
    const z = manga.vertices[v * 3 + 2];
    return y > -26 && y < -6 && z > -1;
  };
  const caras: number[] = [];
  for (let f = 0; f < nF; f++) {
    const t = [manga.caras[3 * f], manga.caras[3 * f + 1], manga.caras[3 * f + 2]];
    if (t.every(dentro)) caras.push(...t);
  }
  // Reindexa los vértices usados.
  const nuevo = new Map<number, number>();
  const vertices: number[] = [];
  const reindexadas = caras.map((v) => {
    if (!nuevo.has(v)) {
      nuevo.set(v, nuevo.size);
      vertices.push(manga.vertices[v * 3], manga.vertices[v * 3 + 1], manga.vertices[v * 3 + 2]);
    }
    return nuevo.get(v)!;
  });
  return { vertices: new Float64Array(vertices), caras: new Int32Array(reindexadas) };
}
