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

/**
 * Grupo de capas dentro de un lienzo (como las carpetas de Procreate o Photoshop): un solo
 * nivel, con sus capas seguidas en el orden de dibujo. Su visibilidad, bloqueo y opacidad se
 * aplican a todas sus capas.
 */
export class GrupoCapas {
  visible = true;
  bloqueado = false;
  opacidad = 1;
  /** Desplegado en el panel Capas. */
  abierto = true;

  constructor(
    readonly id: string,
    public nombre: string,
  ) {}
}

/** Capa de píxeles dispersa: solo guarda las teselas con contenido (RF-31). */
export class Capa {
  visible = true;
  bloqueada = false;
  opacidad = 1;
  modo: ModoFusion = "normal";
  /** Si se exporta en el stencil por defecto (RF-54). */
  enStencil = true;
  /** Grupo al que pertenece, si está en uno. */
  grupo: GrupoCapas | null = null;
  readonly teselas = new Map<string, Lamina>();
  /** Teselas cambiadas desde el último guardado (también las borradas). */
  readonly sucias = new Set<string>();

  constructor(
    readonly id: string,
    public nombre: string,
  ) {}

  /** Se ve: ella y su grupo están visibles. */
  get seVe(): boolean {
    return this.visible && (this.grupo?.visible ?? true);
  }

  /** No se puede pintar en ella: está bloqueada ella o su grupo. */
  get bloqueadaTotal(): boolean {
    return this.bloqueada || (this.grupo?.bloqueado ?? false);
  }

  /** Opacidad con la que se dibuja (la suya por la de su grupo). */
  get opacidadTotal(): number {
    return this.opacidad * (this.grupo?.opacidad ?? 1);
  }

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
