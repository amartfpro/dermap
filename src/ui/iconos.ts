import {
  ArrowDown,
  ArrowUp,
  Box,
  Brush,
  Camera,
  Circle,
  ClipboardCopy,
  ClipboardPaste,
  Copy,
  createElement,
  Eraser,
  Eye,
  EyeOff,
  FileDown,
  FlipHorizontal2,
  FlipVertical2,
  Grid3x3,
  House,
  ImagePlus,
  Lasso,
  Lock,
  LockOpen,
  Maximize,
  MousePointer2,
  PaintBucket,
  Paintbrush,
  PersonStanding,
  Pipette,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  ScanLine,
  Scissors,
  Slash,
  Spline,
  Square,
  SquareDashed,
  Trash2,
  Type,
  Undo2,
  WandSparkles,
  X,
  type IconNode,
} from "lucide";

/** Iconos de Lucide (licencia ISC) usados en la interfaz. */
export const ICONOS = {
  abajo: ArrowDown,
  arriba: ArrowUp,
  caja: Box,
  pincel: Brush,
  camara: Camera,
  elipse: Circle,
  copiar: ClipboardCopy,
  pegar: ClipboardPaste,
  duplicar: Copy,
  goma: Eraser,
  ojo: Eye,
  ojoCerrado: EyeOff,
  exportar: FileDown,
  voltearH: FlipHorizontal2,
  voltearV: FlipVertical2,
  cuadricula: Grid3x3,
  inicio: House,
  imagen: ImagePlus,
  lazo: Lasso,
  candado: Lock,
  candadoAbierto: LockOpen,
  encajar: Maximize,
  seleccionar: MousePointer2,
  relleno: PaintBucket,
  pintar3d: Paintbrush,
  cuerpo: PersonStanding,
  gotero: Pipette,
  mas: Plus,
  rehacer: Redo2,
  girarIzquierda: RotateCcw,
  girarDerecha: RotateCw,
  recta: ScanLine,
  corte: Scissors,
  linea: Slash,
  curva: Spline,
  rectangulo: Square,
  zona: SquareDashed,
  borrar: Trash2,
  texto: Type,
  deshacer: Undo2,
  stencil: WandSparkles,
  cerrar: X,
} satisfies Record<string, IconNode>;

export type NombreIcono = keyof typeof ICONOS;

export function icono(nombre: NombreIcono, tamano = 16): SVGElement {
  const svg = createElement(ICONOS[nombre]);
  svg.setAttribute("width", String(tamano));
  svg.setAttribute("height", String(tamano));
  svg.setAttribute("stroke-width", "1.75");
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
