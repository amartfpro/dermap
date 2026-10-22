import { t } from "../i18n";
import { icono } from "./iconos";

/** Máximo de colores guardados en la paleta. */
export const MAX_PALETA = 20;

type HSV = { h: number; s: number; v: number };

export function hexARgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbAHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, "0")).join("");
}

export function rgbAHsv(r: number, g: number, b: number): HSV {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvARgb({ h, s, v }: HSV): [number, number, number] {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

export interface OpcionesSelector {
  color: string;
  alCambiar: (color: string) => void;
  paleta: () => string[];
  guardarPaleta: (p: string[]) => void;
}

let abierto: (() => void) | null = null;

/**
 * Selector de color propio (igual en Windows y macOS): cuadro de saturación y brillo, barra
 * de tono, código hexadecimal y la paleta guardada (hasta 20 colores).
 */
export function abrirSelectorColor(ancla: HTMLElement, o: OpcionesSelector): void {
  abierto?.();
  let hsv = rgbAHsv(...hexARgb(o.color));
  const inicial = o.color;

  const caja = document.createElement("div");
  caja.className = "selector-color-popover";

  const sv = document.createElement("canvas");
  sv.className = "sv";
  sv.width = 232;
  sv.height = 150;
  const cursorSv = document.createElement("span");
  cursorSv.className = "cursor-sv";
  const zonaSv = document.createElement("div");
  zonaSv.className = "zona-sv";
  zonaSv.append(sv, cursorSv);

  const tono = document.createElement("div");
  tono.className = "barra-tono";
  const cursorTono = document.createElement("span");
  cursorTono.className = "cursor-tono";
  tono.append(cursorTono);

  const muestraNueva = document.createElement("span");
  muestraNueva.className = "muestra-grande";
  const muestraVieja = document.createElement("button");
  muestraVieja.type = "button";
  muestraVieja.className = "muestra-grande vieja";
  muestraVieja.style.background = inicial;
  muestraVieja.title = t("Volver al color anterior");
  const hex = document.createElement("input");
  hex.type = "text";
  hex.className = "hex";
  hex.maxLength = 7;
  hex.spellcheck = false;
  const filaHex = document.createElement("div");
  filaHex.className = "fila-hex";
  const muestras = document.createElement("div");
  muestras.className = "par-muestras";
  muestras.append(muestraVieja, muestraNueva);
  filaHex.append(muestras, hex);

  const cabeceraPaleta = document.createElement("div");
  cabeceraPaleta.className = "cabecera-paleta";
  const tituloPaleta = document.createElement("span");
  const guardar = document.createElement("button");
  guardar.type = "button";
  guardar.className = "boton-texto con-icono pequeno";
  guardar.append(icono("mas", 14), document.createTextNode(t("Guardar")));
  cabeceraPaleta.append(tituloPaleta, guardar);
  const rejilla = document.createElement("div");
  rejilla.className = "rejilla-paleta";
  const ayuda = document.createElement("p");
  ayuda.className = "nota";
  ayuda.textContent = t("Clic derecho en un color guardado para quitarlo.");

  caja.append(zonaSv, tono, filaHex, cabeceraPaleta, rejilla, ayuda);
  document.body.append(caja);

  const colorActual = () => rgbAHex(...hsvARgb(hsv));

  const pintarSv = () => {
    const ctx = sv.getContext("2d")!;
    const [r, g, b] = hsvARgb({ h: hsv.h, s: 1, v: 1 });
    ctx.fillStyle = rgbAHex(r, g, b);
    ctx.fillRect(0, 0, sv.width, sv.height);
    const blanco = ctx.createLinearGradient(0, 0, sv.width, 0);
    blanco.addColorStop(0, "#fff");
    blanco.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = blanco;
    ctx.fillRect(0, 0, sv.width, sv.height);
    const negro = ctx.createLinearGradient(0, 0, 0, sv.height);
    negro.addColorStop(0, "rgba(0,0,0,0)");
    negro.addColorStop(1, "#000");
    ctx.fillStyle = negro;
    ctx.fillRect(0, 0, sv.width, sv.height);
  };

  const pintarPaleta = () => {
    const p = o.paleta();
    tituloPaleta.textContent = t("Paleta ({n}/{max})", { n: p.length, max: MAX_PALETA });
    const lleno = p.length >= MAX_PALETA;
    guardar.disabled = lleno || p.includes(colorActual());
    guardar.title = lleno ? t("La paleta está llena: quita un color para guardar otro") : t("Guardar este color en la paleta");
    rejilla.replaceChildren();
    for (const c of p) {
      const m = document.createElement("button");
      m.type = "button";
      m.className = "muestra-paleta" + (c === colorActual() ? " activo" : "");
      m.style.background = c;
      m.title = c;
      m.addEventListener("click", () => fijar(c));
      m.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        o.guardarPaleta(o.paleta().filter((x) => x !== c));
        pintarPaleta();
      });
      rejilla.append(m);
    }
    for (let i = p.length; i < MAX_PALETA; i++) {
      const hueco = document.createElement("span");
      hueco.className = "muestra-paleta vacia";
      rejilla.append(hueco);
    }
  };

  const actualizar = (avisar: boolean, desdeHex = false) => {
    const c = colorActual();
    cursorSv.style.left = `${hsv.s * 100}%`;
    cursorSv.style.top = `${(1 - hsv.v) * 100}%`;
    cursorSv.style.background = c;
    cursorTono.style.left = `${(hsv.h / 360) * 100}%`;
    cursorTono.style.background = rgbAHex(...hsvARgb({ h: hsv.h, s: 1, v: 1 }));
    muestraNueva.style.background = c;
    if (!desdeHex) hex.value = c;
    pintarPaleta();
    if (avisar) o.alCambiar(c);
  };

  const fijar = (c: string) => {
    const nuevo = rgbAHsv(...hexARgb(c));
    // Con gris (sin saturación) se conserva el tono que hubiera.
    hsv = nuevo.s === 0 ? { ...nuevo, h: hsv.h } : nuevo;
    pintarSv();
    actualizar(true);
  };

  const arrastrar = (el: HTMLElement, alMover: (x: number, y: number) => void) => {
    el.addEventListener("pointerdown", (e) => {
      el.setPointerCapture(e.pointerId);
      const mover = (ev: PointerEvent) => {
        const r = el.getBoundingClientRect();
        alMover(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)));
      };
      mover(e);
      const fin = () => {
        el.removeEventListener("pointermove", mover);
        el.removeEventListener("pointerup", fin);
      };
      el.addEventListener("pointermove", mover);
      el.addEventListener("pointerup", fin);
    });
  };
  arrastrar(zonaSv, (x, y) => {
    hsv = { ...hsv, s: x, v: 1 - y };
    actualizar(true);
  });
  arrastrar(tono, (x) => {
    hsv = { ...hsv, h: Math.min(359.9, x * 360) };
    pintarSv();
    actualizar(true);
  });
  hex.addEventListener("input", () => {
    const v = hex.value.startsWith("#") ? hex.value : "#" + hex.value;
    if (/^#[0-9a-f]{6}$/i.test(v)) {
      hsv = rgbAHsv(...hexARgb(v));
      pintarSv();
      actualizar(true, true);
    }
  });
  muestraVieja.addEventListener("click", () => fijar(inicial));
  guardar.addEventListener("click", () => {
    const p = o.paleta();
    const c = colorActual();
    if (p.length < MAX_PALETA && !p.includes(c)) o.guardarPaleta([...p, c]);
    pintarPaleta();
  });

  // Posición: a la derecha del ancla (o debajo si no cabe), siempre dentro de la ventana.
  const colocar = () => {
    const r = ancla.getBoundingClientRect();
    const { width: ancho, height: alto } = caja.getBoundingClientRect();
    let x = r.right + 8, y = r.top;
    if (x + ancho > innerWidth - 8) {
      x = Math.min(r.left, innerWidth - ancho - 8);
      y = r.bottom + 6;
    }
    y = Math.min(y, innerHeight - alto - 8);
    caja.style.left = `${Math.max(8, x)}px`;
    caja.style.top = `${Math.max(8, y)}px`;
  };
  colocar();
  requestAnimationFrame(colocar);

  const cerrar = () => {
    caja.remove();
    document.removeEventListener("pointerdown", fuera, true);
    window.removeEventListener("keydown", tecla, true);
    abierto = null;
  };
  const fuera = (e: PointerEvent) => {
    if (!caja.contains(e.target as Node) && !ancla.contains(e.target as Node)) cerrar();
  };
  const tecla = (e: KeyboardEvent) => {
    if (e.key === "Escape" || (e.key === "Enter" && e.target === hex)) {
      cerrar();
      e.stopPropagation();
    } else if (caja.contains(e.target as Node)) e.stopPropagation();
  };
  document.addEventListener("pointerdown", fuera, true);
  window.addEventListener("keydown", tecla, true);
  abierto = cerrar;

  pintarSv();
  actualizar(false);
}
