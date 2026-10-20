import type { IContentRenderer } from "dockview-core";
import { estado, type ZonaActiva } from "../zona";

/**
 * Editor de lienzo del prototipo: muestra la zona aplanada (contorno, costura,
 * cuadrícula de 1 cm y mapa de deformación) y permite dibujar con presión.
 * Cada trazo se refleja en el visor 3D. El motor definitivo (WebGL, capas, teselas)
 * llega con las pruebas P2 y P3.
 */
export class Lienzo implements IContentRenderer {
  readonly element: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private aviso: HTMLElement;
  private observador: ResizeObserver;
  private ultimo: { x: number; y: number } | null = null;
  private verDeformacion = false;
  /** Transformación de la vista: pantalla = lienzo · escala + desplazamiento. */
  private vista = { escala: 1, x: 0, y: 0 };
  private alCambiarZona = () => this.ajustarVista();
  private alCambiarTextura = () => this.pintar();

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "panel panel-lienzo";

    const barra = document.createElement("div");
    barra.className = "herramientas";
    barra.append(
      this.interruptor("Cuadrícula", true, (activo) => {
        if (!estado.zona) return;
        estado.zona.cuadricula = activo;
        estado.zona.componer();
      }),
      this.interruptor("Deformación", false, (activo) => {
        this.verDeformacion = activo;
        this.pintar();
      }),
      this.boton("Borrar dibujo", () => estado.zona?.borrar()),
    );

    this.canvas = document.createElement("canvas");
    this.canvas.style.touchAction = "none";
    this.ctx = this.canvas.getContext("2d")!;

    this.aviso = document.createElement("div");
    this.aviso.className = "aviso centrado";
    this.aviso.textContent = "Aplana una zona desde el visor 3D para empezar a dibujar.";

    const leyenda = document.createElement("div");
    leyenda.className = "etiqueta-flotante";
    leyenda.textContent = "Cuadrícula de 1 cm · línea roja: costura del corte";

    this.element.append(barra, this.canvas, this.aviso, leyenda);

    this.canvas.addEventListener("pointerdown", (e) => this.empezar(e));
    this.canvas.addEventListener("pointermove", (e) => this.mover(e));
    this.canvas.addEventListener("pointerup", () => (this.ultimo = null));
    this.canvas.addEventListener("pointercancel", () => (this.ultimo = null));
    document.addEventListener("dermap:zona", this.alCambiarZona);
    document.addEventListener("dermap:textura", this.alCambiarTextura);

    this.observador = new ResizeObserver(() => this.ajustarVista());
    this.observador.observe(this.element);
  }

  init(): void {}

  dispose(): void {
    this.observador.disconnect();
    document.removeEventListener("dermap:zona", this.alCambiarZona);
    document.removeEventListener("dermap:textura", this.alCambiarTextura);
  }

  private ajustarVista(): void {
    const ancho = this.canvas.clientWidth;
    const alto = this.canvas.clientHeight;
    if (ancho === 0 || alto === 0) return;
    const dpr = window.devicePixelRatio;
    this.canvas.width = Math.round(ancho * dpr);
    this.canvas.height = Math.round(alto * dpr);
    const zona = estado.zona;
    this.aviso.hidden = zona !== null;
    if (zona) {
      const escala = Math.min(this.canvas.width / zona.ancho, this.canvas.height / zona.alto) * 0.94;
      this.vista = {
        escala,
        x: (this.canvas.width - zona.ancho * escala) / 2,
        y: (this.canvas.height - zona.alto * escala) / 2,
      };
    }
    this.pintar();
  }

  private pintar(): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#2a2d33";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const zona = estado.zona;
    if (!zona) return;

    const { escala, x, y } = this.vista;
    ctx.setTransform(escala, 0, 0, escala, x, y);
    ctx.imageSmoothingQuality = "high";
    // Papel dentro de la zona, cuadrícula y tinta; todo recortado por la máscara.
    const capa = this.papel(zona);
    ctx.drawImage(capa, 0, 0);
    if (this.verDeformacion) ctx.drawImage(zona.deformacion, 0, 0);

    ctx.lineWidth = 1.5 / escala;
    ctx.strokeStyle = "#8a8f98";
    ctx.stroke(zona.contorno);
    ctx.strokeStyle = "#e0483e";
    ctx.lineWidth = 2.5 / escala;
    ctx.stroke(zona.costura);
  }

  private cachePapel: { zona: ZonaActiva; canvas: HTMLCanvasElement } | null = null;

  private papel(zona: ZonaActiva): HTMLCanvasElement {
    if (this.cachePapel?.zona !== zona) {
      const c = Object.assign(document.createElement("canvas"), { width: zona.ancho, height: zona.alto });
      this.cachePapel = { zona, canvas: c };
    }
    const c = this.cachePapel.canvas;
    const ctx = c.getContext("2d")!;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#f4efe9";
    ctx.fillRect(0, 0, c.width, c.height);
    if (zona.cuadricula) zona.pintarCuadricula(ctx, "rgba(120, 110, 100, 0.18)", "rgba(120, 110, 100, 0.35)");
    ctx.drawImage(zona.dibujo, 0, 0);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(zona.mascara, 0, 0);
    return c;
  }

  private empezar(e: PointerEvent): void {
    if (!estado.zona) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.ultimo = this.aLienzo(e);
  }

  private mover(e: PointerEvent): void {
    const zona = estado.zona;
    if (!this.ultimo || !zona) return;
    const ctx = zona.dibujo.getContext("2d")!;
    ctx.strokeStyle = "#1d1b1a";
    ctx.lineCap = "round";
    // getCoalescedEvents da todos los puntos del lápiz entre fotogramas: trazos más suaves.
    for (const ev of e.getCoalescedEvents?.() ?? [e]) {
      const p = this.aLienzo(ev);
      // El ratón informa presión 0,5 con el botón pulsado; el lápiz, la real.
      const presion = ev.pointerType === "mouse" ? 0.5 : ev.pressure;
      ctx.lineWidth = (0.05 + presion * 0.25) * zona.pxPorCm; // de 0,5 a 3 mm
      ctx.beginPath();
      ctx.moveTo(this.ultimo.x, this.ultimo.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      this.ultimo = p;
    }
    zona.componer(); // actualiza la textura del 3D y repinta este panel
  }

  private aLienzo(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio;
    const { escala, x, y } = this.vista;
    return { x: ((e.clientX - r.left) * dpr - x) / escala, y: ((e.clientY - r.top) * dpr - y) / escala };
  }

  private interruptor(texto: string, inicial: boolean, alCambiar: (activo: boolean) => void): HTMLElement {
    const etiqueta = document.createElement("label");
    etiqueta.className = "interruptor";
    const casilla = document.createElement("input");
    casilla.type = "checkbox";
    casilla.checked = inicial;
    casilla.addEventListener("change", () => alCambiar(casilla.checked));
    etiqueta.append(casilla, ` ${texto}`);
    return etiqueta;
  }

  private boton(texto: string, alPulsar: () => void): HTMLElement {
    const b = document.createElement("button");
    b.className = "boton-texto";
    b.textContent = texto;
    b.addEventListener("click", alPulsar);
    return b;
  }
}
