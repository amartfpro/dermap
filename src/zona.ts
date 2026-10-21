import type { Aplanado, Malla } from "./geometria/aplanador";

/**
 * Zona activa: la malla seleccionada, su aplanado y los lienzos de dibujo.
 * La comparten el visor 3D y el editor de lienzo. Provisional para el prototipo:
 * en la app definitiva vivirá en el estado del proyecto, con capas y teselas.
 *
 * Coordenadas del lienzo: x = (u − uMin)·escala + margen, y = (vMax − v)·escala + margen,
 * con u, v en centímetros (v hacia arriba, y del lienzo hacia abajo).
 */
export class ZonaActiva {
  /** Resolución del lienzo del prototipo. La app final trabajará a 300 ppp (≈ 118 px/cm). */
  readonly pxPorCm: number;
  readonly margen = 16;
  readonly ancho: number;
  readonly alto: number;

  /** Tinta: solo lo dibujado, sobre fondo transparente. */
  readonly dibujo: HTMLCanvasElement;
  /** Blanco dentro de la zona aplanada, transparente fuera. */
  readonly mascara: HTMLCanvasElement;
  /** Mapa de deformación por triángulo, semitransparente. */
  readonly deformacion: HTMLCanvasElement;
  /** Composición que usa el visor 3D como textura: piel, cuadrícula y tinta. */
  readonly textura: HTMLCanvasElement;
  /** Contorno de la zona y, aparte, las aristas de costura (el corte). */
  readonly contorno = new Path2D();
  readonly costura = new Path2D();
  /** Lo dibujado al otro lado de cada costura, para la franja de referencia. */
  readonly fantasma: HTMLCanvasElement;
  private readonly costuras: Costura[] = [];

  cuadricula = true;
  private readonly uMin: number;
  private readonly vMax: number;

  constructor(
    readonly malla: Malla,
    readonly aplanado: Aplanado,
    readonly errorPorCara: Float64Array,
    readonly tonoPiel = "#d8a98a",
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
    // Texturas de hasta 4096 px de lado (límite seguro en GPUs integradas).
    this.pxPorCm = Math.min(24, (4096 - 2 * this.margen) / Math.max(uMax - uMin, vMax - vMin));
    this.ancho = Math.ceil((uMax - uMin) * this.pxPorCm + 2 * this.margen);
    this.alto = Math.ceil((vMax - vMin) * this.pxPorCm + 2 * this.margen);

    const crear = () => Object.assign(document.createElement("canvas"), { width: this.ancho, height: this.alto });
    this.dibujo = crear();
    this.mascara = crear();
    this.deformacion = crear();
    this.textura = crear();
    this.fantasma = crear();

    this.pintarMascaraYDeformacion();
    this.trazarContorno();
    this.componer();
  }

  aLienzo(i: number): [number, number] {
    const uv = this.aplanado.uv;
    return [
      (uv[2 * i] - this.uMin) * this.pxPorCm + this.margen,
      (this.vMax - uv[2 * i + 1]) * this.pxPorCm + this.margen,
    ];
  }

  /** Coordenadas de textura (0..1) de cada vértice cortado, para el visor 3D. */
  coordenadasDeTextura(): Float32Array {
    const n = this.aplanado.uv.length / 2;
    const t = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const [x, y] = this.aLienzo(i);
      t[2 * i] = x / this.ancho;
      t[2 * i + 1] = 1 - y / this.alto; // las texturas de Three.js tienen v hacia arriba
    }
    return t;
  }

  /** Recompone la textura del 3D a partir de la tinta. Se llama tras cada trazo. */
  componer(): void {
    const ctx = this.textura.getContext("2d")!;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = this.tonoPiel;
    ctx.fillRect(0, 0, this.ancho, this.alto);
    if (this.cuadricula) this.pintarCuadricula(ctx, "rgba(60, 40, 30, 0.22)", "rgba(60, 40, 30, 0.4)");
    // La tinta se multiplica con la piel: una aproximación simple a tinta bajo la piel (RF-45).
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(this.dibujo, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    document.dispatchEvent(new Event("dermap:textura"));
  }

  borrar(): void {
    this.dibujo.getContext("2d")!.clearRect(0, 0, this.ancho, this.alto);
    this.actualizarFantasma();
    this.componer();
  }

  get numeroDeCosturas(): number {
    return this.costuras.length / 2;
  }

  /** Cuadrícula de 1 cm (y más marcada cada 5 cm): permite comprobar la escala a simple vista. */
  pintarCuadricula(ctx: CanvasRenderingContext2D, fina: string, gruesa: string): void {
    const paso = this.pxPorCm;
    for (let i = 0; this.margen + i * paso <= this.ancho; i++) {
      ctx.fillStyle = i % 5 === 0 ? gruesa : fina;
      ctx.fillRect(Math.round(this.margen + i * paso), 0, i % 5 === 0 ? 2 : 1, this.alto);
    }
    for (let j = 0; this.margen + j * paso <= this.alto; j++) {
      ctx.fillStyle = j % 5 === 0 ? gruesa : fina;
      ctx.fillRect(0, Math.round(this.margen + j * paso), this.ancho, j % 5 === 0 ? 2 : 1);
    }
  }

  private pintarMascaraYDeformacion(): void {
    const m = this.mascara.getContext("2d")!;
    const d = this.deformacion.getContext("2d")!;
    const caras = this.aplanado.caras;
    m.fillStyle = "#fff";
    for (let f = 0; f < caras.length / 3; f++) {
      const t = new Path2D();
      const [a, b, c] = [caras[3 * f], caras[3 * f + 1], caras[3 * f + 2]].map((v) => this.aLienzo(v));
      t.moveTo(...a);
      t.lineTo(...b);
      t.lineTo(...c);
      t.closePath();
      m.fill(t);
      m.stroke(t); // cubre las rendijas de antialiasing entre triángulos
      d.fillStyle = colorDeDeformacion(this.errorPorCara[f]);
      d.fill(t);
      d.strokeStyle = d.fillStyle;
      d.stroke(t);
    }
  }

  /**
   * Aristas de borde de la malla cortada. Una arista de la malla original que aparece dos
   * veces como borde es costura: un lado de cada aparición se une con el otro en la piel.
   * Para cada pareja se guarda la transformación del lienzo que lleva un lado al otro.
   */
  private trazarContorno(): void {
    const { caras, origen } = this.aplanado;
    // Arista de borde → triángulo que la contiene (y vértice opuesto, para saber hacia dónde queda dentro).
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
    // Normal hacia fuera de la zona: perpendicular a la arista, en el sentido contrario al vértice opuesto.
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

  /**
   * Costuras que tocan el segmento p → q con un trazo de grosor `ancho`: su transformación
   * lleva el trazo al otro lado del corte (RF-36). Alcance de 1 cm más allá del borde.
   */
  costurasCerca(p: [number, number], q: [number, number], ancho: number): DOMMatrix[] {
    const alcance = ancho / 2 + this.pxPorCm;
    return this.costuras
      .filter((c) => distanciaEntreSegmentos(p, q, c.desde.a, c.desde.b) <= alcance)
      .map((c) => c.matriz);
  }

  /**
   * Franja de referencia (RF-37): junto a cada costura, lo que hay dibujado al otro lado,
   * en una banda de 1,5 cm por fuera del borde. Se recalcula al terminar cada trazo.
   */
  actualizarFantasma(): void {
    const ctx = this.fantasma.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.ancho, this.alto);
    const banda = 1.5 * this.pxPorCm;
    for (const c of this.costuras) {
      const { a, b, fuera } = c.desde;
      ctx.save();
      const franja = new Path2D();
      franja.moveTo(...a);
      franja.lineTo(...b);
      franja.lineTo(b[0] + fuera[0] * banda, b[1] + fuera[1] * banda);
      franja.lineTo(a[0] + fuera[0] * banda, a[1] + fuera[1] * banda);
      franja.closePath();
      ctx.clip(franja);
      // Lo que está al otro lado se trae con la transformación inversa.
      const inversa = c.matriz.inverse();
      ctx.setTransform(inversa);
      ctx.drawImage(this.dibujo, 0, 0);
      ctx.restore();
    }
    // Fuera de la zona solamente: dentro ya se ve el dibujo real.
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(this.mascara, 0, 0);
    ctx.globalCompositeOperation = "source-over";
  }
}

interface LadoDeCostura {
  a: [number, number];
  b: [number, number];
  /** Normal unitaria hacia fuera de la zona. */
  fuera: [number, number];
}

interface Costura {
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

function distanciaPuntoSegmento(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function distanciaEntreSegmentos(p: [number, number], q: [number, number], a: [number, number], b: [number, number]): number {
  return Math.min(
    distanciaPuntoSegmento(p, a, b),
    distanciaPuntoSegmento(q, a, b),
    distanciaPuntoSegmento(a, p, q),
    distanciaPuntoSegmento(b, p, q),
  );
}

/** ≤ 2 %: sin color · 2–5 %: ámbar · > 5 %: rojo. */
function colorDeDeformacion(error: number): string {
  if (error <= 0.02) return "rgba(0, 0, 0, 0)";
  if (error <= 0.05) return "rgba(230, 160, 40, 0.35)";
  return "rgba(220, 60, 50, 0.45)";
}

/** Zona activa compartida. Al cambiar se emite «dermap:zona» en document. */
export const estado: { zona: ZonaActiva | null } = { zona: null };

export function activarZona(zona: ZonaActiva): void {
  estado.zona = zona;
  document.dispatchEvent(new Event("dermap:zona"));
}
