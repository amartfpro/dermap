import { DATOS_ICONOS } from "./iconos-datos";

/** Iconos de Lucide (licencia ISC) usados en la interfaz, incluidos en el código (sin dependencia). */
export const ICONOS = DATOS_ICONOS;

export type NombreIcono = keyof typeof ICONOS;

const SVG = "http://www.w3.org/2000/svg";

export function icono(nombre: NombreIcono, tamano = 16): SVGElement {
  const svg = document.createElementNS(SVG, "svg");
  for (const [k, v] of Object.entries({
    width: String(tamano),
    height: String(tamano),
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.75",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  }))
    svg.setAttribute(k, v);
  for (const [etiqueta, atributos] of ICONOS[nombre]) {
    const el = document.createElementNS(SVG, etiqueta);
    for (const [k, v] of Object.entries(atributos)) el.setAttribute(k, v);
    svg.append(el);
  }
  svg.classList.add("ico");
  return svg;
}

/**
 * Botón con icono. Con `texto`, el texto va al lado del icono; sin él, el botón es cuadrado
 * y el título (con su atajo) sale al pasar el ratón.
 */
export function botonIcono(nombre: NombreIcono, titulo: string, alPulsar: () => void, opciones: { texto?: string; clase?: string } = {}): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `boton-texto ${opciones.texto ? "con-icono" : "solo-icono"} ${opciones.clase ?? ""}`.trim();
  b.title = titulo;
  b.setAttribute("aria-label", titulo);
  b.append(icono(nombre));
  if (opciones.texto) {
    const s = document.createElement("span");
    s.textContent = opciones.texto;
    b.append(s);
  }
  b.addEventListener("click", alPulsar);
  return b;
}

/** Grupo de controles con un título pequeño encima (organiza las barras por función). */
export function seccion(titulo: string, ...hijos: HTMLElement[]): HTMLElement {
  const s = document.createElement("div");
  s.className = "seccion";
  const tt = document.createElement("span");
  tt.className = "titulo-seccion";
  tt.textContent = titulo;
  const fila = document.createElement("div");
  fila.className = "fila-seccion";
  fila.append(...hijos);
  s.append(tt, fila);
  return s;
}

/** Botones pegados como un control segmentado. */
export function segmentado(...hijos: HTMLElement[]): HTMLElement {
  const d = document.createElement("div");
  d.className = "segmentado";
  d.append(...hijos);
  return d;
}
