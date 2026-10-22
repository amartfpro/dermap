/// <reference lib="webworker" />
/**
 * Web Worker de geometría: carga el módulo WebAssembly una vez y atiende peticiones de
 * aplanado sin bloquear la interfaz (el aplanado de una manga puede tardar segundos).
 */
import urlWasm from "./dermap_geom.wasm?url";
import { Aplanador, ErrorAplanado, type Malla, type OpcionesAplanado } from "./aplanador";

export interface Peticion {
  id: number;
  malla: Malla;
  opciones: OpcionesAplanado;
}

export type Respuesta =
  | { id: number; ok: true; aplanado: import("./aplanador").Aplanado; milisegundos: number }
  | { id: number; ok: false; mensaje: string; codigo?: number };

const listo = fetch(urlWasm)
  .then((r) => r.arrayBuffer())
  .then((bytes) => Aplanador.crear(bytes));

self.onmessage = async ({ data }: MessageEvent<Peticion>) => {
  try {
    const aplanador = await listo;
    const t0 = performance.now();
    const aplanado = aplanador.aplanar(data.malla, data.opciones);
    const respuesta: Respuesta = { id: data.id, ok: true, aplanado, milisegundos: performance.now() - t0 };
    // Se transfieren los buffers en lugar de copiarlos.
    const transferibles = [aplanado.uv, aplanado.caras, aplanado.origen, aplanado.corte, aplanado.estiramiento].map(
      (a) => a.buffer as ArrayBuffer,
    );
    self.postMessage(respuesta, transferibles);
  } catch (error) {
    // El código se traduce en la ventana principal (el trabajador no sabe el idioma elegido).
    const codigo = error instanceof ErrorAplanado ? error.codigo : undefined;
    self.postMessage({ id: data.id, ok: false, mensaje: String(error), codigo } satisfies Respuesta);
  }
};
