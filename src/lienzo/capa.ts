import { traducible } from "../i18n";
import { claveTesela, contexto, crearLamina, TESELA, type Lamina } from "./teselas";

export type ModoFusion = "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten";

export const MODOS_FUSION: { modo: ModoFusion; nombre: string }[] = [
  { modo: "normal", nombre: traducible("Normal") },
  { modo: "multiply", nombre: traducible("Multiplicar") },
  { modo: "screen", nombre: traducible("Trama") },
  { modo: "overlay", nombre: traducible("Superponer") },
  { modo: "darken", nombre: traducible("Oscurecer") },
  { modo: "lighten", nombre: traducible("Aclarar") },
];

export function operacionCanvas(modo: ModoFusion): GlobalCompositeOperation {
  return modo === "normal" ? "source-over" : modo;
}

/** Capa de píxeles dispersa: solo guarda las teselas con contenido (RF-31). */
export class Capa {
  visible = true;
  bloqueada = false;
  opacidad = 1;
  modo: ModoFusion = "normal";
  /** Si se exporta en el stencil por defecto (RF-54). */
  enStencil = true;
  readonly teselas = new Map<string, Lamina>();
  /** Teselas cambiadas desde el último guardado (también las borradas). */
  readonly sucias = new Set<string>();

  constructor(
    readonly id: string,
    public nombre: string,
  ) {}

  obtener(tx: number, ty: number): Lamina | undefined {
    return this.teselas.get(claveTesela(tx, ty));
  }

  obtenerOCrear(tx: number, ty: number): Lamina {
    const clave = claveTesela(tx, ty);
    let t = this.teselas.get(clave);
    if (!t) {
      t = crearLamina(TESELA, TESELA);
      this.teselas.set(clave, t);
    }
    return t;
  }

  /** Copia profunda (para duplicar capas o lienzos, RF-08). */
  duplicar(id: string, nombre: string): Capa {
    const copia = new Capa(id, nombre);
    copia.visible = this.visible;
    copia.opacidad = this.opacidad;
    copia.modo = this.modo;
    copia.enStencil = this.enStencil;
    for (const [clave, t] of this.teselas) {
      const nueva = crearLamina(TESELA, TESELA);
      contexto(nueva).drawImage(t, 0, 0);
      copia.teselas.set(clave, nueva);
      copia.sucias.add(clave);
    }
    return copia;
  }
}

export function nuevoId(): string {
  return crypto.randomUUID().slice(0, 8);
}
