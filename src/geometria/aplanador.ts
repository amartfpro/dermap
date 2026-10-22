import { t, traducible } from "../i18n";
/**
 * Envoltorio del módulo de geometría en WebAssembly (geometria/dermap_geom.cpp).
 * No depende del DOM: funciona en un Web Worker y en Node (para las mediciones).
 */

export interface Malla {
  /** Posiciones x, y, z por vértice, en centímetros. */
  vertices: Float64Array;
  /** Tres índices de vértice por triángulo. */
  caras: Int32Array;
}

export interface OpcionesAplanado {
  /** El corte por defecto va por el lado opuesto a esta dirección. Por defecto +Z (el corte queda detrás). */
  direccionExterna?: [number, number, number];
  /** Vértices de inicio y fin del corte de una manga; si se omiten se eligen automáticamente. */
  extremos?: [number, number];
  /** Iteraciones de SLIM tras la inicialización conforme. */
  iteraciones?: number;
  /**
   * Cortes adicionales (RF-25), como caminos de vértices; cada uno debe empezar en un borde.
   * Reducen la deformación en zonas muy curvas, como las pinzas de un patrón de costura.
   */
  cortesExtra?: number[][];
  /** Corte principal trazado por el usuario (RF-22), de borde a borde; sustituye al automático. */
  corteManual?: number[];
}

export interface Aplanado {
  tipo: "parche" | "manga";
  /** Coordenadas u, v en centímetros por vértice de la malla cortada. */
  uv: Float64Array;
  /** Triángulos sobre la malla cortada (mismo orden que los de entrada). */
  caras: Int32Array;
  /** Para cada vértice cortado, su vértice en la malla original. */
  origen: Int32Array;
  /**
   * Vértices originales por los que pasan los cortes, en orden. El corte principal (vacío en
   * parches) va primero; los cortes extra le siguen, separados por -1.
   */
  corte: Int32Array;
  /** σ1 y σ2 por triángulo: estiramiento máximo y mínimo (1 = sin deformación). */
  estiramiento: Float64Array;
  /** Triángulos con orientación invertida (deben ser 0). */
  volteados: number;
}

const MENSAJES: Record<number, string> = {
  1: traducible("La zona debe tener un solo borde (parche) o dos (manga). Amplía la selección para cerrar los huecos."),
  2: traducible("No se encontró un camino de corte entre los dos bordes de la manga."),
  3: traducible("El corte debe empezar en un borde de la manga y terminar en el otro."),
  4: traducible("No se pudo aplanar la zona."),
};

export class ErrorAplanado extends Error {
  constructor(readonly codigo: number) {
    super(MENSAJES[codigo] ? t(MENSAJES[codigo]) : t("Error de geometría {codigo}", { codigo }));
  }
}

interface Exportaciones {
  memory: WebAssembly.Memory;
  _initialize(): void;
  dm_reservar(bytes: number): number;
  dm_liberar(puntero: number): void;
  dm_aplanar(
    v: number, nV: number, f: number, nF: number,
    dx: number, dy: number, dz: number,
    a: number, b: number, iteraciones: number,
    extra: number, nExtra: number,
  ): number;
  dm_resultado_bordes(): number;
  dm_resultado_volteados(): number;
  dm_resultado_num_vertices(): number;
  dm_resultado_num_caras(): number;
  dm_resultado_num_corte(): number;
  dm_resultado_uv(): number;
  dm_resultado_caras(): number;
  dm_resultado_origen(): number;
  dm_resultado_corte(): number;
  dm_resultado_estiramiento(): number;
}

export class Aplanador {
  private constructor(private readonly wasm: Exportaciones) {}

  /** Carga el módulo a partir de los bytes del .wasm. */
  static async crear(bytes: BufferSource): Promise<Aplanador> {
    let memoria: WebAssembly.Memory | undefined;
    const { instance } = await WebAssembly.instantiate(bytes, {
      wasi_snapshot_preview1: wasiMinimo(() => memoria!),
    });
    const wasm = instance.exports as unknown as Exportaciones;
    memoria = wasm.memory;
    wasm._initialize();
    return new Aplanador(wasm);
  }

  aplanar(malla: Malla, opciones: OpcionesAplanado = {}): Aplanado {
    const w = this.wasm;
    const [dx, dy, dz] = opciones.direccionExterna ?? [0, 0, 1];
    const [a, b] = opciones.corteManual ? [-2, -1] : (opciones.extremos ?? [-1, -1]);
    const nV = malla.vertices.length / 3;
    const nF = malla.caras.length / 3;

    const caminos = [...(opciones.corteManual ? [opciones.corteManual] : []), ...(opciones.cortesExtra ?? [])];
    const extra = Int32Array.from(caminos.flatMap((c, i) => (i ? [-1, ...c] : c)));
    const pV = w.dm_reservar(malla.vertices.byteLength);
    const pF = w.dm_reservar(malla.caras.byteLength);
    const pE = w.dm_reservar(Math.max(4, extra.byteLength));
    try {
      new Float64Array(w.memory.buffer, pV, malla.vertices.length).set(malla.vertices);
      new Int32Array(w.memory.buffer, pF, malla.caras.length).set(malla.caras);
      new Int32Array(w.memory.buffer, pE, extra.length).set(extra);
      const codigo = w.dm_aplanar(pV, nV, pF, nF, dx, dy, dz, a, b, opciones.iteraciones ?? 30, pE, extra.length);
      if (codigo !== 0) throw new ErrorAplanado(codigo);
    } finally {
      w.dm_liberar(pV);
      w.dm_liberar(pF);
      w.dm_liberar(pE);
    }

    // Se copian los resultados: la memoria del módulo puede crecer y moverse.
    const buffer = w.memory.buffer;
    const nVc = w.dm_resultado_num_vertices();
    const nFc = w.dm_resultado_num_caras();
    return {
      tipo: w.dm_resultado_bordes() === 2 ? "manga" : "parche",
      uv: new Float64Array(buffer, w.dm_resultado_uv(), nVc * 2).slice(),
      caras: new Int32Array(buffer, w.dm_resultado_caras(), nFc * 3).slice(),
      origen: new Int32Array(buffer, w.dm_resultado_origen(), nVc).slice(),
      corte: new Int32Array(buffer, w.dm_resultado_corte(), w.dm_resultado_num_corte()).slice(),
      estiramiento: new Float64Array(buffer, w.dm_resultado_estiramiento(), nFc * 2).slice(),
      volteados: w.dm_resultado_volteados(),
    };
  }
}

/**
 * Funciones de sistema WASI mínimas que pide el módulo: la salida por consola se reenvía
 * a console y el resto (archivos, entorno) se responde como «no disponible».
 */
function wasiMinimo(memoria: () => WebAssembly.Memory): Record<string, (...args: number[]) => number> {
  const EBADF = 8;
  const decodificador = new TextDecoder();
  let pendiente = "";
  return {
    fd_write(fd, iovs, iovsLen, escritos) {
      const vista = new DataView(memoria().buffer);
      let total = 0;
      for (let i = 0; i < iovsLen; i++) {
        const ptr = vista.getUint32(iovs + i * 8, true);
        const len = vista.getUint32(iovs + i * 8 + 4, true);
        pendiente += decodificador.decode(new Uint8Array(memoria().buffer, ptr, len));
        total += len;
      }
      const lineas = pendiente.split("\n");
      pendiente = lineas.pop() ?? "";
      for (const linea of lineas) (fd === 2 ? console.warn : console.debug)(`[geometría] ${linea}`);
      vista.setUint32(escritos, total, true);
      return 0;
    },
    fd_fdstat_get: (fd) => (fd <= 2 ? 0 : EBADF),
    fd_close: () => 0,
    fd_seek: () => EBADF,
    fd_read: () => EBADF,
    fd_prestat_get: () => EBADF,
    fd_prestat_dir_name: () => EBADF,
    environ_sizes_get(cuenta, tamano) {
      const vista = new DataView(memoria().buffer);
      vista.setUint32(cuenta, 0, true);
      vista.setUint32(tamano, 0, true);
      return 0;
    },
    environ_get: () => 0,
    proc_exit(codigo) {
      throw new Error(`El módulo de geometría terminó con código ${codigo}`);
    },
  };
}
