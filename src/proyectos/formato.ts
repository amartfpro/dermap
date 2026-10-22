import type { Aplanado } from "../geometria/aplanador";
import type { Zona } from "../lienzo/lienzo";

/**
 * zona.bin: la zona del cuerpo y su aplanado, para abrir un lienzo sin recalcular nada.
 *
 * Formato (little endian): "DMZ1" · uint8 tipo (0 parche, 1 manga) · 3 bytes de relleno ·
 * int32 volteados · 4 bytes de relleno (cabecera de 16 bytes) · y diez secciones, cada una
 * uint32 número de elementos + uint32 bytes por elemento + datos, rellenadas a múltiplos de
 * 8 bytes. Así todos los datos quedan alineados a 8 bytes y se leen sin copiarlos.
 */
const FIRMA = "DMZ1";
const CABECERA = 16;

type Seccion = Int32Array | Float64Array;

export function empaquetarZona(zona: Zona): Uint8Array {
  const a = zona.aplanado;
  const secciones: Seccion[] = [
    zona.triangulos,
    zona.verticeBase,
    zona.malla.vertices,
    zona.malla.caras,
    a.uv,
    a.caras,
    a.origen,
    a.corte,
    a.estiramiento,
    zona.errorPorCara,
  ];
  let total = CABECERA;
  for (const s of secciones) total += 8 + relleno8(s.byteLength);
  const bytes = new Uint8Array(total);
  const vista = new DataView(bytes.buffer);
  for (let i = 0; i < 4; i++) bytes[i] = FIRMA.charCodeAt(i);
  bytes[4] = a.tipo === "manga" ? 1 : 0;
  vista.setInt32(8, a.volteados, true);
  let p = CABECERA;
  for (const s of secciones) {
    vista.setUint32(p, s.length, true);
    vista.setUint32(p + 4, s.BYTES_PER_ELEMENT, true);
    p += 8;
    bytes.set(new Uint8Array(s.buffer, s.byteOffset, s.byteLength), p);
    p += relleno8(s.byteLength);
  }
  return bytes;
}

export function desempaquetarZona(bytes: Uint8Array): Zona {
  const firma = String.fromCharCode(...bytes.subarray(0, 4));
  if (firma !== FIRMA) throw new Error("zona.bin no válido");
  // Copia alineada: los Float64Array necesitan desplazamientos múltiplos de 8.
  const copia = bytes.slice().buffer;
  const vista = new DataView(copia);
  const tipo = bytes[4] === 1 ? "manga" : "parche";
  const volteados = vista.getInt32(8, true);
  let p = CABECERA;
  const leer = (): Seccion => {
    const n = vista.getUint32(p, true);
    const tam = vista.getUint32(p + 4, true);
    p += 8;
    const s = tam === 8 ? new Float64Array(copia, p, n) : new Int32Array(copia, p, n);
    p += relleno8(n * tam);
    return s;
  };
  const triangulos = leer() as Int32Array;
  const verticeBase = leer() as Int32Array;
  const vertices = leer() as Float64Array;
  const carasMalla = leer() as Int32Array;
  const aplanado: Aplanado = {
    tipo,
    volteados,
    uv: leer() as Float64Array,
    caras: leer() as Int32Array,
    origen: leer() as Int32Array,
    corte: leer() as Int32Array,
    estiramiento: leer() as Float64Array,
  };
  const errorPorCara = leer() as Float64Array;
  return { triangulos, verticeBase, malla: { vertices, caras: carasMalla }, aplanado, errorPorCara };
}

function relleno8(n: number): number {
  return Math.ceil(n / 8) * 8;
}

/** Nombre de carpeta seguro en Windows y macOS (sin caracteres ni nombres reservados). */
export function nombreSeguro(nombre: string): string {
  const limpio = nombre
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/[. ]+$/, "")
    .trim()
    .slice(0, 80);
  if (!limpio) return "Sin nombre";
  // Windows no admite estos nombres de dispositivo como nombre de carpeta.
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(limpio) ? `${limpio}_` : limpio;
}
