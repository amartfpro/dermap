/**
 * Filtros para pasar una foto o un boceto a stencil: blanco y negro por umbral, o contornos
 * (detección de bordes). Trabajan sobre píxeles RGBA y devuelven una máscara de tinta
 * (1 = tinta), para no depender de los filtros del canvas, que el WebView de macOS no tiene.
 */
export type ModoFiltro = "umbral" | "contornos";

export interface OpcionesFiltro {
  modo: ModoFiltro;
  /** 0–255: umbral de oscuridad (umbral) o de intensidad del borde (contornos). */
  umbral: number;
  /** Radio del suavizado previo, en píxeles. */
  suavizado: number;
  /** Grosor extra de las líneas, en píxeles (solo contornos). */
  grosor: number;
  /**
   * Distancia en píxeles a la que se mide el gradiente (1 en la vista previa; a resolución
   * completa, la escala entre ambas), para que el umbral dé el mismo resultado.
   */
  paso?: number;
}

/** Luminancia 0–255 con lo transparente como blanco (papel). */
export function luminancia(rgba: Uint8ClampedArray, n: number): Float32Array {
  const l = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = rgba[4 * i + 3] / 255;
    const y = 0.299 * rgba[4 * i] + 0.587 * rgba[4 * i + 1] + 0.114 * rgba[4 * i + 2];
    l[i] = 255 - a * (255 - y);
  }
  return l;
}

/** Desenfoque de caja separable, aplicado dos veces (aproxima un gaussiano). */
export function suavizar(l: Float32Array, w: number, h: number, radio: number): Float32Array {
  const r = Math.round(radio);
  if (r < 1) return l;
  let a = l;
  for (let pasada = 0; pasada < 2; pasada++) {
    const b = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      let suma = 0;
      const fila = y * w;
      for (let x = -r; x <= r; x++) suma += a[fila + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        b[fila + x] = suma / (2 * r + 1);
        suma += a[fila + Math.min(w - 1, x + r + 1)] - a[fila + Math.max(0, x - r)];
      }
    }
    const c = new Float32Array(w * h);
    for (let x = 0; x < w; x++) {
      let suma = 0;
      for (let y = -r; y <= r; y++) suma += b[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        c[y * w + x] = suma / (2 * r + 1);
        suma += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
      }
    }
    a = c;
  }
  return a;
}

/** Máscara de tinta según el modo. */
export function filtrar(rgba: Uint8ClampedArray, w: number, h: number, o: OpcionesFiltro): Uint8Array {
  const l = suavizar(luminancia(rgba, w * h), w, h, o.suavizado);
  const tinta = new Uint8Array(w * h);
  if (o.modo === "umbral") {
    for (let i = 0; i < w * h; i++) tinta[i] = l[i] < o.umbral ? 1 : 0;
    return tinta;
  }
  // Sobel con vecinos a `paso` píxeles: magnitud del gradiente frente al umbral.
  const d = Math.max(1, Math.round(o.paso ?? 1));
  const limite = (255 - o.umbral) * 2;
  for (let y = d; y < h - d; y++)
    for (let x = d; x < w - d; x++) {
      const i = y * w + x;
      const dw = d * w;
      const gx =
        -l[i - dw - d] - 2 * l[i - d] - l[i + dw - d] + l[i - dw + d] + 2 * l[i + d] + l[i + dw + d];
      const gy =
        -l[i - dw - d] - 2 * l[i - dw] - l[i - dw + d] + l[i + dw - d] + 2 * l[i + dw] + l[i + dw + d];
      tinta[i] = Math.hypot(gx, gy) > limite ? 1 : 0;
    }
  return engrosar(tinta, w, h, Math.round(o.grosor));
}

/** Dilatación cuadrada de la máscara `r` píxeles. */
export function engrosar(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r < 1) return m;
  let a = m;
  for (let k = 0; k < r; k++) {
    const b = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        b[i] = a[i] || (x > 0 && a[i - 1]) || (x < w - 1 && a[i + 1]) || (y > 0 && a[i - w]) || (y < h - 1 && a[i + w]) ? 1 : 0;
      }
    a = b;
  }
  return a;
}
