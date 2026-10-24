/**
 * Filtros para pasar una foto o un boceto a stencil (RF-33). Trabajan sobre píxeles RGBA y
 * devuelven una máscara de tinta (1 = tinta), para no depender de los filtros del canvas, que
 * el WebView de macOS no tiene. Las medidas (suavizado, grosor, manchas) van en píxeles de la
 * imagen que se filtra: quien llama las pasa de mm a píxeles, así la vista previa reducida y el
 * resultado a resolución completa dan el mismo dibujo.
 *
 *  - «lineas»: diferencia de gaussianas (como un dibujo a lápiz): una línea por cada trazo o
 *    borde oscuro, sin las líneas dobles de un detector de bordes. Para fotos y bocetos.
 *  - «umbral»: blanco y negro. Con `adaptativo`, el umbral se calcula alrededor de cada píxel
 *    (para fotos con luz desigual o bocetos a lápiz sobre papel con sombras).
 */
export type ModoFiltro = "lineas" | "umbral";

export interface OpcionesFiltro {
  modo: ModoFiltro;
  /** 0–100: cuánto se marca (más = más tinta). */
  intensidad: number;
  /** Detalle (líneas) o suavizado previo (umbral), en píxeles: el radio de la gaussiana. */
  suavizado: number;
  /** Grosor extra de las líneas, en píxeles. */
  grosor: number;
  /** Solo umbral: compara cada píxel con su entorno en lugar de con un umbral fijo. */
  adaptativo?: boolean;
  /** Radio del entorno del umbral adaptativo, en píxeles. */
  radioLocal?: number;
  /** Manchas de tinta más pequeñas que esto (en píxeles de área) se quitan. */
  manchas?: number;
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

/** Desenfoque de caja separable, aplicado tres veces (aproxima una gaussiana de ese radio). */
export function suavizar(l: Float32Array, w: number, h: number, radio: number): Float32Array {
  // Tres cajas de radio r equivalen a una gaussiana de sigma ≈ r.
  const r = Math.round(radio);
  if (r < 1) return l;
  let a = l;
  for (let pasada = 0; pasada < 3; pasada++) {
    const b = new Float32Array(w * h);
    const n = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      const fila = y * w;
      let suma = 0;
      for (let x = -r; x <= r; x++) suma += a[fila + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        b[fila + x] = suma / n;
        suma += a[fila + Math.min(w - 1, x + r + 1)] - a[fila + Math.max(0, x - r)];
      }
    }
    const c = new Float32Array(w * h);
    for (let x = 0; x < w; x++) {
      let suma = 0;
      for (let y = -r; y <= r; y++) suma += b[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        c[y * w + x] = suma / n;
        suma += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
      }
    }
    a = c;
  }
  return a;
}

/** Máscara de tinta según el modo. */
export function filtrar(rgba: Uint8ClampedArray, w: number, h: number, o: OpcionesFiltro): Uint8Array {
  const l = luminancia(rgba, w * h);
  const tinta = new Uint8Array(w * h);
  const k = Math.max(0, Math.min(100, o.intensidad)) / 100;
  if (o.modo === "umbral") {
    const s = suavizar(l, w, h, o.suavizado);
    if (o.adaptativo) {
      // Tinta donde el píxel es más oscuro que su entorno por más de un margen.
      const entorno = suavizar(s, w, h, Math.max(2, o.radioLocal ?? 15));
      const margen = 40 * (1 - k) + 2;
      for (let i = 0; i < w * h; i++) tinta[i] = s[i] < entorno[i] - margen && s[i] < 235 ? 1 : 0;
    } else {
      const umbral = 40 + 200 * k;
      for (let i = 0; i < w * h; i++) tinta[i] = s[i] < umbral ? 1 : 0;
    }
  } else {
    // Diferencia de gaussianas: negativa donde hay algo más oscuro que su entorno inmediato
    // (un trazo, o el lado oscuro de un borde).
    const r1 = Math.max(1, Math.round(o.suavizado));
    const r2 = Math.max(r1 + 1, Math.round(o.suavizado * 1.8));
    const g1 = suavizar(l, w, h, r1);
    const g2 = suavizar(l, w, h, r2);
    const limite = 1 + 24 * (1 - k);
    for (let i = 0; i < w * h; i++) tinta[i] = g2[i] - g1[i] > limite ? 1 : 0;
  }
  const limpia = o.manchas ? quitarManchas(tinta, w, h, o.manchas) : tinta;
  return engrosar(limpia, w, h, o.grosor);
}

/** Quita las manchas de tinta (zonas conectadas) de menos de `minimo` píxeles. */
export function quitarManchas(m: Uint8Array, w: number, h: number, minimo: number): Uint8Array {
  if (minimo < 2) return m;
  const r = Uint8Array.from(m);
  const visto = new Uint8Array(w * h);
  const pila = new Int32Array(w * h);
  const zona: number[] = [];
  for (let inicio = 0; inicio < w * h; inicio++) {
    if (!r[inicio] || visto[inicio]) continue;
    let n = 0;
    pila[n++] = inicio;
    visto[inicio] = 1;
    zona.length = 0;
    while (n) {
      const i = pila[--n];
      zona.push(i);
      // Solo hace falta saber si llega al mínimo: las zonas grandes no se guardan enteras.
      const x = i % w;
      const vecinos = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
      for (const v of vecinos)
        if (v >= 0 && v < w * h && r[v] && !visto[v]) {
          visto[v] = 1;
          pila[n++] = v;
        }
    }
    if (zona.length < minimo) for (const i of zona) r[i] = 0;
  }
  return r;
}

/** Engorda la máscara `radio` píxeles (con forma redondeada: cruz y cuadrado alternos). */
export function engrosar(m: Uint8Array, w: number, h: number, radio: number): Uint8Array {
  const pasos = Math.round(radio);
  if (pasos < 1) return m;
  let a = m;
  for (let k = 0; k < pasos; k++) {
    const b = new Uint8Array(w * h);
    const diagonal = k % 2 === 1;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (a[i]) {
          b[i] = 1;
          continue;
        }
        const izq = x > 0, der = x < w - 1, arr = y > 0, aba = y < h - 1;
        let v = (izq && a[i - 1]) || (der && a[i + 1]) || (arr && a[i - w]) || (aba && a[i + w]);
        if (!v && diagonal) v = (izq && arr && a[i - w - 1]) || (der && arr && a[i - w + 1]) || (izq && aba && a[i + w - 1]) || (der && aba && a[i + w + 1]);
        b[i] = v ? 1 : 0;
      }
    a = b;
  }
  return a;
}
