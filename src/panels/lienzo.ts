import type { IContentRenderer } from "dockview-core";
import { app } from "../estado";
import { PX_POR_MM } from "../lienzo/geometria-zona";
import { ImagenFlotante } from "../lienzo/imagen";
import type { Lienzo } from "../lienzo/lienzo";
import type { Rect } from "../lienzo/teselas";

type P = { x: number; y: number };
type Arrastre =
  | { tipo: "dibujo" }
  | { tipo: "desplazar"; inicio: P; vista: DOMMatrix }
  | { tipo: "girar"; centro: P; angulo0: number; vista: DOMMatrix }
  | { tipo: "imagen-mover"; ultimo: P }
  | { tipo: "imagen-escalar"; distancia0: number; matriz0: DOMMatrix }
  | { tipo: "imagen-girar"; angulo0: number; matriz0: DOMMatrix };

const COLOR_PAPEL = "#f4efe9";

/**
 * Editor del lienzo activo: herramientas, navegación (zoom, desplazamiento y giro, RF-44),
 * dibujo con presión y colocación de imágenes importadas (RF-33).
 *
 *  - Lápiz o botón izquierdo: dibujar.
 *  - Botón central, o Espacio + arrastrar: desplazar. Rueda: zoom. Mayús + rueda o R + arrastrar: girar.
 *  - B pincel · E goma · [ ] tamaño · Ctrl+Z deshacer · Ctrl+Mayús+Z o Ctrl+Y rehacer · 0 encajar.
 */
export class PanelLienzo implements IContentRenderer {
  readonly element: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private aviso: HTMLElement;
  private info: HTMLElement;
  private barra: HTMLElement;
  private barraImagen: HTMLElement;
  private observador: ResizeObserver;

  private lienzo: Lienzo | null = null;
  /** Documento → píxeles del canvas. */
  private vista = new DOMMatrix();
  private arrastre: Arrastre | null = null;
  private puntero: P | null = null;
  private espacio = false;
  private teclaR = false;
  private verDeformacion = false;
  private flotante: ImagenFlotante | null = null;
  private repintar = false;

  private controles: Record<string, HTMLInputElement | HTMLButtonElement> = {};

  private alCambiarActivo = () => this.mostrar(app.activo);
  private alCambiarAjustes = () => this.sincronizarControles();
  private alCambiarPrevia = () => this.pedirRepintado();
  private alCambiarHistorial = () => this.sincronizarControles();
  private alTeclaAbajo = (e: KeyboardEvent) => this.teclaAbajo(e);
  private alTeclaArriba = (e: KeyboardEvent) => this.teclaArriba(e);

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "panel panel-lienzo";
    this.element.tabIndex = -1;

    this.barra = document.createElement("div");
    this.barra.className = "herramientas envolver";
    this.montarHerramientas();

    this.barraImagen = document.createElement("div");
    this.barraImagen.className = "herramientas aviso-imagen";
    this.barraImagen.hidden = true;
    const textoImagen = document.createElement("span");
    textoImagen.textContent = "Coloca la imagen: arrastra para mover, esquinas para escalar, punto superior para girar.";
    this.barraImagen.append(
      textoImagen,
      boton("Aplicar (Intro)", () => this.fijarImagen(), "primario"),
      boton("Cancelar (Esc)", () => this.cancelarImagen()),
    );

    this.canvas = document.createElement("canvas");
    this.canvas.style.touchAction = "none";
    this.ctx = this.canvas.getContext("2d")!;

    this.aviso = document.createElement("div");
    this.aviso.className = "aviso centrado";
    this.aviso.textContent = "Aplana una zona desde el visor 3D, o abre un lienzo del proyecto, para empezar a dibujar.";

    this.info = document.createElement("div");
    this.info.className = "etiqueta-flotante";

    this.element.append(this.barra, this.barraImagen, this.canvas, this.aviso, this.info);

    this.canvas.addEventListener("pointerdown", (e) => this.punteroAbajo(e));
    this.canvas.addEventListener("pointermove", (e) => this.punteroMovido(e));
    this.canvas.addEventListener("pointerup", (e) => this.punteroArriba(e));
    this.canvas.addEventListener("pointercancel", (e) => this.punteroArriba(e));
    this.canvas.addEventListener("pointerleave", () => {
      this.puntero = null;
      this.pedirRepintado();
    });
    this.canvas.addEventListener("wheel", (e) => this.rueda(e), { passive: false });
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    app.addEventListener("activo", this.alCambiarActivo);
    app.addEventListener("ajustes", this.alCambiarAjustes);
    window.addEventListener("keydown", this.alTeclaAbajo);
    window.addEventListener("keyup", this.alTeclaArriba);

    this.observador = new ResizeObserver(() => this.redimensionar());
    this.observador.observe(this.element);
    instancias.push(this);
    this.mostrar(app.activo);
  }

  init(): void {}

  dispose(): void {
    this.observador.disconnect();
    app.removeEventListener("activo", this.alCambiarActivo);
    app.removeEventListener("ajustes", this.alCambiarAjustes);
    window.removeEventListener("keydown", this.alTeclaAbajo);
    window.removeEventListener("keyup", this.alTeclaArriba);
    this.desconectar();
    instancias.splice(instancias.indexOf(this), 1);
  }

  // ── Lienzo mostrado ───────────────────────────────────────────────────────────

  private mostrar(lienzo: Lienzo | null): void {
    if (lienzo === this.lienzo) return;
    this.cancelarImagen();
    this.desconectar();
    this.lienzo = lienzo;
    if (lienzo) {
      lienzo.addEventListener("previa", this.alCambiarPrevia);
      lienzo.addEventListener("propiedades", this.alCambiarPrevia);
      lienzo.addEventListener("historial", this.alCambiarHistorial);
    }
    this.aviso.hidden = lienzo !== null;
    this.encajar();
    this.sincronizarControles();
  }

  private desconectar(): void {
    if (!this.lienzo) return;
    this.lienzo.removeEventListener("previa", this.alCambiarPrevia);
    this.lienzo.removeEventListener("propiedades", this.alCambiarPrevia);
    this.lienzo.removeEventListener("historial", this.alCambiarHistorial);
  }

  // ── Herramientas ──────────────────────────────────────────────────────────────

  private montarHerramientas(): void {
    const a = app.ajustes;
    const pincel = boton("Pincel", () => app.cambiarAjustes({ herramienta: "pincel" }));
    pincel.title = "Pincel (B)";
    const goma = boton("Goma", () => app.cambiarAjustes({ herramienta: "goma" }));
    goma.title = "Goma (E)";

    const color = document.createElement("input");
    color.type = "color";
    color.value = a.color;
    color.title = "Color";
    color.className = "selector-color";
    color.addEventListener("input", () => app.cambiarAjustes({ color: color.value }));

    // Tamaño en escala logarítmica: de 0,2 a 40 mm.
    const tamano = deslizador(0, 1000, tamanoADeslizador(a.tamano), "Tamaño ([ y ])");
    tamano.addEventListener("input", () => app.cambiarAjustes({ tamano: deslizadorATamano(Number(tamano.value)) }));
    const opacidad = deslizador(1, 100, a.opacidad * 100, "Opacidad del trazo");
    opacidad.addEventListener("input", () => app.cambiarAjustes({ opacidad: Number(opacidad.value) / 100 }));
    const dureza = deslizador(0, 100, a.dureza * 100, "Dureza del borde: alta para líneas, baja para sombreado");
    dureza.addEventListener("input", () => app.cambiarAjustes({ dureza: Number(dureza.value) / 100 }));
    const presion = casilla("Presión → intensidad", a.presionOpacidad, (v) => app.cambiarAjustes({ presionOpacidad: v }));
    presion.title = "Con el lápiz, la presión también controla la intensidad (útil para sombrear)";

    const deshacer = boton("↶", () => void this.lienzo?.deshacer());
    deshacer.title = "Deshacer (Ctrl+Z)";
    const rehacer = boton("↷", () => void this.lienzo?.rehacer());
    rehacer.title = "Rehacer (Ctrl+Mayús+Z)";

    const cuadricula = casilla("Cuadrícula", true, (v) => this.lienzo?.cambiar({ cuadricula: v }));
    const deformacion = casilla("Deformación", false, (v) => {
      this.verDeformacion = v;
      this.pedirRepintado();
    });
    const encajar = boton("Encajar", () => this.encajar());
    encajar.title = "Ver el lienzo entero (0)";

    this.controles = {
      pincel,
      goma,
      color,
      tamano,
      opacidad,
      dureza,
      deshacer,
      rehacer,
      cuadricula: cuadricula.querySelector("input")!,
      presion: presion.querySelector("input")!,
    };
    this.barra.append(
      grupo(pincel, goma, color),
      grupo(etiqueta("Tamaño", tamano), etiqueta("Opacidad", opacidad), etiqueta("Dureza", dureza), presion),
      grupo(deshacer, rehacer),
      grupo(cuadricula, deformacion, encajar),
    );
  }

  private sincronizarControles(): void {
    const a = app.ajustes;
    this.controles.pincel.classList.toggle("activo", a.herramienta === "pincel");
    this.controles.goma.classList.toggle("activo", a.herramienta === "goma");
    (this.controles.color as HTMLInputElement).value = a.color;
    (this.controles.tamano as HTMLInputElement).value = String(tamanoADeslizador(a.tamano));
    (this.controles.opacidad as HTMLInputElement).value = String(Math.round(a.opacidad * 100));
    (this.controles.dureza as HTMLInputElement).value = String(Math.round(a.dureza * 100));
    (this.controles.presion as HTMLInputElement).checked = a.presionOpacidad;
    (this.controles.deshacer as HTMLButtonElement).disabled = !this.lienzo?.historial.puedeDeshacer;
    (this.controles.rehacer as HTMLButtonElement).disabled = !this.lienzo?.historial.puedeRehacer;
    if (this.lienzo) (this.controles.cuadricula as HTMLInputElement).checked = this.lienzo.cuadricula;
    this.actualizarInfo();
    this.pedirRepintado();
  }

  private actualizarInfo(): void {
    if (!this.lienzo) {
      this.info.textContent = "";
      return;
    }
    const [w, h] = this.lienzo.geo.tamanoCm;
    const a = app.ajustes;
    const capa = this.lienzo.doc.activa;
    const bloqueo = capa.bloqueada ? " (bloqueada)" : !capa.visible ? " (oculta)" : "";
    this.info.textContent =
      `${this.lienzo.nombre} · ${w.toFixed(1)} × ${h.toFixed(1)} cm · capa «${capa.nombre}»${bloqueo} · ` +
      `${a.herramienta === "goma" ? "goma" : "pincel"} ${a.tamano < 1 ? a.tamano.toFixed(2) : a.tamano.toFixed(1)} mm · ` +
      `zoom ${Math.round((this.escalaVista() / window.devicePixelRatio) * 100)} %`;
  }

  // ── Vista ─────────────────────────────────────────────────────────────────────

  private redimensionar(): void {
    const dpr = window.devicePixelRatio;
    const ancho = Math.round(this.canvas.clientWidth * dpr);
    const alto = Math.round(this.canvas.clientHeight * dpr);
    if (ancho === 0 || alto === 0) return;
    const nuevo = this.canvas.width === 0;
    this.canvas.width = ancho;
    this.canvas.height = alto;
    if (nuevo) this.encajar();
    this.pedirRepintado();
  }

  private encajar(): void {
    const l = this.lienzo;
    if (!l || this.canvas.width === 0) return;
    const escala = Math.min(this.canvas.width / l.geo.ancho, this.canvas.height / l.geo.alto) * 0.94;
    this.vista = new DOMMatrix()
      .translate((this.canvas.width - l.geo.ancho * escala) / 2, (this.canvas.height - l.geo.alto * escala) / 2)
      .scale(escala);
    this.actualizarInfo();
    this.pedirRepintado();
  }

  /** Píxeles de pantalla por píxel del documento. */
  private escalaVista(): number {
    return Math.hypot(this.vista.a, this.vista.b);
  }

  private aDocumento(e: { clientX: number; clientY: number }): P {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio;
    const p = this.vista.inverse().transformPoint({ x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr });
    return { x: p.x, y: p.y };
  }

  private aCanvas(e: { clientX: number; clientY: number }): P {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio;
    return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr };
  }

  private rueda(e: WheelEvent): void {
    if (!this.lienzo) return;
    e.preventDefault();
    const c = this.aCanvas(e);
    if (e.shiftKey || e.altKey) {
      const grados = Math.sign(e.deltaY || e.deltaX) * 5;
      this.vista = new DOMMatrix().translate(c.x, c.y).rotate(grados).translate(-c.x, -c.y).multiply(this.vista);
    } else {
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
      const escala = this.escalaVista() * factor;
      if (escala < 0.02 || escala > 16) return;
      this.vista = new DOMMatrix().translate(c.x, c.y).scale(factor).translate(-c.x, -c.y).multiply(this.vista);
    }
    this.actualizarInfo();
    this.pedirRepintado();
  }

  // ── Puntero ───────────────────────────────────────────────────────────────────

  private punteroAbajo(e: PointerEvent): void {
    const l = this.lienzo;
    if (!l) return;
    this.element.focus({ preventScroll: true });
    this.canvas.setPointerCapture(e.pointerId);
    const c = this.aCanvas(e);
    if (e.button === 1 || (e.button === 0 && this.espacio)) {
      this.arrastre = { tipo: "desplazar", inicio: c, vista: this.vista };
      return;
    }
    if (e.button === 0 && this.teclaR) {
      const r = this.canvas.getBoundingClientRect();
      const centro = { x: (r.width / 2) * window.devicePixelRatio, y: (r.height / 2) * window.devicePixelRatio };
      this.arrastre = { tipo: "girar", centro, angulo0: Math.atan2(c.y - centro.y, c.x - centro.x), vista: this.vista };
      return;
    }
    if (e.button !== 0) return;
    const d = this.aDocumento(e);
    if (this.flotante) {
      this.arrastre = this.empezarArrastreImagen(c, d);
      return;
    }
    if (l.empezarTrazo(app.ajustes, d.x, d.y, presionDe(e))) this.arrastre = { tipo: "dibujo" };
    else this.info.textContent = `La capa «${l.doc.activa.nombre}» está ${l.doc.activa.bloqueada ? "bloqueada" : "oculta"}.`;
  }

  private punteroMovido(e: PointerEvent): void {
    this.puntero = this.aCanvas(e);
    const a = this.arrastre;
    if (!a) {
      this.pedirRepintado(); // cursor del pincel
      return;
    }
    const c = this.aCanvas(e);
    switch (a.tipo) {
      case "dibujo":
        for (const ev of e.getCoalescedEvents?.() ?? [e]) {
          const d = this.aDocumento(ev);
          this.lienzo?.continuarTrazo(d.x, d.y, presionDe(ev));
        }
        break;
      case "desplazar":
        this.vista = new DOMMatrix().translate(c.x - a.inicio.x, c.y - a.inicio.y).multiply(a.vista);
        break;
      case "girar": {
        const angulo = Math.atan2(c.y - a.centro.y, c.x - a.centro.x);
        const grados = ((angulo - a.angulo0) * 180) / Math.PI;
        this.vista = new DOMMatrix().translate(a.centro.x, a.centro.y).rotate(grados).translate(-a.centro.x, -a.centro.y).multiply(a.vista);
        break;
      }
      case "imagen-mover": {
        const d = this.aDocumento(e);
        this.flotante!.mover(d.x - a.ultimo.x, d.y - a.ultimo.y);
        a.ultimo = d;
        break;
      }
      case "imagen-escalar": {
        const d = this.aDocumento(e);
        const centro = this.flotante!.centro();
        this.flotante!.matriz = a.matriz0;
        this.flotante!.escalar(Math.max(0.02, Math.hypot(d.x - centro.x, d.y - centro.y) / a.distancia0));
        break;
      }
      case "imagen-girar": {
        const d = this.aDocumento(e);
        const centro = this.flotante!.centro();
        this.flotante!.matriz = a.matriz0;
        const angulo = Math.atan2(d.y - centro.y, d.x - centro.x);
        this.flotante!.girar(((angulo - a.angulo0) * 180) / Math.PI);
        break;
      }
    }
    this.pedirRepintado();
  }

  private punteroArriba(e: PointerEvent): void {
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    const a = this.arrastre;
    this.arrastre = null;
    if (a?.tipo === "dibujo") this.lienzo?.terminarTrazo();
    if (a?.tipo === "desplazar" || a?.tipo === "girar") this.actualizarInfo();
    this.pedirRepintado();
  }

  // ── Teclado ───────────────────────────────────────────────────────────────────

  private teclaAbajo(e: KeyboardEvent): void {
    if (esCampoDeTexto(e.target)) return;
    // Solo con el ratón sobre el lienzo o el foco en él, para no robar atajos a otros paneles.
    if (!this.element.matches(":hover") && !this.element.contains(document.activeElement)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const tecla = e.key.toLowerCase();
    if (ctrl && tecla === "z") {
      e.preventDefault();
      void (e.shiftKey ? this.lienzo?.rehacer() : this.lienzo?.deshacer());
    } else if (ctrl && tecla === "y") {
      e.preventDefault();
      void this.lienzo?.rehacer();
    } else if (ctrl) {
      return;
    } else if (e.key === " ") {
      e.preventDefault();
      this.espacio = true;
      this.canvas.style.cursor = "grab";
    } else if (tecla === "r") {
      this.teclaR = true;
    } else if (tecla === "b") {
      app.cambiarAjustes({ herramienta: "pincel" });
    } else if (tecla === "e") {
      app.cambiarAjustes({ herramienta: "goma" });
    } else if (e.key === "[" || e.key === "]") {
      const factor = e.key === "]" ? 1.25 : 0.8;
      app.cambiarAjustes({ tamano: Math.min(40, Math.max(0.2, app.ajustes.tamano * factor)) });
    } else if (e.key === "0") {
      this.encajar();
    } else if (e.key === "Enter" && this.flotante) {
      this.fijarImagen();
    } else if (e.key === "Escape" && this.flotante) {
      this.cancelarImagen();
    }
  }

  private teclaArriba(e: KeyboardEvent): void {
    if (e.key === " ") {
      this.espacio = false;
      this.canvas.style.cursor = "";
    } else if (e.key.toLowerCase() === "r") {
      this.teclaR = false;
    }
  }

  // ── Imagen importada ──────────────────────────────────────────────────────────

  /** Coloca una imagen sobre el lienzo para moverla, escalarla y girarla antes de fijarla. */
  colocarImagen(imagen: ImageBitmap, nombre: string): void {
    if (!this.lienzo) return;
    this.flotante = new ImagenFlotante(imagen, nombre, this.lienzo);
    this.barraImagen.hidden = false;
    this.pedirRepintado();
  }

  private fijarImagen(): void {
    if (!this.flotante || !this.lienzo) return;
    this.flotante.fijar(this.lienzo);
    this.cancelarImagen();
  }

  private cancelarImagen(): void {
    this.flotante = null;
    this.barraImagen.hidden = true;
    this.pedirRepintado();
  }

  private manijas(): { esquinas: P[]; giro: P } {
    const esquinas = this.flotante!.esquinas().map((p) => this.vista.transformPoint(p));
    const arriba = { x: (esquinas[0].x + esquinas[1].x) / 2, y: (esquinas[0].y + esquinas[1].y) / 2 };
    const centro = this.vista.transformPoint(this.flotante!.centro());
    const dx = arriba.x - centro.x, dy = arriba.y - centro.y;
    const largo = Math.hypot(dx, dy) || 1;
    const separacion = 28 * window.devicePixelRatio;
    return { esquinas, giro: { x: arriba.x + (dx / largo) * separacion, y: arriba.y + (dy / largo) * separacion } };
  }

  private empezarArrastreImagen(c: P, d: P): Arrastre | null {
    const f = this.flotante!;
    const { esquinas, giro } = this.manijas();
    const radio = 10 * window.devicePixelRatio;
    const centro = f.centro();
    if (Math.hypot(c.x - giro.x, c.y - giro.y) < radio)
      return { tipo: "imagen-girar", angulo0: Math.atan2(d.y - centro.y, d.x - centro.x), matriz0: f.matriz };
    if (esquinas.some((p) => Math.hypot(c.x - p.x, c.y - p.y) < radio))
      return { tipo: "imagen-escalar", distancia0: Math.hypot(d.x - centro.x, d.y - centro.y) || 1, matriz0: f.matriz };
    if (f.contiene(d.x, d.y)) return { tipo: "imagen-mover", ultimo: d };
    return null;
  }

  // ── Pintado ───────────────────────────────────────────────────────────────────

  private pedirRepintado(): void {
    if (this.repintar) return;
    this.repintar = true;
    requestAnimationFrame(() => {
      this.repintar = false;
      this.pintar();
    });
  }

  /** Rectángulo del documento visible en el canvas. */
  private rectVisible(): Rect {
    const inv = this.vista.inverse();
    const esquinas = [
      inv.transformPoint({ x: 0, y: 0 }),
      inv.transformPoint({ x: this.canvas.width, y: 0 }),
      inv.transformPoint({ x: 0, y: this.canvas.height }),
      inv.transformPoint({ x: this.canvas.width, y: this.canvas.height }),
    ];
    return {
      x0: Math.min(...esquinas.map((p) => p.x)),
      y0: Math.min(...esquinas.map((p) => p.y)),
      x1: Math.max(...esquinas.map((p) => p.x)),
      y1: Math.max(...esquinas.map((p) => p.y)),
    };
  }

  private pintar(): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#2a2d33";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const l = this.lienzo;
    if (!l) return;
    const { geo } = l;
    const escala = this.escalaVista();
    const visible = this.rectVisible();

    ctx.setTransform(this.vista);
    ctx.imageSmoothingQuality = "high";

    // Papel, cuadrícula y tinta, recortados a la zona.
    ctx.save();
    ctx.clip(geo.recorte);
    ctx.fillStyle = COLOR_PAPEL;
    ctx.fillRect(0, 0, geo.ancho, geo.alto);
    if (l.cuadricula) l.pintarCuadricula(ctx, 1, "rgba(120, 110, 100, 0.18)", "rgba(120, 110, 100, 0.35)", visible, 1 / escala);
    if (escala <= geo.escalaPrevia * 1.25) {
      // De lejos basta la tinta de la vista previa (mucho más barata que las teselas).
      ctx.drawImage(l.tinta, 0, 0, geo.ancho, geo.alto);
    } else {
      l.doc.componer(ctx, visible);
    }
    ctx.restore();

    // Fuera de la zona: lo que hay al otro lado de la costura, atenuado (RF-37).
    ctx.globalAlpha = 0.4;
    ctx.drawImage(l.fantasma, 0, 0, geo.ancho, geo.alto);
    ctx.globalAlpha = 1;
    if (this.verDeformacion) ctx.drawImage(geo.deformacion, 0, 0, geo.ancho, geo.alto);

    ctx.lineWidth = 1.5 / escala;
    ctx.strokeStyle = "#8a8f98";
    ctx.stroke(geo.contorno);
    ctx.strokeStyle = "#e0483e";
    ctx.lineWidth = 2.5 / escala;
    ctx.stroke(geo.costura);

    if (this.flotante) this.pintarImagen(ctx);
    else this.pintarCursor(ctx, escala);
  }

  private pintarImagen(ctx: CanvasRenderingContext2D): void {
    const f = this.flotante!;
    ctx.save();
    ctx.setTransform(this.vista.multiply(f.matriz));
    ctx.globalAlpha = 0.85;
    ctx.drawImage(f.imagen, 0, 0);
    ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const { esquinas, giro } = this.manijas();
    const dpr = window.devicePixelRatio;
    ctx.strokeStyle = "#d9774b";
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    esquinas.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();
    const arriba = { x: (esquinas[0].x + esquinas[1].x) / 2, y: (esquinas[0].y + esquinas[1].y) / 2 };
    ctx.beginPath();
    ctx.moveTo(arriba.x, arriba.y);
    ctx.lineTo(giro.x, giro.y);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    for (const p of [...esquinas, giro]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  /** Círculo del tamaño real del pincel bajo el puntero. */
  private pintarCursor(ctx: CanvasRenderingContext2D, escala: number): void {
    if (!this.puntero || this.espacio || this.arrastre?.tipo === "desplazar") return;
    const radio = (app.ajustes.tamano * PX_POR_MM * escala) / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.lineWidth = window.devicePixelRatio;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.beginPath();
    ctx.arc(this.puntero.x, this.puntero.y, Math.max(1.5, radio), 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
    ctx.beginPath();
    ctx.arc(this.puntero.x, this.puntero.y, Math.max(1.5, radio) + window.devicePixelRatio, 0, Math.PI * 2);
    ctx.stroke();
  }
}

const instancias: PanelLienzo[] = [];

/** Panel de lienzo abierto: lo usan otros paneles (Capas) para colocar imágenes importadas. */
export function panelLienzoActual(): PanelLienzo | null {
  return instancias[instancias.length - 1] ?? null;
}

// ── Utilidades ───────────────────────────────────────────────────────────────────

/** El ratón informa 0,5 con el botón pulsado; el lápiz, la presión real (0 si no la hay). */
function presionDe(e: PointerEvent): number {
  if (e.pointerType === "mouse") return 0.5;
  return e.pressure > 0 ? e.pressure : 0.5;
}

function tamanoADeslizador(mm: number): number {
  return Math.round((Math.log(mm / 0.2) / Math.log(200)) * 1000);
}

function deslizadorATamano(v: number): number {
  return 0.2 * Math.pow(200, v / 1000);
}

function esCampoDeTexto(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) &&
    !(t instanceof HTMLInputElement && (t.type === "range" || t.type === "checkbox" || t.type === "color"));
}

export function boton(texto: string, alPulsar: () => void, clase = ""): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = `boton-texto ${clase}`.trim();
  b.textContent = texto;
  b.addEventListener("click", alPulsar);
  return b;
}

function deslizador(min: number, max: number, valor: number, titulo: string): HTMLInputElement {
  const d = document.createElement("input");
  d.type = "range";
  d.min = String(min);
  d.max = String(max);
  d.value = String(valor);
  d.title = titulo;
  d.className = "deslizador";
  return d;
}

function casilla(texto: string, inicial: boolean, alCambiar: (v: boolean) => void): HTMLLabelElement {
  const etiqueta = document.createElement("label");
  etiqueta.className = "interruptor";
  const c = document.createElement("input");
  c.type = "checkbox";
  c.checked = inicial;
  c.addEventListener("change", () => alCambiar(c.checked));
  etiqueta.append(c, ` ${texto}`);
  return etiqueta;
}

function etiqueta(texto: string, control: HTMLElement): HTMLLabelElement {
  const l = document.createElement("label");
  l.className = "control-etiquetado";
  l.append(texto, control);
  return l;
}

function grupo(...hijos: HTMLElement[]): HTMLElement {
  const g = document.createElement("div");
  g.className = "grupo";
  g.append(...hijos);
  return g;
}
