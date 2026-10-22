import { readFileSync } from "node:fs";
import { Aplanador } from "../src/geometria/aplanador";
import { leerCuerpo, type Cuerpo } from "../src/modelos/cuerpo";

let cuerpo: Cuerpo | null = null;
let aplanador: Promise<Aplanador> | null = null;

/** Cuerpo base de MakeHuman, leído del archivo del repositorio. */
export function cuerpoBase(): Cuerpo {
  if (!cuerpo) {
    const bin = readFileSync(new URL("../src/modelos/cuerpo-base.bin", import.meta.url));
    cuerpo = leerCuerpo(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
  }
  return cuerpo;
}

/** Módulo de geometría en WebAssembly, el mismo que usa la aplicación. */
export function aplanadorReal(): Promise<Aplanador> {
  aplanador ??= Aplanador.crear(readFileSync(new URL("../src/geometria/dermap_geom.wasm", import.meta.url)));
  return aplanador;
}
