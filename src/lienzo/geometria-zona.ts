import type { Aplanado, Malla } from "../geometria/aplanador";
import { contexto, crearLamina, type Lamina } from "./teselas";

/** Resolución de impresión del lienzo (RNF-05). */
export const PPP = 300;
export const PX_POR_CM = PPP / 2.54;
export const PX_POR_MM = PX_POR_CM / 10;
/** Lado máximo de la textura que ve el visor 3D (límite seguro en GPUs integradas). */
export const LADO_MAXIMO_PREVIA = 4096;

type P2 = [number, number];

/**
 * Geometría de una zona aplanada en coordenadas del lienzo (píxeles a 300 ppp):
 * correspondencia uv → lienzo, contorno, costuras y sus transformaciones, máscara y mapa
 * de deformación (estos dos a la resolución de la vista previa).
 *
 * Coordenadas: x = (u − uMin)·px/cm + margen, y = (vMax − v)·px/cm + margen (u, v en cm).
 */
export class GeometriaZona {
  readonly pxPorCm = PX_POR_CM;
  readonly margen = Math.round(0.5 * PX_POR_CM);
  readonly ancho: number;
  readonly alto: number;
  /** Escala de la vista previa respecto al documento (≤ 1). */
  readonly escalaPrevia: number;
  readonly anchoPrevia: number;
  readonly altoPrevia: number;

  /** Polígono cerrado del borde de la zona aplanada: recorta la tinta y el stencil. */
  readonly recorte = new Path2D();
  /** Bordes que no son costura (para dibujar el contorno). */
  readonly contorno = new Path2D();
  /** Aristas de costura, a ambos lados del corte. */
  readonly costura = new Path2D();
  /** Polígonos del borde, en coordenadas del lienzo (para exportar). */
  readonly bordes: P2[][] = [];
  /** Los mismos polígonos como índices de vértices de la malla cortada (para el 3D). */
  readonly bordesIndices: number[][] = [];
  /** Blanco dentro de la zona (vista previa). */
  readonly mascara: Lamina;
  /** Mapa de deformación por triángulo (vista previa). */
  readonly deformacion: Lamina;

  private readonly costuras: Costura[] = [];
  private readonly uMin: number;
  private readonly vMax: number;

  constructor(
    readonly malla: Malla,
    readonly aplanado: Aplanado,
    readonly errorPorCara: Float64Array,
  ) {
    const uv = aplanado.uv;
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (let i = 0; i < uv.length; i += 2) {
      uMin = Math.min(uMin, uv[i]);
      uMax = Math.max(uMax, uv[i]);
      vMin = Math.min(vMin, uv[i + 1]);
      vMax = Math.max(vMax, uv[i + 1]);
    }
    this.uMin = uMin;
    this.vMax = vMax;
    this.ancho = Math.ceil((uMax - uMin) * this.pxPorCm + 2 * this.margen);
    this.alto = Math.ceil((vMax - vMin) * this.pxPorCm + 2 * this.margen);
    this.escalaPrevia = Math.min(1, LADO_MAXIMO_PREVIA / Math.max(this.ancho, this.alto));
    this.anchoPrevia = Math.ceil(this.ancho * this.escalaPrevia);
    this.altoPrevia = Math.ceil(this.alto * this.escalaPrevia);

    this.mascara = crearLamina(this.anchoPrevia, this.altoPrevia);
    this.deformacion = crearLamina(this.anchoPrevia, this.altoPrevia);
    this.pintarMascaraYDeformacion();
    this.analizarBordes();
  }

  /** Tamaño real de la zona en centímetros (sin márgenes). */
  get tamanoCm(): [number, number] {
    return [(this.ancho - 2 * this.margen) / this.pxPorCm, (this.alto - 2 * this.margen) / this.pxPorCm];
  }

  aLienzo(i: number): P2 {
    const uv = this.aplanado.uv;
    return [
      (uv[2 * i] - this.uMin) * this.pxPorCm + this.margen,
      (this.vMax - uv[2 * i + 1]) * this.pxPorCm + this.margen,
    ];
  }

  /**
   * Coordenadas de textura (0..1) de cada vértice cortado. Sin inversión vertical: la textura
   * del visor se crea con flipY = false para poder actualizarla por regiones.
   */
  coordenadasDeTextura(): Float32Array {
    const n = this.aplanado.uv.length / 2;
    const t = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const [x, y] = this.aLienzo(i);
      t[2 * i] = (x * this.escalaPrevia) / this.anchoPrevia;
      t[2 * i + 1] = (y * this.escalaPrevia) / this.altoPrevia;
    }
    return t;
  }

  get numeroDeCosturas(): number {
    return this.costuras.length / 2;
  }

  /**
   * Costuras que tocan el segmento p → q con un trazo de grosor `ancho`: su transformación
   * lleva el trazo al otro lado del corte (RF-36). Alcance de 1 cm más allá del borde.
   */
  costurasCerca(p: P2, q: P2, ancho: number): DOMMatrix[] {
    const alcance = ancho / 2 + this.pxPorCm;
    const resultado: DOMMatrix[] = [];
    for (const c of this.costuras)
      if (distanciaEntreSegmentos(p, q, c.desde.a, c.desde.b) <= alcance) resultado.push(c.matriz);
    return resultado;
  }

  /** Lados de costura con su transformación (para la franja de referencia). */
  get ladosDeCostura(): readonly Costura[] {
    return this.costuras;
  }

  private pintarMascaraYDeformacion(): void {
    const m = contexto(this.mascara);
    const d = contexto(this.deformacion);
    m.scale(this.escalaPrevia, this.escalaPrevia);
    d.scale(this.escalaPrevia, this.escalaPrevia);
    const caras = this.aplanado.caras;
    m.fillStyle = "#fff";
    m.strokeStyle = "#fff";
    m.lineWidth = 1.5 / this.escalaPrevia;
    for (let f = 0; f < caras.length / 3; f++) {
      const t = new Path2D();
      const [a, b, c] = [caras[3 * f], caras[3 * f + 1], caras[3 * f + 2]].map((v) => this.aLienzo(v));
      t.moveTo(...a);
      t.lineTo(...b);
      t.lineTo(...c);
      t.closePath();
      m.fill(t);
      m.stroke(t); // cubre las rendijas de antialiasing entre triángulos
      const color = colorDeDeformacion(this.errorPorCara[f]);
      if (!color) continue;
      d.fillStyle = color;
      d.fill(t);
      d.strokeStyle = color;
      d.lineWidth = 1 / this.escalaPrevia;
      d.stroke(t);
    }
  }

  /**
   * Analiza las aristas de borde de la malla cortada:
   *  - las encadena en polígonos cerrados (recorte de la zona);
   *  - una arista original que aparece dos veces como borde es costura: un lado de cada
   *    aparición se une con el otro en la piel; se guarda la transformación entre ambos.
   */
  private analizarBordes(): void {
    const { caras, origen } = this.aplanado;
    const usos = new Map<string, { a: number; b: number; opuesto: number; n: number }>();
    const clave = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
    for (let f = 0; f < caras.length / 3; f++)
      for (let j = 0; j < 3; j++) {
        const a = caras[3 * f + j];
        const b = caras[3 * f + ((j + 1) % 3)];
        const k = clave(a, b);
        const u = usos.get(k);
        if (u) u.n++;
        else usos.set(k, { a, b, opuesto: caras[3 * f + ((j + 2) % 3)], n: 1 });
      }

    // Polígonos del borde: cada arista de borde va a → b en el sentido de su triángulo.
    const siguiente = new Map<number, number>();
    for (const u of usos.values()) if (u.n === 1) siguiente.set(u.a, u.b);
    const visitado = new Set<number>();
    for (const inicio of siguiente.keys()) {
      if (visitado.has(inicio)) continue;
      const poligono: P2[] = [];
      const indices: number[] = [];
      let v: number | undefined = inicio;
      while (v !== undefined && !visitado.has(v)) {
        visitado.add(v);
        poligono.push(this.aLienzo(v));
        indices.push(v);
        v = siguiente.get(v);
      }
      if (poligono.length < 3) continue;
      this.bordes.push(poligono);
      this.bordesIndices.push(indices);
      this.recorte.moveTo(...poligono[0]);
      for (const p of poligono.slice(1)) this.recorte.lineTo(...p);
      this.recorte.closePath();
    }

    const porOriginal = new Map<string, { a: number; b: number; opuesto: number }[]>();
    for (const u of usos.values()) {
      if (u.n !== 1) continue;
      const k = clave(origen[u.a], origen[u.b]);
      const lista = porOriginal.get(k);
      if (lista) lista.push(u);
      else porOriginal.set(k, [u]);
    }
    for (const lista of porOriginal.values()) {
      if (lista.length !== 2) {
        for (const u of lista) {
          this.contorno.moveTo(...this.aLienzo(u.a));
          this.contorno.lineTo(...this.aLienzo(u.b));
        }
        continue;
      }
      // Empareja los extremos por su vértice original: a1 ↔ a2 y b1 ↔ b2.
      const [e1, e2raw] = lista;
      const e2 = origen[e2raw.a] === origen[e1.a] ? e2raw : { a: e2raw.b, b: e2raw.a, opuesto: e2raw.opuesto };
      const lado1 = this.ladoDeCostura(e1.a, e1.b, e1.opuesto);
      const lado2 = this.ladoDeCostura(e2.a, e2.b, e2.opuesto);
      this.costuras.push({ desde: lado1, hacia: lado2, matriz: semejanza(lado1, lado2) });
      this.costuras.push({ desde: lado2, hacia: lado1, matriz: semejanza(lado2, lado1) });
      for (const lado of [lado1, lado2]) {
        this.costura.moveTo(...lado.a);
        this.costura.lineTo(...lado.b);
      }
    }
  }

  private ladoDeCostura(a: number, b: number, opuesto: number): LadoDeCostura {
    const pa = this.aLienzo(a);
    const pb = this.aLienzo(b);
    const po = this.aLienzo(opuesto);
    // Normal hacia fuera de la zona: perpendicular a la arista, en sentido contrario al vértice opuesto.
    let nx = -(pb[1] - pa[1]);
    let ny = pb[0] - pa[0];
    const largo = Math.hypot(nx, ny) || 1;
    nx /= largo;
    ny /= largo;
    if ((po[0] - pa[0]) * nx + (po[1] - pa[1]) * ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    return { a: pa, b: pb, fuera: [nx, ny] };
  }
}

export interface LadoDeCostura {
  a: P2;
  b: P2;
  /** Normal unitaria hacia fuera de la zona. */
  fuera: P2;
}

export interface Costura {
  desde: LadoDeCostura;
  hacia: LadoDeCostura;
  /** Lleva el lienzo cerca de «desde» a la posición equivalente junto a «hacia». */
  matriz: DOMMatrix;
}

/** Semejanza (giro, escala y traslación, sin reflexión) que lleva a1→a2 y b1→b2. */
function semejanza(l1: LadoDeCostura, l2: LadoDeCostura): DOMMatrix {
  const [ax, ay] = l1.a;
  const d1 = [l1.b[0] - ax, l1.b[1] - ay];
  const d2 = [l2.b[0] - l2.a[0], l2.b[1] - l2.a[1]];
  const angulo = Math.atan2(d2[1], d2[0]) - Math.atan2(d1[1], d1[0]);
  const escala = Math.hypot(d2[0], d2[1]) / (Math.hypot(d1[0], d1[1]) || 1);
  return new DOMMatrix()
    .translate(l2.a[0], l2.a[1])
    .rotate((angulo * 180) / Math.PI)
    .scale(escala)
    .translate(-ax, -ay);
}

function distanciaPuntoSegmento(p: P2, a: P2, b: P2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function distanciaEntreSegmentos(p: P2, q: P2, a: P2, b: P2): number {
  return Math.min(
    distanciaPuntoSegmento(p, a, b),
    distanciaPuntoSegmento(q, a, b),
    distanciaPuntoSegmento(a, p, q),
    distanciaPuntoSegmento(b, p, q),
  );
}

/** ≤ 2 %: sin color · 2–5 %: ámbar · > 5 %: rojo. */
function colorDeDeformacion(error: number): string | null {
  if (error <= 0.02) return null;
  if (error <= 0.05) return "rgba(230, 160, 40, 0.35)";
  return "rgba(220, 60, 50, 0.45)";
}
