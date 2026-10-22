import { t, traducible } from "../i18n";
import type { IContentRenderer } from "dockview-core";
import { app } from "../estado";
import { PX_POR_MM } from "../lienzo/geometria-zona";
import { ImagenFlotante } from "../lienzo/imagen";
import { PRESETS } from "../lienzo/pincel";
import { nuevoId } from "../lienzo/capa";
import { copiarCapa, obtenerCopia } from "../lienzo/portapapeles";
import { puntosDeForma, rellenar, restringir, Seleccion } from "../lienzo/herramientas";
import type { AjustesPincel, Herramienta } from "../lienzo/pincel";
import { VistaRecta } from "../lienzo/vista-recta";
import type { Lienzo } from "../lienzo/lienzo";
import type { Rect } from "../lienzo/teselas";
import { abrirDialogoExportar } from "./exportar";
import { abrirDialogoTexto } from "./texto";
import { botonIcono, seccion, segmentado, type NombreIcono } from "../ui/iconos";
import { abrirSelectorColor, MAX_PALETA } from "../ui/selector-color";

type P = { x: number; y: number };
type Arrastre =
  | { tipo: "dibujo"; ultimo: P }
  | { tipo: "dibujo-recta" }
  | { tipo: "desplazar"; inicio: P; vista: DOMMatrix }
  | { tipo: "girar"; centro: P; angulo0: number; vista: DOMMatrix }
  | { tipo: "imagen-mover"; ultimo: P }
  | { tipo: "imagen-escalar"; distancia0: number; matriz0: DOMMatrix }
  | { tipo: "imagen-girar"; angulo0: number; matriz0: DOMMatrix }
  | { tipo: "lazo"; puntos: P[] }
  | { tipo: "forma"; forma: Forma; a: P; b: P };

type Forma = "linea" | "rectangulo" | "elipse";
const FORMAS: Forma[] = ["linea", "rectangulo", "elipse"];
const esForma = (h: Herramienta): h is Forma => (FORMAS as string[]).includes(h);

/** Paleta inicial: negros y grises para líneas y sombras, y los colores de tinta más comunes. */
const PALETA_INICIAL = ["#1d1b1a", "#4a4642", "#8a847e", "#c9c2ba", "#b3261e", "#e07b24", "#f2c230", "#2f7d3a", "#1f5aa6", "#6a3d9a"];
const CLAVE_PALETA = "dermap.paleta";
/** Contexto sin transformación para saber si un punto del documento cae dentro de un camino. */
const PRUEBA = new OffscreenCanvas(1, 1).getContext("2d")!;

function leerPaleta(): string[] {
  try {
    const p = JSON.parse(localStorage.getItem(CLAVE_PALETA) ?? "null");
    if (Array.isArray(p) && p.every((c) => typeof c === "string")) return p;
  } catch {
    // Sin almacenamiento local o dato dañado: paleta inicial.
  }
  return [...PALETA_INICIAL];
}

function guardarPaleta(p: string[]): void {
  try {
    localStorage.setItem(CLAVE_PALETA, JSON.stringify(p));
  } catch {
    // Sin almacenamiento local: la paleta dura lo que la sesión.
  }
}

const COLOR_PAPEL = "#f4efe9";

const NOMBRES_HERRAMIENTA: Record<Herramienta, string> = {
  pincel: traducible("pincel"),
  goma: traducible("goma"),
  relleno: traducible("relleno"),
  lazo: traducible("lazo"),
  linea: traducible("línea"),
  rectangulo: traducible("rectángulo"),
  elipse: traducible("elipse"),
};

/**
 * Editor del lienzo activo: herramientas, navegación (zoom, desplazamiento y giro, RF-44),
 * dibujo con presión y colocación de imágenes importadas (RF-33).
 *
 *  - Lápiz o botón izquierdo: dibujar.
 *  - Botón central, o Espacio + arrastrar: desplazar. Rueda: zoom. Mayús + rueda o R + arrastrar: girar.
 *  - Mayús + clic: línea recta desde el final del trazo anterior. Alt + clic o I: cuentagotas.
 *  - B pincel · E goma · [ ] tamaño · Ctrl+Z deshacer · Ctrl+Mayús+Z o Ctrl+Y rehacer · 0 encajar.
 */
export class PanelLienzo implements IContentRenderer {
  readonly element: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private aviso: HTMLElement;
  private info: HTMLElement;
  private barra: HTMLElement;
  private pestanas: HTMLElement;
  private barraImagen: HTMLElement;
  private observador: ResizeObserver;

  private lienzo: Lienzo | null = null;
  /** Documento → píxeles del canvas. */
  private vista = new DOMMatrix();
  private arrastre: Arrastre | null = null;
  private puntero: P | null = null;
  private espacio = false;
  private teclaR = false;
  /** Cuentagotas activado con el botón o la tecla I: el próximo clic toma el color. */
  private cuentagotas = false;
  private mayus = false;
  /** Final del último trazo, para la línea recta con Mayús (RF-35). */
  private ultimoPunto: P | null = null;
  /** Selección con lazo activa (RF-34). */
  private seleccion: Seleccion | null = null;
  private paleta = leerPaleta();
  /** Vista rectangular de una manga (RF-38), si está activa. */
  private recta: VistaRecta | null = null;
  private rectaPendiente = false;
  /** Trazo en curso en la vista rectangular: último punto del rectángulo y del lienzo. */
  private trazoRecta: { ultimo: P; enLienzo: P | null; activo: boolean; ajustes: AjustesPincel } | null = null;
  private botonRecta!: HTMLButtonElement;
  private botonAngulo!: HTMLButtonElement;
  private riel!: HTMLElement;
  private accionesPestanas!: HTMLElement;
  private barraVista!: HTMLElement;
  private valores!: Record<"tamano" | "opacidad" | "dureza", HTMLElement>;
  private filaPaleta!: HTMLElement;
  private verDeformacion = false;
  private flotante: ImagenFlotante | null = null;
  private repintar = false;

  private controles: Record<string, HTMLInputElement | HTMLButtonElement | HTMLSelectElement> = {};

  private alCambiarActivo = () => {
    this.mostrar(app.activo);
    this.pintarPestanas();
  };
  private alCambiarAbiertos = () => this.pintarPestanas();
  private alCambiarAjustes = () => this.sincronizarControles();
  private alCambiarPrevia = () => {
    if (this.recta) this.programarRecta();
    this.pedirRepintado();
  };
  private alCambiarHistorial = () => this.sincronizarControles();
  private alTeclaAbajo = (e: KeyboardEvent) => this.teclaAbajo(e);
  private alTeclaArriba = (e: KeyboardEvent) => this.teclaArriba(e);

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "panel panel-lienzo";
    this.element.tabIndex = -1;

    this.pestanas = document.createElement("div");
    this.pestanas.className = "pestanas";

    this.barra = document.createElement("div");
    this.barra.className = "herramientas envolver barra-opciones";
    this.riel = document.createElement("div");
    this.riel.className = "riel";
    this.barraVista = document.createElement("div");
    this.barraVista.className = "barra-vista";
    this.montarHerramientas();

    this.barraImagen = document.createElement("div");
    this.barraImagen.className = "herramientas aviso-imagen";
    this.barraImagen.hidden = true;
    const textoImagen = document.createElement("span");
    textoImagen.textContent = t("Coloca la imagen: arrastra para mover, esquinas para escalar, punto superior para girar (Mayús: de 15 en 15°).");
    this.barraImagen.append(
      textoImagen,
      botonIcono("voltearH", t("Voltear en horizontal (Mayús+H)"), () => this.voltearImagen(true), { texto: t("Voltear ↔") }),
      botonIcono("voltearV", t("Voltear en vertical (Mayús+V)"), () => this.voltearImagen(false), { texto: t("Voltear ↕") }),
      boton(t("Aplicar (Intro)"), () => this.fijarImagen(), "primario"),
      boton(t("Cancelar (Esc)"), () => this.cancelarImagen()),
    );

    this.canvas = document.createElement("canvas");
    this.canvas.style.touchAction = "none";
    this.ctx = this.canvas.getContext("2d")!;

    this.aviso = document.createElement("div");
    this.aviso.className = "aviso centrado";
    this.aviso.textContent = t("Aplana una zona desde el visor 3D, o abre un lienzo del proyecto, para empezar a dibujar.");

    this.info = document.createElement("div");
    this.info.className = "etiqueta-flotante";

    const zona = document.createElement("div");
    zona.className = "zona-lienzo";
    zona.append(this.canvas, this.aviso, this.info, this.barraVista);
    const cuerpo = document.createElement("div");
    cuerpo.className = "cuerpo-lienzo";
    cuerpo.append(this.riel, zona);
    this.element.append(this.pestanas, this.barra, this.barraImagen, cuerpo);

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
    app.addEventListener("abiertos", this.alCambiarAbiertos);
    app.addEventListener("lienzos", this.alCambiarAbiertos);
    app.addEventListener("ajustes", this.alCambiarAjustes);
    window.addEventListener("keydown", this.alTeclaAbajo);
    window.addEventListener("keyup", this.alTeclaArriba);

    this.observador = new ResizeObserver(() => this.redimensionar());
    this.observador.observe(this.canvas);
    instancias.push(this);
    this.mostrar(app.activo);
    this.pintarPestanas();
  }

  /** Pestañas de los lienzos abiertos (RF-42), como los documentos de un editor. */
  private pintarPestanas(): void {
    this.pestanas.replaceChildren();
    this.pestanas.hidden = app.abiertos.length === 0;
    for (const l of app.abiertos) {
      const p = document.createElement("div");
      p.className = "pestana" + (l === app.activo ? " activa" : "");
      p.title = l.nombre;
      const nombre = document.createElement("span");
      nombre.textContent = l.nombre;
      const cerrar = document.createElement("button");
      cerrar.className = "icono";
      cerrar.textContent = t("×");
      cerrar.title = t("Cerrar pestaña (el lienzo sigue en el proyecto y en el 3D)");
      cerrar.addEventListener("click", (e) => {
        e.stopPropagation();
        app.cerrar(l);
      });
      p.append(nombre, cerrar);
      p.addEventListener("click", () => app.activar(l));
      p.addEventListener("auxclick", (e) => {
        if (e.button === 1) app.cerrar(l);
      });
      this.pestanas.append(p);
    }
    const hueco = document.createElement("span");
    hueco.className = "hueco";
    this.pestanas.append(hueco, this.accionesPestanas);
  }

  init(): void {}

  dispose(): void {
    this.observador.disconnect();
    app.removeEventListener("activo", this.alCambiarActivo);
    app.removeEventListener("abiertos", this.alCambiarAbiertos);
    app.removeEventListener("lienzos", this.alCambiarAbiertos);
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
    this.ultimoPunto = null;
    this.seleccion = null;
    this.recta = null;
    if (lienzo) {
      lienzo.addEventListener("previa", this.alCambiarPrevia);
      lienzo.addEventListener("propiedades", this.alCambiarPrevia);
      lienzo.addEventListener("propiedades", this.alCambiarAbiertos);
      lienzo.addEventListener("historial", this.alCambiarHistorial);
      lienzo.addEventListener("capas", this.alCambiarHistorial);
    }
    this.aviso.hidden = lienzo !== null;
    this.encajar();
    this.sincronizarControles();
  }

  private desconectar(): void {
    if (!this.lienzo) return;
    this.lienzo.removeEventListener("previa", this.alCambiarPrevia);
    this.lienzo.removeEventListener("propiedades", this.alCambiarPrevia);
    this.lienzo.removeEventListener("propiedades", this.alCambiarAbiertos);
    this.lienzo.removeEventListener("historial", this.alCambiarHistorial);
    this.lienzo.removeEventListener("capas", this.alCambiarHistorial);
  }

  // ── Herramientas ──────────────────────────────────────────────────────────────

  private montarHerramientas(): void {
    const a = app.ajustes;
    // ── Riel de herramientas (vertical, a la izquierda) ──
    const herramienta = (nombre: NombreIcono, h: Herramienta, titulo: string) => {
      const b = botonIcono(nombre, titulo, () => {
        this.cuentagotas = false;
        app.cambiarAjustes({ herramienta: h });
        this.sincronizarControles();
      });
      b.dataset.herramienta = h;
      return b;
    };
    const pincel = herramienta("pincel", "pincel", t("Pincel (B)"));
    const goma = herramienta("goma", "goma", t("Goma (E)"));
    const gotero = botonIcono("gotero", t("Tomar un color del dibujo (I, o Alt + clic)"), () => {
      this.cuentagotas = !this.cuentagotas;
      this.sincronizarControles();
    });
    const relleno = herramienta("relleno", "relleno", t("Cubo de relleno: rellena la zona cerrada bajo el clic (G)"));
    const lazo = herramienta("lazo", "lazo", t("Selección con lazo: rodea una parte para moverla, copiarla o borrarla (L)"));
    const linea = herramienta("linea", "linea", t("Línea (U). Mayús: ángulos de 15°"));
    const rectangulo = herramienta("rectangulo", "rectangulo", t("Rectángulo (U). Mayús: cuadrado"));
    const elipse = herramienta("elipse", "elipse", t("Elipse (U). Mayús: círculo"));
    const texto = botonIcono("texto", t("Texto a tamaño real (T)"), () => abrirDialogoTexto());

    // Color actual: abre el selector propio con la paleta.
    const color = document.createElement("button");
    color.type = "button";
    color.className = "muestra-actual";
    color.title = t("Color del pincel");
    color.addEventListener("click", () =>
      abrirSelectorColor(color, {
        color: app.ajustes.color,
        alCambiar: (c) => app.cambiarAjustes({ color: c, herramienta: app.ajustes.herramienta === "goma" ? "pincel" : app.ajustes.herramienta }),
        paleta: () => this.paleta,
        guardarPaleta: (p) => {
          this.paleta = p.slice(0, MAX_PALETA);
          guardarPaleta(this.paleta);
          this.pintarPaleta();
        },
      }),
    );

    const separador = () => Object.assign(document.createElement("span"), { className: "separador-riel" });
    this.riel.append(pincel, goma, gotero, separador(), relleno, lazo, separador(), linea, rectangulo, elipse, texto, separador(), color);

    // ── Barra de opciones del trazo (arriba) ──
    const preset = document.createElement("select");
    preset.title = t("Pinceles para tatuaje");
    preset.className = "desplegable selector-preset";
    preset.append(new Option(t("Personalizado"), ""), ...PRESETS.map((p, i) => new Option(t(p.nombre), String(i))));
    preset.addEventListener("change", () => {
      const p = PRESETS[Number(preset.value)];
      if (p) app.cambiarAjustes(p.ajustes);
    });
    // Tamaño en escala logarítmica: de 0,2 a 40 mm.
    const tamano = deslizador(0, 1000, tamanoADeslizador(a.tamano), t("Tamaño ([ y ])"));
    tamano.addEventListener("input", () => app.cambiarAjustes({ tamano: deslizadorATamano(Number(tamano.value)) }));
    const opacidad = deslizador(1, 100, a.opacidad * 100, t("Opacidad del trazo"));
    opacidad.addEventListener("input", () => app.cambiarAjustes({ opacidad: Number(opacidad.value) / 100 }));
    const dureza = deslizador(0, 100, a.dureza * 100, t("Dureza del borde: alta para líneas, baja para sombreado"));
    dureza.addEventListener("input", () => app.cambiarAjustes({ dureza: Number(dureza.value) / 100 }));
    this.valores = { tamano: valor(), opacidad: valor(), dureza: valor() };
    const puntos = casilla(t("Puntillismo"), a.forma === "puntos", (v) => app.cambiarAjustes({ forma: v ? "puntos" : "redonda" }));
    puntos.title = t("Puntillismo: la estampa es una nube de puntos de aguja");
    const presion = casilla(t("Presión → intensidad"), a.presionOpacidad, (v) => app.cambiarAjustes({ presionOpacidad: v }));
    presion.title = t("Con el lápiz, la presión también controla la intensidad (útil para sombrear)");

    this.filaPaleta = document.createElement("div");
    this.filaPaleta.className = "paleta";
    this.pintarPaleta();

    const exportar = botonIcono("exportar", t("Stencil a escala real en PDF (A4) o PNG"), () => this.lienzo && abrirDialogoExportar(this.lienzo), {
      texto: t("Exportar stencil"),
      clase: "primario",
    });
    this.barra.append(
      seccion(t("Pincel"), preset),
      seccion(
        t("Trazo"),
        etiqueta(t("Tamaño"), tamano, this.valores.tamano),
        etiqueta(t("Opacidad"), opacidad, this.valores.opacidad),
        etiqueta(t("Dureza"), dureza, this.valores.dureza),
      ),
      seccion(t("Punta"), puntos, presion),
    );
    // Exportar: a la derecha de las pestañas, siempre a mano.
    this.accionesPestanas = document.createElement("div");
    this.accionesPestanas.className = "acciones-pestanas";
    this.accionesPestanas.append(exportar);

    // ── Barra de vista (flotante, abajo a la derecha) ──
    const deshacer = botonIcono("deshacer", t("Deshacer (Ctrl+Z)"), () => void this.lienzo?.deshacer());
    const rehacer = botonIcono("rehacer", t("Rehacer (Ctrl+Mayús+Z)"), () => void this.lienzo?.rehacer());
    const girarI = botonIcono("girarIzquierda", t("Girar el lienzo 15° a la izquierda (también R + arrastrar o Mayús + rueda)"), () => this.girarVista(-15));
    const girarD = botonIcono("girarDerecha", t("Girar el lienzo 15° a la derecha"), () => this.girarVista(15));
    this.botonAngulo = document.createElement("button");
    this.botonAngulo.type = "button";
    this.botonAngulo.className = "boton-texto angulo";
    this.botonAngulo.title = t("Ángulo del lienzo: clic para enderezarlo");
    this.botonAngulo.addEventListener("click", () => this.girarVista(-this.anguloVista()));
    const encajar = botonIcono("encajar", t("Ver el lienzo entero (0)"), () => this.encajar());
    const cuadricula = botonIcono("cuadricula", t("Cuadrícula de 1 cm"), () => {
      if (this.lienzo) this.lienzo.cambiar({ cuadricula: !this.lienzo.cuadricula });
      this.sincronizarControles();
    });
    const deformacion = botonIcono("zona", t("Ver la deformación del aplanado (zonas que estiran o encogen)"), () => {
      this.verDeformacion = !this.verDeformacion;
      this.sincronizarControles();
    });
    this.botonRecta = botonIcono("recta", t("Mangas: ver y dibujar la piel desenrollada en un rectángulo (una línea horizontal es un anillo alrededor del brazo)"), () =>
      this.alternarRecta(),
    );
    this.barraVista.append(
      segmentado(deshacer, rehacer),
      segmentado(girarI, this.botonAngulo, girarD),
      segmentado(encajar, cuadricula, deformacion, this.botonRecta),
    );

    this.controles = {
      pincel,
      goma,
      gotero,
      preset,
      color,
      relleno,
      lazo,
      linea,
      rectangulo,
      elipse,
      tamano,
      opacidad,
      dureza,
      deshacer,
      rehacer,
      cuadricula,
      deformacion,
      presion: presion.querySelector("input")!,
      puntos: puntos.querySelector("input")!,
    };
  }

  /** Gira la vista del lienzo alrededor del centro del panel. */
  private girarVista(grados: number): void {
    if (!this.lienzo || !grados) return;
    const c = { x: this.canvas.width / 2, y: this.canvas.height / 2 };
    this.vista = new DOMMatrix().translate(c.x, c.y).rotate(grados).translate(-c.x, -c.y).multiply(this.vista);
    this.actualizarInfo();
    this.pedirRepintado();
  }

  /** Ángulo actual de la vista, en grados (−180, 180]. */
  private anguloVista(): number {
    return (Math.atan2(this.vista.b, this.vista.a) * 180) / Math.PI;
  }

  private sincronizarControles(): void {
    const a = app.ajustes;
    this.controles.gotero.classList.toggle("activo", this.cuentagotas);
    (this.controles.color as HTMLButtonElement).style.background = a.color;
    this.controles.deformacion.classList.toggle("activo", this.verDeformacion);
    this.controles.cuadricula.classList.toggle("activo", !!this.lienzo?.cuadricula);
    this.valores.tamano.textContent = `${a.tamano < 1 ? a.tamano.toFixed(2) : a.tamano.toFixed(1)} mm`;
    this.valores.opacidad.textContent = `${Math.round(a.opacidad * 100)} %`;
    this.valores.dureza.textContent = `${Math.round(a.dureza * 100)} %`;
    if (this.botonRecta) {
      this.botonRecta.classList.toggle("activo", !!this.recta);
      this.botonRecta.disabled = this.lienzo?.zona.aplanado.tipo !== "manga";
    }
    for (const b of this.riel.querySelectorAll<HTMLElement>("[data-herramienta]")) {
      b.classList.toggle("activo", !this.cuentagotas && b.dataset.herramienta === a.herramienta);
    }
    this.canvas.classList.toggle("modo-gotero", this.cuentagotas || a.herramienta === "relleno" || a.herramienta === "lazo");
    for (const m of this.filaPaleta.querySelectorAll<HTMLElement>(".muestra")) m.classList.toggle("activo", m.title === a.color);
    this.riel.classList.toggle("deshabilitado", !this.lienzo);
    this.barra.classList.toggle("deshabilitado", !this.lienzo);
    this.barraVista.hidden = !this.lienzo;
    this.canvas.classList.toggle("modo-gotero", this.cuentagotas);
    // El selector muestra el pincel predefinido que coincide con los ajustes actuales, si lo hay.
    const i = PRESETS.findIndex((p) => Object.entries(p.ajustes).every(([k, v]) => a[k as keyof typeof a] === v));
    (this.controles.preset as HTMLSelectElement).value = i >= 0 ? String(i) : "";
    (this.controles.puntos as HTMLInputElement).checked = a.forma === "puntos";
    (this.controles.tamano as HTMLInputElement).value = String(tamanoADeslizador(a.tamano));
    (this.controles.opacidad as HTMLInputElement).value = String(Math.round(a.opacidad * 100));
    (this.controles.dureza as HTMLInputElement).value = String(Math.round(a.dureza * 100));
    (this.controles.presion as HTMLInputElement).checked = a.presionOpacidad;
    (this.controles.deshacer as HTMLButtonElement).disabled = !this.lienzo?.historial.puedeDeshacer;
    (this.controles.rehacer as HTMLButtonElement).disabled = !this.lienzo?.historial.puedeRehacer;
    this.actualizarInfo();
    this.pedirRepintado();
  }

  /** Paleta guardable (RF-30): clic elige, «+» añade el color actual, clic derecho quita. */
  private pintarPaleta(): void {
    this.filaPaleta.replaceChildren();
    for (const color of this.paleta) {
      const m = document.createElement("button");
      m.className = "muestra pequena";
      m.style.background = color;
      m.title = color;
      m.addEventListener("click", () => app.cambiarAjustes({ color, herramienta: app.ajustes.herramienta === "goma" ? "pincel" : app.ajustes.herramienta }));
      m.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this.paleta = this.paleta.filter((c) => c !== color);
        guardarPaleta(this.paleta);
        this.pintarPaleta();
      });
      this.filaPaleta.append(m);
    }
    const mas = boton(t("+"), () => {
      if (this.paleta.length < MAX_PALETA && !this.paleta.includes(app.ajustes.color)) {
        this.paleta.push(app.ajustes.color);
        guardarPaleta(this.paleta);
        this.pintarPaleta();
      }
    });
    mas.title =
      this.paleta.length >= MAX_PALETA
        ? t("La paleta está llena: quita un color para guardar otro")
        : t("Añadir el color actual a la paleta (clic derecho en un color para quitarlo)");
    mas.disabled = this.paleta.length >= MAX_PALETA;
    mas.classList.add("mas-paleta");
    this.filaPaleta.append(mas);
  }

  private actualizarInfo(): void {
    if (this.botonAngulo) this.botonAngulo.textContent = `${Math.round(this.anguloVista())}°`;
    if (!this.lienzo) {
      this.info.textContent = "";
      return;
    }
    const [w, h] = this.lienzo.geo.tamanoCm;
    const a = app.ajustes;
    const capa = this.lienzo.doc.activa;
    const bloqueo = capa.bloqueada ? t(" (bloqueada)") : !capa.visible ? t(" (oculta)") : "";
    this.info.textContent =
      t("{lienzo} · {ancho} × {alto} cm · capa «{capa}»{bloqueo} · {herramienta} {mm} mm · zoom {zoom} %", {
        lienzo: this.lienzo.nombre,
        ancho: w.toFixed(1),
        alto: h.toFixed(1),
        capa: capa.nombre,
        bloqueo,
        herramienta: t(NOMBRES_HERRAMIENTA[a.herramienta]),
        mm: a.tamano < 1 ? a.tamano.toFixed(2) : a.tamano.toFixed(1),
        zoom: Math.round((this.escalaVista() / window.devicePixelRatio) * 100),
      });
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

  /** Tamaño de lo que se muestra: el lienzo o, en la vista recta, el rectángulo. */
  private tamanoVisible(): { ancho: number; alto: number } {
    return this.recta ?? this.lienzo!.geo;
  }

  private alternarRecta(): void {
    const l = this.lienzo;
    if (!l) return;
    if (this.recta) {
      this.recta = null;
    } else {
      if (l.zona.aplanado.tipo !== "manga") {
        this.info.textContent = t("La vista recta es para mangas (zonas que rodean el brazo o la pierna).");
        return;
      }
      if (this.flotante) this.cancelarImagen();
      this.seleccion = null;
      this.recta = new VistaRecta(l);
    }
    this.ultimoPunto = null;
    this.encajar();
    this.sincronizarControles();
  }

  /** La tinta del rectángulo se rehace como mucho cada 120 ms mientras se dibuja. */
  private programarRecta(): void {
    if (this.rectaPendiente) return;
    this.rectaPendiente = true;
    setTimeout(() => {
      this.rectaPendiente = false;
      this.recta?.actualizar();
      this.pedirRepintado();
    }, 120);
  }

  /** Punto del lienzo bajo un punto de lo que se ve (en la vista recta, se convierte). */
  private aLienzo(d: P): P | null {
    return this.recta ? this.recta.aLienzo(d.x, d.y) : d;
  }

  /**
   * Trazo en la vista recta: cada tramo se subdivide y se lleva al lienzo punto a punto
   * (las rectas del rectángulo son curvas en el lienzo); al salir de la zona o cruzar el
   * corte, el trazo se corta y sigue al otro lado.
   */
  private puntoRecta(d: P, presion: number): void {
    const tr = this.trazoRecta;
    const l = this.lienzo;
    if (!tr || !l || !this.recta) return;
    const dist = Math.hypot(d.x - tr.ultimo.x, d.y - tr.ultimo.y);
    const pasos = tr.enLienzo === null && !tr.activo && dist === 0 ? 1 : Math.max(1, Math.ceil(dist / 8));
    for (let i = 1; i <= pasos; i++) {
      const q = { x: tr.ultimo.x + ((d.x - tr.ultimo.x) * i) / pasos, y: tr.ultimo.y + ((d.y - tr.ultimo.y) * i) / pasos };
      const c = this.recta.aLienzo(q.x, q.y);
      const paso = dist / pasos;
      if (!c || (tr.activo && tr.enLienzo && Math.hypot(c.x - tr.enLienzo.x, c.y - tr.enLienzo.y) > 6 * paso + 60)) {
        if (tr.activo) l.terminarTrazo();
        tr.activo = false;
      }
      if (c) {
        if (!tr.activo) {
          tr.activo = l.empezarTrazo(tr.ajustes, c.x, c.y, presion);
          if (!tr.activo) this.info.textContent = capaNoEditable(l.doc.activa);
        } else l.continuarTrazo(c.x, c.y, presion);
      }
      tr.enLienzo = c;
    }
    tr.ultimo = d;
  }

  private trazarRecta(puntos: P[], presion: number, ajustes: AjustesPincel): void {
    if (!puntos.length) return;
    this.trazoRecta = { ultimo: puntos[0], enLienzo: null, activo: false, ajustes };
    for (const p of puntos) this.puntoRecta(p, presion);
    this.terminarRecta();
  }

  private terminarRecta(): void {
    if (this.trazoRecta?.activo) this.lienzo?.terminarTrazo();
    this.trazoRecta = null;
  }

  private encajar(): void {
    const l = this.lienzo;
    if (!l || this.canvas.width === 0) return;
    const { ancho, alto } = this.tamanoVisible();
    const escala = Math.min(this.canvas.width / ancho, this.canvas.height / alto) * 0.94;
    this.vista = new DOMMatrix()
      .translate((this.canvas.width - ancho * escala) / 2, (this.canvas.height - alto * escala) / 2)
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
    if (this.recta) {
      this.punteroAbajoRecta(e, d);
      return;
    }
    if (this.cuentagotas || e.altKey) {
      this.tomarColor(d);
      return;
    }
    const h = app.ajustes.herramienta;
    if (h === "relleno") {
      const a = app.ajustes;
      if (!rellenar(l, d.x, d.y, a.color, a.opacidad))
        this.info.textContent = l.doc.activa.bloqueada || !l.doc.activa.visible
          ? capaNoEditable(l.doc.activa)
          : t("Haz clic dentro de la zona para rellenar.");
      return;
    }
    if (h === "lazo") {
      if (this.seleccion && PRUEBA.isPointInPath(this.seleccion.camino, d.x, d.y)) {
        void this.moverSeleccion(c, d);
        return;
      }
      this.seleccion = null;
      this.arrastre = { tipo: "lazo", puntos: [d] };
      return;
    }
    if (esForma(h)) {
      this.arrastre = { tipo: "forma", forma: h, a: d, b: d };
      return;
    }
    if (e.shiftKey && this.ultimoPunto) {
      // Línea recta desde el final del trazo anterior (RF-35).
      const o = this.ultimoPunto;
      if (l.empezarTrazo(app.ajustes, o.x, o.y, 0.5)) {
        l.continuarTrazo(d.x, d.y, presionDe(e));
        l.terminarTrazo();
        this.ultimoPunto = d;
      }
      return;
    }
    if (l.empezarTrazo(app.ajustes, d.x, d.y, presionDe(e))) this.arrastre = { tipo: "dibujo", ultimo: d };
    else this.info.textContent = capaNoEditable(l.doc.activa);
  }

  /** Herramientas en la vista recta: se convierte cada punto al lienzo. */
  private punteroAbajoRecta(e: PointerEvent, d: P): void {
    const l = this.lienzo!;
    const h = app.ajustes.herramienta;
    if (this.cuentagotas || e.altKey) {
      const c = this.aLienzo(d);
      if (c) this.tomarColor(c);
      return;
    }
    if (h === "lazo") {
      this.info.textContent = t("El lazo funciona en la vista normal del lienzo.");
      return;
    }
    if (h === "relleno") {
      const c = this.aLienzo(d);
      const a = app.ajustes;
      if (!c || !rellenar(l, c.x, c.y, a.color, a.opacidad)) this.info.textContent = t("Haz clic dentro de la zona para rellenar.");
      return;
    }
    if (esForma(h)) {
      this.arrastre = { tipo: "forma", forma: h, a: d, b: d };
      return;
    }
    const ajustes = { ...app.ajustes, herramienta: h === "goma" ? ("goma" as const) : ("pincel" as const) };
    if (e.shiftKey && this.ultimoPunto) {
      this.trazarRecta([this.ultimoPunto, d], presionDe(e), ajustes);
      this.ultimoPunto = d;
      return;
    }
    this.trazoRecta = { ultimo: d, enLienzo: null, activo: false, ajustes };
    this.puntoRecta(d, presionDe(e));
    this.arrastre = { tipo: "dibujo-recta" };
    this.ultimoPunto = d;
  }

  private punteroMovido(e: PointerEvent): void {
    this.puntero = this.aCanvas(e);
    this.mayus = e.shiftKey;
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
          a.ultimo = d;
        }
        break;
      case "desplazar":
        this.vista = new DOMMatrix().translate(c.x - a.inicio.x, c.y - a.inicio.y).multiply(a.vista);
        break;
      case "dibujo-recta":
        for (const ev of e.getCoalescedEvents?.() ?? [e]) {
          const d = this.aDocumento(ev);
          this.puntoRecta(d, presionDe(ev));
          this.ultimoPunto = d;
        }
        break;
      case "lazo": {
        const d = this.aDocumento(e);
        const u = a.puntos[a.puntos.length - 1];
        if (Math.hypot(d.x - u.x, d.y - u.y) * this.escalaVista() >= 3) a.puntos.push(d);
        break;
      }
      case "forma": {
        const d = this.aDocumento(e);
        a.b = e.shiftKey ? restringir(a.forma, a.a, d) : d;
        break;
      }
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
        let grados = ((angulo - a.angulo0) * 180) / Math.PI;
        // Con Mayús, el giro va de 15 en 15 grados.
        if (e.shiftKey) grados = Math.round(grados / 15) * 15;
        this.flotante!.girar(grados);
        break;
      }
    }
    this.pedirRepintado();
  }

  private punteroArriba(e: PointerEvent): void {
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    const a = this.arrastre;
    this.arrastre = null;
    if (a?.tipo === "dibujo") {
      this.lienzo?.terminarTrazo();
      this.ultimoPunto = a.ultimo;
    }
    if (a?.tipo === "lazo") {
      const r = a.puntos.length >= 3 ? new Seleccion(a.puntos) : null;
      this.seleccion = r && r.rect.x1 - r.rect.x0 > 4 && r.rect.y1 - r.rect.y0 > 4 ? r : null;
      if (this.seleccion)
        this.info.textContent = t("Selección: arrástrala para moverla · Supr borra · Ctrl+C copia · Ctrl+X corta · Esc la quita");
    }
    if (a?.tipo === "dibujo-recta") this.terminarRecta();
    if (a?.tipo === "forma") this.trazarForma(a.forma, a.a, a.b);
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
    } else if (ctrl && tecla === "c") {
      e.preventDefault();
      void this.copiar();
    } else if (ctrl && tecla === "x" && this.seleccion && this.lienzo) {
      e.preventDefault();
      const sel = this.seleccion;
      void sel.copiar(this.lienzo).then((ok) => ok && this.lienzo && sel.borrar(this.lienzo, "Cortar"));
    } else if (ctrl && e.shiftKey && tecla === "n" && this.lienzo) {
      e.preventDefault();
      this.lienzo.historial.registrar(this.lienzo.doc.instantaneaCapas("Nueva capa"));
      this.lienzo.doc.añadirCapa();
    } else if (ctrl && tecla === "j" && this.lienzo) {
      e.preventDefault();
      const l = this.lienzo;
      const origen = l.doc.activa;
      l.historial.registrar(l.doc.instantaneaCapas("Duplicar capa"));
      l.doc.insertarCapa(origen.duplicar(nuevoId(), t("{nombre} copia", { nombre: origen.nombre })), l.doc.capas.indexOf(origen) + 1);
    } else if (ctrl && tecla === "d") {
      e.preventDefault();
      this.seleccion = null;
      this.pedirRepintado();
    } else if (ctrl && tecla === "v") {
      e.preventDefault();
      this.pegar();
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
    } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && this.lienzo) {
      // Capa de encima o de debajo.
      e.preventDefault();
      const capas = this.lienzo.doc.capas;
      const i = capas.indexOf(this.lienzo.doc.activa) + (e.key === "ArrowUp" ? 1 : -1);
      if (i >= 0 && i < capas.length) this.lienzo.doc.seleccionarCapa(capas[i]);
    } else if (tecla === "t") {
      e.preventDefault();
      void import("./texto").then((m) => m.abrirDialogoTexto());
    } else if (tecla === "g") {
      app.cambiarAjustes({ herramienta: "relleno" });
    } else if (tecla === "l") {
      app.cambiarAjustes({ herramienta: "lazo" });
    } else if (tecla === "u") {
      const h = app.ajustes.herramienta;
      app.cambiarAjustes({ herramienta: esForma(h) ? FORMAS[(FORMAS.indexOf(h) + 1) % FORMAS.length] : "linea" });
    } else if ((e.key === "Delete" || e.key === "Backspace") && this.seleccion && this.lienzo) {
      e.preventDefault();
      this.seleccion.borrar(this.lienzo);
    } else if (e.key === "Escape" && this.seleccion && !this.flotante) {
      this.seleccion = null;
      this.pedirRepintado();
    } else if (tecla === "i") {
      this.cuentagotas = !this.cuentagotas;
      this.sincronizarControles();
    } else if (e.key === "[" || e.key === "]") {
      const factor = e.key === "]" ? 1.25 : 0.8;
      app.cambiarAjustes({ tamano: Math.min(40, Math.max(0.2, app.ajustes.tamano * factor)) });
    } else if (e.key === "0") {
      this.encajar();
    } else if (e.key === "Enter" && this.flotante) {
      this.fijarImagen();
    } else if (this.flotante && e.shiftKey && (e.code === "KeyH" || e.code === "KeyV")) {
      this.voltearImagen(e.code === "KeyH");
    } else if (e.key === "Escape" && this.flotante) {
      this.cancelarImagen();
    } else if (e.key === "Escape" && this.cuentagotas) {
      this.cuentagotas = false;
      this.sincronizarControles();
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

  /**
   * Cuentagotas: color de la tinta compuesta (sin la piel) bajo el puntero. Si no hay tinta
   * no cambia nada. Vuelve al pincel, como en los programas de dibujo.
   */
  private tomarColor(d: P): void {
    const l = this.lienzo;
    if (!l) return;
    this.cuentagotas = false;
    const x = Math.floor(d.x), y = Math.floor(d.y);
    const lamina = new OffscreenCanvas(1, 1);
    const ctx = lamina.getContext("2d", { willReadFrequently: true })!;
    ctx.translate(-x, -y);
    l.doc.componer(ctx, { x0: x, y0: y, x1: x + 1, y1: y + 1 });
    const [r, g, b, alfa] = ctx.getImageData(0, 0, 1, 1).data;
    if (alfa < 8) {
      this.info.textContent = t("No hay tinta en ese punto.");
      this.sincronizarControles();
      return;
    }
    const hex = "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
    app.cambiarAjustes({ color: hex, herramienta: "pincel" });
  }

  /** Traza una forma con el pincel actual, como un trazo (cruza costuras y se deshace de una vez). */
  private trazarForma(forma: Forma, a: P, b: P): void {
    const l = this.lienzo;
    if (!l || Math.hypot(b.x - a.x, b.y - a.y) < 2) return;
    const puntos = puntosDeForma(forma, a, b);
    const ajustes = { ...app.ajustes, herramienta: "pincel" as const };
    if (this.recta) {
      this.trazarRecta(puntos, 1, ajustes);
      this.ultimoPunto = puntos[puntos.length - 1];
      return;
    }
    if (!l.empezarTrazo(ajustes, puntos[0].x, puntos[0].y, 1)) return;
    for (const p of puntos.slice(1)) l.continuarTrazo(p.x, p.y, 1);
    l.terminarTrazo();
    this.ultimoPunto = puntos[puntos.length - 1];
  }

  /**
   * Mover una selección: se corta de la capa y queda como imagen flotante para moverla,
   * girarla o escalarla; al aplicar se fija en una capa nueva.
   */
  private async moverSeleccion(c: P, d: P): Promise<void> {
    const l = this.lienzo;
    const sel = this.seleccion;
    if (!l || !sel) return;
    const lamina = sel.extraer(l);
    if (!lamina) {
      this.info.textContent = t("No hay dibujo dentro de la selección.");
      return;
    }
    const imagen = await createImageBitmap(lamina);
    sel.borrar(l, "Mover selección");
    this.seleccion = null;
    this.colocarImagen(imagen, t("{nombre} (movido)", { nombre: l.doc.activa.nombre }), new DOMMatrix().translate(sel.rect.x0, sel.rect.y0));
    this.arrastre = { tipo: "imagen-mover", ultimo: d };
    void c;
  }

  // ── Imagen importada ──────────────────────────────────────────────────────────

  /** Copia la selección o, si no hay, la capa activa al portapapeles de Dermap (RF-33). */
  async copiar(): Promise<void> {
    if (!this.lienzo) return;
    if (this.seleccion) {
      const ok = await this.seleccion.copiar(this.lienzo);
      this.info.textContent = ok ? t("Selección copiada. Pégala con Ctrl+V en este u otro lienzo.") : t("No hay dibujo dentro de la selección.");
      return;
    }
    const ok = await copiarCapa(this.lienzo);
    this.info.textContent = ok
      ? t("Capa «{capa}» copiada. Pégala con Ctrl+V en este u otro lienzo.", { capa: this.lienzo.doc.activa.nombre })
      : t("La capa activa está vacía.");
  }

  /**
   * Pega la capa copiada como imagen flotante: en su sitio si es el mismo lienzo y centrada
   * en otro, siempre a tamaño real.
   */
  pegar(): void {
    const copia = obtenerCopia();
    if (!copia || !this.lienzo) return;
    if (this.recta) this.alternarRecta();
    const { ancho, alto } = this.lienzo.geo;
    const w = copia.rect.x1 - copia.rect.x0, h = copia.rect.y1 - copia.rect.y0;
    const matriz =
      copia.lienzoId === this.lienzo.id
        ? new DOMMatrix().translate(copia.rect.x0, copia.rect.y0)
        : new DOMMatrix().translate(Math.round((ancho - w) / 2), Math.round((alto - h) / 2));
    this.colocarImagen(copia.imagen, t("{nombre} (copia)", { nombre: copia.nombre }), matriz);
  }

  /** Coloca una imagen sobre el lienzo para moverla, escalarla y girarla antes de fijarla. */
  private voltearImagen(horizontal: boolean): void {
    if (!this.flotante) return;
    this.flotante.voltear(horizontal);
    this.pedirRepintado();
  }

  colocarImagen(imagen: ImageBitmap, nombre: string, matriz?: DOMMatrix): void {
    if (!this.lienzo) return;
    if (this.recta) this.alternarRecta();
    this.flotante = new ImagenFlotante(imagen, nombre, this.lienzo, matriz);
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
    ctx.fillStyle = "#141211";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const l = this.lienzo;
    if (!l) return;
    const { geo } = l;
    const escala = this.escalaVista();
    const visible = this.rectVisible();

    ctx.setTransform(this.vista);
    ctx.imageSmoothingQuality = "high";

    if (this.recta) {
      this.pintarRecta(ctx, escala, visible);
      this.pintarSeleccion(ctx, escala);
      this.pintarCursor(ctx, escala);
      return;
    }

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
      l.doc.componer(ctx, visible, undefined, 1 / escala);
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
    ctx.strokeStyle = "#3fb8ff";
    ctx.lineWidth = 2.5 / escala;
    ctx.stroke(geo.costura);

    this.pintarSeleccion(ctx, escala);
    if (this.flotante) this.pintarImagen(ctx);
    else this.pintarCursor(ctx, escala);
  }

  /** Vista recta: papel con cuadrícula recta, tinta desenrollada y contorno de la zona. */
  private pintarRecta(ctx: CanvasRenderingContext2D, escala: number, visible: Rect): void {
    const r = this.recta!;
    const l = this.lienzo!;
    ctx.save();
    ctx.fillStyle = COLOR_PAPEL;
    ctx.fillRect(r.margen, r.margen, r.ancho - 2 * r.margen, r.alto - 2 * r.margen);
    ctx.beginPath();
    ctx.rect(r.margen, r.margen, r.ancho - 2 * r.margen, r.alto - 2 * r.margen);
    ctx.clip();
    if (l.cuadricula) l.pintarCuadricula(ctx, 1, "rgba(120, 110, 100, 0.18)", "rgba(120, 110, 100, 0.35)", visible, 1 / escala);
    ctx.restore();
    ctx.drawImage(r.imagen, 0, 0, r.imagen.width / r.escala, r.imagen.height / r.escala);
    ctx.lineWidth = 1.5 / escala;
    ctx.strokeStyle = "#8a8f98";
    ctx.stroke(r.contorno);
    // Los bordes izquierdo y derecho son el corte: se tocan alrededor del brazo.
    ctx.strokeStyle = "#3fb8ff";
    ctx.lineWidth = 2.5 / escala;
    ctx.beginPath();
    ctx.moveTo(r.margen, r.margen);
    ctx.lineTo(r.margen, r.alto - r.margen);
    ctx.moveTo(r.ancho - r.margen, r.margen);
    ctx.lineTo(r.ancho - r.margen, r.alto - r.margen);
    ctx.stroke();
  }

  /** Lazo en curso, selección activa y vista previa de las formas. */
  private pintarSeleccion(ctx: CanvasRenderingContext2D, escala: number): void {
    const a = this.arrastre;
    let camino: Path2D | null = null;
    if (a?.tipo === "lazo" && a.puntos.length > 1) {
      camino = new Path2D();
      a.puntos.forEach((p, i) => (i ? camino!.lineTo(p.x, p.y) : camino!.moveTo(p.x, p.y)));
    } else if (a?.tipo === "forma") {
      camino = new Path2D();
      puntosDeForma(a.forma, a.a, a.b).forEach((p, i) => (i ? camino!.lineTo(p.x, p.y) : camino!.moveTo(p.x, p.y)));
    } else if (this.seleccion) {
      camino = this.seleccion.camino;
    }
    if (!camino) return;
    ctx.save();
    ctx.lineWidth = 1.5 / escala;
    ctx.setLineDash([6 / escala, 4 / escala]);
    ctx.strokeStyle = "#ffffff";
    ctx.stroke(camino);
    ctx.lineDashOffset = 6 / escala;
    ctx.strokeStyle = "#1d1b1a";
    ctx.stroke(camino);
    ctx.restore();
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
    ctx.strokeStyle = "#ff4600";
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
    if (!this.puntero || this.espacio || this.cuentagotas || this.arrastre?.tipo === "desplazar") return;
    const h = app.ajustes.herramienta;
    if (h === "relleno" || h === "lazo") return;
    if (this.mayus && this.ultimoPunto && !this.arrastre) {
      // Vista previa de la línea recta que se trazará con Mayús + clic.
      const o = this.vista.transformPoint(this.ultimoPunto);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.setLineDash([6 * window.devicePixelRatio, 4 * window.devicePixelRatio]);
      ctx.lineWidth = window.devicePixelRatio;
      ctx.strokeStyle = "rgba(255, 140, 40, 0.9)";
      ctx.beginPath();
      ctx.moveTo(o.x, o.y);
      ctx.lineTo(this.puntero.x, this.puntero.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
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

function etiqueta(texto: string, ...controles: HTMLElement[]): HTMLLabelElement {
  const l = document.createElement("label");
  l.className = "control-etiquetado";
  l.append(texto, ...controles);
  return l;
}

function valor(): HTMLElement {
  const v = document.createElement("span");
  v.className = "valor";
  return v;
}

/** Mensaje de por qué no se puede dibujar en una capa. */
function capaNoEditable(capa: { nombre: string; bloqueada: boolean }): string {
  return capa.bloqueada
    ? t("La capa «{capa}» está bloqueada.", { capa: capa.nombre })
    : t("La capa «{capa}» está oculta.", { capa: capa.nombre });
}
