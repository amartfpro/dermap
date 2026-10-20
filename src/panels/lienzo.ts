import type { IContentRenderer } from "dockview-core";

/**
 * Editor de lienzo provisional: un trazo básico con presión, para comprobar que la
 * tableta llega bien a la ventana (Pointer Events). El motor real en WebGL con
 * teselas se construye en la prueba P2/P3 del prototipo.
 */
export class Lienzo implements IContentRenderer {
  readonly element: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private observador: ResizeObserver;
  private ultimo: { x: number; y: number } | null = null;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "panel";

    this.canvas = document.createElement("canvas");
    this.canvas.style.touchAction = "none";
    this.element.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;

    const etiqueta = document.createElement("div");
    etiqueta.className = "etiqueta-flotante";
    etiqueta.textContent = "Lienzo de prueba · dibuja con ratón o lápiz (presión activa)";
    this.element.appendChild(etiqueta);

    this.canvas.addEventListener("pointerdown", (e) => this.empezar(e));
    this.canvas.addEventListener("pointermove", (e) => this.mover(e));
    this.canvas.addEventListener("pointerup", () => (this.ultimo = null));
    this.canvas.addEventListener("pointercancel", () => (this.ultimo = null));

    this.observador = new ResizeObserver(() => this.ajustarTamano());
    this.observador.observe(this.element);
  }

  init(): void {}

  dispose(): void {
    this.observador.disconnect();
  }

  private empezar(e: PointerEvent): void {
    this.canvas.setPointerCapture(e.pointerId);
    this.ultimo = this.posicion(e);
  }

  private mover(e: PointerEvent): void {
    if (!this.ultimo) return;
    // getCoalescedEvents da todos los puntos del lápiz entre fotogramas: trazos más suaves.
    const eventos = e.getCoalescedEvents?.() ?? [e];
    for (const ev of eventos) {
      const p = this.posicion(ev);
      // El ratón informa presión 0,5 mientras hay botón pulsado; el lápiz, la real.
      const presion = ev.pointerType === "mouse" ? 0.5 : ev.pressure;
      this.ctx.lineWidth = 1 + presion * 8 * window.devicePixelRatio;
      this.ctx.beginPath();
      this.ctx.moveTo(this.ultimo.x, this.ultimo.y);
      this.ctx.lineTo(p.x, p.y);
      this.ctx.stroke();
      this.ultimo = p;
    }
  }

  private posicion(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    const escala = window.devicePixelRatio;
    return { x: (e.clientX - r.left) * escala, y: (e.clientY - r.top) * escala };
  }

  private ajustarTamano(): void {
    const { clientWidth: ancho, clientHeight: alto } = this.element;
    if (ancho === 0 || alto === 0) return;
    // Conserva el dibujo al redimensionar el panel.
    const copia = document.createElement("canvas");
    copia.width = this.canvas.width;
    copia.height = this.canvas.height;
    if (copia.width && copia.height) copia.getContext("2d")!.drawImage(this.canvas, 0, 0);

    this.canvas.width = Math.round(ancho * window.devicePixelRatio);
    this.canvas.height = Math.round(alto * window.devicePixelRatio);
    this.ctx.fillStyle = "#f4efe9";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (copia.width && copia.height) this.ctx.drawImage(copia, 0, 0);
    this.ctx.strokeStyle = "#1d1b1a";
    this.ctx.lineCap = "round";
  }
}
