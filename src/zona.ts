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
    this.componer();
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

  /** Aristas de borde (con un solo triángulo). Las que pasan por el corte son costura. */
  private trazarContorno(): void {
    const { caras, origen, corte } = this.aplanado;
    const usos = new Map<string, number>();
    const clave = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
    for (let f = 0; f < caras.length / 3; f++)
      for (let j = 0; j < 3; j++) {
        const k = clave(caras[3 * f + j], caras[3 * f + ((j + 1) % 3)]);
        usos.set(k, (usos.get(k) ?? 0) + 1);
      }
    const enCorte = new Set(corte);
    for (const [k, n] of usos) {
      if (n !== 1) continue;
      const [a, b] = k.split(",").map(Number);
      const destino = enCorte.has(origen[a]) && enCorte.has(origen[b]) ? this.costura : this.contorno;
      destino.moveTo(...this.aLienzo(a));
      destino.lineTo(...this.aLienzo(b));
    }
  }
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
