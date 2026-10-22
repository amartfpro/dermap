import type { Aplanado, Malla, OpcionesAplanado } from "./aplanador";
import type { Peticion, Respuesta } from "./trabajador";

let trabajador: Worker | null = null;
let siguienteId = 1;
const pendientes = new Map<number, { resolver: (r: Resultado) => void; rechazar: (e: Error) => void }>();

export interface Resultado {
  aplanado: Aplanado;
  milisegundos: number;
}

function obtenerTrabajador(): Worker {
  if (trabajador) return trabajador;
  trabajador = new Worker(new URL("./trabajador.ts", import.meta.url), { type: "module" });
  trabajador.onmessage = ({ data }: MessageEvent<Respuesta>) => {
    const p = pendientes.get(data.id);
    if (!p) return;
    pendientes.delete(data.id);
    if (data.ok) p.resolver({ aplanado: data.aplanado, milisegundos: data.milisegundos });
    else p.rechazar(new Error(data.mensaje));
  };
  return trabajador;
}

/**
 * Aplana la zona en el Web Worker y orienta el resultado para el lienzo:
 * sin espejo (vista desde fuera de la piel) y con la dirección 3D `hacia` apuntando
 * a la derecha del lienzo (el visor la elige para que lienzo y vista 3D coincidan).
 */
export async function aplanarEnSegundoPlano(
  malla: Malla,
  opciones: OpcionesAplanado = {},
  hacia = [0, 1, 0] as [number, number, number],
  haciaCamara?: [number, number, number],
): Promise<Resultado> {
  const id = siguienteId++;
  const resultado = await new Promise<Resultado>((resolver, rechazar) => {
    pendientes.set(id, { resolver, rechazar });
    // Se envían copias: la malla original sigue haciendo falta en el hilo principal.
    const peticion: Peticion = {
      id,
      malla: { vertices: malla.vertices.slice(), caras: malla.caras.slice() },
      opciones,
    };
    obtenerTrabajador().postMessage(peticion);
  });
  orientar(malla, resultado.aplanado, hacia, haciaCamara);
  return resultado;
}

/**
 * El aplanado sale con una rotación arbitraria y puede salir en espejo. Se corrige:
 * 1. Si las caras quedan en sentido horario (vistas desde fuera), se refleja u.
 * 2. Se gira para que el gradiente medio de la proyección sobre `hacia` apunte a la
 *    derecha del lienzo. Si se indica `haciaCamara`, solo cuentan las caras que miran a la
 *    cámara: en una manga, la cara de delante y la de detrás tienen gradientes opuestos al
 *    desenrollarla y se anularían; así el lienzo queda como se ve la zona de frente.
 */
function orientar(malla: Malla, a: Aplanado, hacia: [number, number, number], haciaCamara?: [number, number, number]): void {
  const altura = (v: number) =>
    malla.vertices[3 * v] * hacia[0] + malla.vertices[3 * v + 1] * hacia[1] + malla.vertices[3 * v + 2] * hacia[2];
  const nF = a.caras.length / 3;
  let areaFirmada = 0;
  for (let f = 0; f < nF; f++) {
    const [i, j, k] = [a.caras[3 * f], a.caras[3 * f + 1], a.caras[3 * f + 2]];
    areaFirmada +=
      (a.uv[2 * j] - a.uv[2 * i]) * (a.uv[2 * k + 1] - a.uv[2 * i + 1]) -
      (a.uv[2 * k] - a.uv[2 * i]) * (a.uv[2 * j + 1] - a.uv[2 * i + 1]);
  }
  if (areaFirmada < 0) for (let i = 0; i < a.uv.length; i += 2) a.uv[i] = -a.uv[i];

  // Gradiente de la proyección sobre `hacia` en el plano uv.
  let gx = 0;
  let gy = 0;
  for (let f = 0; f < nF; f++) {
    const vs = [a.caras[3 * f], a.caras[3 * f + 1], a.caras[3 * f + 2]];
    const [u0, v0, u1, v1, u2, v2] = vs.flatMap((v) => [a.uv[2 * v], a.uv[2 * v + 1]]);
    const [y0, y1, y2] = vs.map((v) => altura(a.origen[v]));
    const det = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
    if (Math.abs(det) < 1e-12) continue;
    const peso = haciaCamara ? orientacionHacia(malla, a, vs, haciaCamara) : 1;
    if (peso <= 0) continue;
    // ∇y = área · (dy1·(v2−v0) − dy2·(v1−v0), dy2·(u1−u0) − dy1·(u2−u0)) / det; el área se cancela con det/2.
    gx += ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) * Math.sign(det) * peso;
    gy += ((y2 - y0) * (u1 - u0) - (y1 - y0) * (u2 - u0)) * Math.sign(det) * peso;
  }
  const angulo = -Math.atan2(gy, gx);
  const c = Math.cos(angulo);
  const s = Math.sin(angulo);
  for (let i = 0; i < a.uv.length; i += 2) {
    const u = a.uv[i];
    const v = a.uv[i + 1];
    a.uv[i] = c * u - s * v;
    a.uv[i + 1] = s * u + c * v;
  }
}

/** Cuánto mira un triángulo hacia una dirección: coseno entre su normal y la dirección (≤ 0 si da la espalda). */
function orientacionHacia(malla: Malla, a: Aplanado, vs: number[], dir: [number, number, number]): number {
  const p = vs.map((v) => {
    const o = a.origen[v];
    return [malla.vertices[3 * o], malla.vertices[3 * o + 1], malla.vertices[3 * o + 2]];
  });
  const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
  const w = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
  const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  const largo = Math.hypot(n[0], n[1], n[2]) || 1;
  return (n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2]) / largo;
}
