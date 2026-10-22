import type { Aplanado, Malla } from "../geometria/aplanador";
import { DocumentoLienzo } from "./documento";
import { GeometriaZona, PX_POR_MM } from "./geometria-zona";
import { Historial } from "./historial";
import type { AjustesPincel } from "./pincel";
import {
  ampliar,
  contexto,
  crearLamina,
  entero,
  esVacio,
  intersecar,
  RegionSucia,
  type Contexto2D,
  type Lamina,
  type Rect,
} from "./teselas";

/** Datos de la zona del cuerpo de la que sale el lienzo (se guardan con el proyecto). */
export interface Zona {
  malla: Malla;
  aplanado: Aplanado;
  errorPorCara: Float64Array;
  /** Triángulos de la malla base que forman la zona (RF-29: fija al crear el lienzo). */
  triangulos: Int32Array;
  /** Vértice de la malla base de cada vértice de `malla`. */
  verticeBase: Int32Array;
}

/**
 * Un lienzo: una zona aplanada del cuerpo con su documento de capas, su historial y su
 * vista previa (la textura que ve el visor 3D).
 *
 * Eventos:
 *  - «previa» (detail: Rect en px de la vista previa): cambió esa región de `textura`.
 *  - «capas»: cambió la lista o las propiedades de las capas.
 *  - «historial»: cambió lo que se puede deshacer o rehacer.
 *  - «propiedades»: cambió el nombre, la visibilidad o la cuadrícula.
 */
export class Lienzo extends EventTarget {
  readonly geo: GeometriaZona;
  readonly doc: DocumentoLienzo;
  readonly historial = new Historial();
  /** Tinta compuesta (todas las capas visibles) a la escala de la vista previa, fondo transparente. */
  readonly tinta: Lamina;
  /** Piel + cuadrícula + tinta multiplicada: la textura del visor 3D. */
  readonly textura: Lamina;
  /** Lo dibujado al otro lado de cada costura, en la banda exterior (RF-37). */
  readonly fantasma: Lamina;

  visible = true;
  cuadricula = true;
  tonoPiel = "#d8a98a";
  /** Cambios sin guardar en la estructura o los metadatos (los píxeles van por capa.sucias). */
  modificado = false;

  private pendiente = new RegionSucia();
  private programado = false;

  constructor(
    readonly id: string,
    public nombre: string,
    readonly zona: Zona,
    doc?: DocumentoLienzo,
  ) {
    super();
    this.geo = new GeometriaZona(zona.malla, zona.aplanado, zona.errorPorCara);
    this.doc = doc ?? new DocumentoLienzo(this.geo.ancho, this.geo.alto, PX_POR_MM);
    this.tinta = crearLamina(this.geo.anchoPrevia, this.geo.altoPrevia);
    this.textura = crearLamina(this.geo.anchoPrevia, this.geo.altoPrevia);
    this.fantasma = crearLamina(this.geo.anchoPrevia, this.geo.altoPrevia);

    this.doc.addEventListener("cambio", (e) => this.marcar((e as CustomEvent<Rect>).detail));
    this.doc.addEventListener("capas", () => {
      this.modificado = true;
      this.dispatchEvent(new Event("capas"));
    });
    this.historial.addEventListener("cambio", () => this.dispatchEvent(new Event("historial")));
    this.componerPrevia({ x0: 0, y0: 0, x1: this.geo.ancho, y1: this.geo.alto });
  }

  // ── Dibujo ────────────────────────────────────────────────────────────────────

  empezarTrazo(ajustes: AjustesPincel, x: number, y: number, presion: number): boolean {
    const trazo = this.doc.empezarTrazo(ajustes);
    if (!trazo) return false;
    for (const r of trazo.añadir(x, y, presion, (a, b, w) => this.geo.costurasCerca(a, b, w))) this.doc.avisar(r);
    return true;
  }

  continuarTrazo(x: number, y: number, presion: number): void {
    const trazo = this.doc.trazo;
    if (!trazo) return;
    for (const r of trazo.añadir(x, y, presion, (a, b, w) => this.geo.costurasCerca(a, b, w))) this.doc.avisar(r);
  }

  terminarTrazo(): void {
    const paso = this.doc.terminarTrazo();
    if (paso) this.historial.registrar(paso);
    this.actualizarFantasma();
  }

  async deshacer(): Promise<void> {
    if (this.doc.trazo) return;
    await this.historial.deshacer();
    this.actualizarFantasma();
  }

  async rehacer(): Promise<void> {
    if (this.doc.trazo) return;
    await this.historial.rehacer();
    this.actualizarFantasma();
  }

  /** Cambia propiedades del lienzo que no son píxeles (nombre, visibilidad, cuadrícula). */
  cambiar(cambios: Partial<Pick<Lienzo, "nombre" | "visible" | "cuadricula" | "tonoPiel">>): void {
    Object.assign(this, cambios);
    this.modificado = true;
    if ("cuadricula" in cambios || "tonoPiel" in cambios) this.componerPrevia(this.rectCompleto());
    this.dispatchEvent(new Event("propiedades"));
  }

  rectCompleto(): Rect {
    return { x0: 0, y0: 0, x1: this.geo.ancho, y1: this.geo.alto };
  }

  // ── Vista previa ──────────────────────────────────────────────────────────────

  /** Acumula la región cambiada y la recompone como mucho una vez por fotograma. */
  private marcar(rect: Rect): void {
    this.pendiente.añadir(rect);
    if (this.programado) return;
    this.programado = true;
    const vaciar = () => {
      this.programado = false;
      for (const r of this.pendiente.vaciar()) this.componerPrevia(r);
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(vaciar);
    else setTimeout(vaciar, 16);
  }

  /** Recompone ya, sin esperar al siguiente fotograma (exportaciones y pruebas). */
  vaciarPendiente(): void {
    for (const r of this.pendiente.vaciar()) this.componerPrevia(r);
  }

  /** Recompone la tinta y la textura de la vista previa en una región del documento. */
  componerPrevia(rectDoc: Rect): void {
    const s = this.geo.escalaPrevia;
    const previa = intersecar(entero(ampliar({ x0: rectDoc.x0 * s, y0: rectDoc.y0 * s, x1: rectDoc.x1 * s, y1: rectDoc.y1 * s }, 2)), {
      x0: 0,
      y0: 0,
      x1: this.geo.anchoPrevia,
      y1: this.geo.altoPrevia,
    });
    if (esVacio(previa)) return;
    const ancho = previa.x1 - previa.x0;
    const alto = previa.y1 - previa.y0;

    const t = contexto(this.tinta);
    t.save();
    t.beginPath();
    t.rect(previa.x0, previa.y0, ancho, alto);
    t.clip();
    t.clearRect(previa.x0, previa.y0, ancho, alto);
    t.setTransform(s, 0, 0, s, 0, 0);
    t.imageSmoothingQuality = "high";
    this.doc.componer(t, { x0: previa.x0 / s, y0: previa.y0 / s, x1: previa.x1 / s, y1: previa.y1 / s });
    t.restore();

    const x = contexto(this.textura);
    x.save();
    x.beginPath();
    x.rect(previa.x0, previa.y0, ancho, alto);
    x.clip();
    x.fillStyle = this.tonoPiel;
    x.fillRect(previa.x0, previa.y0, ancho, alto);
    if (this.cuadricula) this.pintarCuadricula(x, s, "rgba(60, 40, 30, 0.22)", "rgba(60, 40, 30, 0.4)", previa);
    // La tinta se multiplica con la piel: aproximación a la tinta bajo la piel (RF-45).
    x.globalCompositeOperation = "multiply";
    x.drawImage(this.tinta, previa.x0, previa.y0, ancho, alto, previa.x0, previa.y0, ancho, alto);
    x.restore();

    this.dispatchEvent(new CustomEvent<Rect>("previa", { detail: previa }));
  }

  /**
   * Cuadrícula de 1 cm (más marcada cada 5 cm) sobre el lienzo, en un contexto cuya escala
   * respecto al documento es `escala`. Solo dibuja dentro de `region` (coordenadas del contexto).
   */
  pintarCuadricula(ctx: Contexto2D, escala: number, fina: string, gruesa: string, region?: Rect, grosor = 1): void {
    const paso = this.geo.pxPorCm * escala;
    const m = this.geo.margen * escala;
    const ancho = this.geo.ancho * escala;
    const alto = this.geo.alto * escala;
    const r = region ?? { x0: 0, y0: 0, x1: ancho, y1: alto };
    const i0 = Math.max(0, Math.floor((r.x0 - m) / paso));
    const i1 = Math.ceil((r.x1 - m) / paso);
    const j0 = Math.max(0, Math.floor((r.y0 - m) / paso));
    const j1 = Math.ceil((r.y1 - m) / paso);
    for (let i = i0; i <= i1; i++) {
      ctx.fillStyle = i % 5 === 0 ? gruesa : fina;
      ctx.fillRect(grosor === 1 ? Math.round(m + i * paso) : m + i * paso, r.y0, (i % 5 === 0 ? 2 : 1) * grosor, r.y1 - r.y0);
    }
    for (let j = j0; j <= j1; j++) {
      ctx.fillStyle = j % 5 === 0 ? gruesa : fina;
      ctx.fillRect(r.x0, grosor === 1 ? Math.round(m + j * paso) : m + j * paso, r.x1 - r.x0, (j % 5 === 0 ? 2 : 1) * grosor);
    }
  }

  /**
   * Franja de referencia (RF-37): junto a cada costura, lo dibujado al otro lado, en una banda
   * de 1,5 cm por fuera del borde. A la escala de la vista previa; se recalcula al terminar trazos.
   */
  actualizarFantasma(): void {
    this.vaciarPendiente();
    const ctx = contexto(this.fantasma);
    const s = this.geo.escalaPrevia;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.geo.anchoPrevia, this.geo.altoPrevia);
    const banda = 1.5 * this.geo.pxPorCm;
    for (const c of this.geo.ladosDeCostura) {
      const { a, b, fuera } = c.desde;
      ctx.save();
      ctx.setTransform(s, 0, 0, s, 0, 0);
      const franja = new Path2D();
      franja.moveTo(...a);
      franja.lineTo(...b);
      franja.lineTo(b[0] + fuera[0] * banda, b[1] + fuera[1] * banda);
      franja.lineTo(a[0] + fuera[0] * banda, a[1] + fuera[1] * banda);
      franja.closePath();
      ctx.clip(franja);
      // Lo que está al otro lado se trae con la transformación inversa (en coordenadas de documento).
      ctx.setTransform(new DOMMatrix([s, 0, 0, s, 0, 0]).multiply(c.matriz.inverse()).scale(1 / s));
      ctx.drawImage(this.tinta, 0, 0);
      ctx.restore();
    }
    // Solo fuera de la zona: dentro ya se ve el dibujo real.
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(this.geo.mascara, 0, 0);
    ctx.globalCompositeOperation = "source-over";
  }
}
