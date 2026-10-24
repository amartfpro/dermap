import { desplegable } from "../ui/desplegable";
import { app } from "../estado";
import { t } from "../i18n";
import { PX_POR_MM } from "../lienzo/geometria-zona";
import { panelLienzoActual } from "./lienzo";

/**
 * Tipografías habituales en Windows y macOS (incluidas varias usadas en lettering). Solo se
 * ofrecen las instaladas; «Otra…» permite escribir cualquier nombre.
 */
const TIPOGRAFIAS = [
  "Georgia",
  "Times New Roman",
  "Palatino Linotype",
  "Palatino",
  "Book Antiqua",
  "Garamond",
  "Baskerville",
  "Didot",
  "Bodoni MT",
  "Arial",
  "Helvetica",
  "Verdana",
  "Trebuchet MS",
  "Gill Sans",
  "Futura",
  "Impact",
  "Arial Black",
  "Brush Script MT",
  "Lucida Handwriting",
  "Segoe Script",
  "Snell Roundhand",
  "Zapfino",
  "Apple Chancery",
  "Old English Text MT",
  "Copperplate",
  "Courier New",
  "Comic Sans MS",
];

/** Si una tipografía está instalada: su ancho difiere del de las genéricas de reserva. */
function instalada(nombre: string): boolean {
  const ctx = new OffscreenCanvas(10, 10).getContext("2d")!;
  const muestra = "mmmmmmmmmmlli WWW 0123";
  return ["monospace", "serif", "sans-serif"].some((reserva) => {
    ctx.font = `40px ${reserva}`;
    const a = ctx.measureText(muestra).width;
    ctx.font = `40px "${nombre}", ${reserva}`;
    return Math.abs(ctx.measureText(muestra).width - a) > 0.5;
  });
}

interface OpcionesTexto {
  texto: string;
  tipografia: string;
  /** Altura de las mayúsculas, en mm sobre la piel. */
  alturaMm: number;
  negrita: boolean;
  cursiva: boolean;
  interlineado: number;
  alineacion: CanvasTextAlign;
  color: string;
}

/** Dibuja el texto a 300 ppp, recortado a su tinta. */
export function renderizarTexto(o: OpcionesTexto): OffscreenCanvas | null {
  const lineas = o.texto.split("\n");
  if (!o.texto.trim()) return null;
  const medida = new OffscreenCanvas(10, 10).getContext("2d")!;
  // El tamaño de letra se ajusta para que la «H» mida la altura pedida.
  const fuente = (px: number) => `${o.cursiva ? "italic " : ""}${o.negrita ? "bold " : ""}${px}px "${o.tipografia}", serif`;
  medida.font = fuente(200);
  const m = medida.measureText("H");
  const alturaH = m.actualBoundingBoxAscent || 140;
  const px = (o.alturaMm * PX_POR_MM * 200) / alturaH;
  medida.font = fuente(px);
  const anchos = lineas.map((l) => medida.measureText(l).width);
  const ancho = Math.max(...anchos, 1);
  const salto = px * o.interlineado;
  const margen = Math.ceil(px * 0.6);
  const W = Math.ceil(ancho + 2 * margen);
  const H = Math.ceil(salto * (lineas.length - 1) + px * 1.4 + 2 * margen);
  if (W * H > 12000 * 12000) return null;
  const lamina = new OffscreenCanvas(W, H);
  const ctx = lamina.getContext("2d", { willReadFrequently: true })!;
  ctx.font = fuente(px);
  ctx.fillStyle = o.color;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = o.alineacion;
  const x = o.alineacion === "center" ? W / 2 : o.alineacion === "right" ? W - margen : margen;
  lineas.forEach((l, i) => ctx.fillText(l, x, margen + px + i * salto));
  // Recorte a la tinta.
  const datos = ctx.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++)
    for (let xx = 0; xx < W; xx++)
      if (datos[4 * (y * W + xx) + 3] > 8) {
        if (xx < x0) x0 = xx;
        if (xx > x1) x1 = xx;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  const recorte = new OffscreenCanvas(x1 - x0 + 3, y1 - y0 + 3);
  recorte.getContext("2d")!.drawImage(lamina, -x0 + 1, -y0 + 1);
  return recorte;
}

/** Diálogo «Texto…»: escribe, elige tipografía y tamaño real, y lo coloca en el lienzo. */
export function abrirDialogoTexto(): void {
  const panel = panelLienzoActual();
  const lienzo = app.activo;
  if (!panel || !lienzo) return;

  const fondo = document.createElement("div");
  fondo.className = "fondo-modal";
  const caja = document.createElement("form");
  caja.className = "modal modal-texto";
  fondo.append(caja);
  const titulo = document.createElement("h2");
  titulo.textContent = t("Texto");

  const area = document.createElement("textarea");
  area.rows = 3;
  area.placeholder = t("Escribe el texto (Intro para una línea nueva)");
  area.value = sessionStorageLeer() ?? "";

  const disponibles = TIPOGRAFIAS.filter(instalada);
  const tipografia = desplegable([
    ...disponibles.map((f) => ({ valor: f, texto: f, fuente: `"${f}"` })),
    { valor: "__otra__", texto: t("Otra…") },
  ]);
  const otra = document.createElement("input");
  otra.type = "text";
  otra.placeholder = t("Nombre de la tipografía instalada");
  otra.hidden = true;

  const altura = numero(8, 1, 200, 0.5);
  const interlineado = numero(1.2, 0.6, 3, 0.05);
  const negrita = casilla(t("Negrita"));
  const cursiva = casilla(t("Cursiva"));
  const alineacion = desplegable(
    [
      { valor: "left", texto: t("Izquierda") },
      { valor: "center", texto: t("Centro") },
      { valor: "right", texto: t("Derecha") },
    ],
    "center",
  );

  const previa = document.createElement("canvas");
  previa.className = "previa-texto";
  previa.width = 520;
  previa.height = 180;
  const info = document.createElement("p");
  info.className = "nota";

  const opciones = (): OpcionesTexto => ({
    texto: area.value,
    tipografia: tipografia.value === "__otra__" ? otra.value.trim() || "serif" : tipografia.value,
    alturaMm: Math.max(1, Number(altura.value) || 8),
    negrita: negrita.querySelector("input")!.checked,
    cursiva: cursiva.querySelector("input")!.checked,
    interlineado: Number(interlineado.value) || 1.2,
    alineacion: alineacion.value as CanvasTextAlign,
    color: app.ajustes.color,
  });
  const actualizar = () => {
    otra.hidden = tipografia.value !== "__otra__";
    const ctx = previa.getContext("2d")!;
    ctx.fillStyle = "#f4efe9";
    ctx.fillRect(0, 0, previa.width, previa.height);
    const img = renderizarTexto(opciones());
    if (!img) {
      info.textContent = "";
      return;
    }
    const k = Math.min((previa.width - 20) / img.width, (previa.height - 20) / img.height, 1);
    ctx.drawImage(img, (previa.width - img.width * k) / 2, (previa.height - img.height * k) / 2, img.width * k, img.height * k);
    info.textContent = t("Tamaño en la piel: {ancho} × {alto} cm", {
      ancho: (img.width / PX_POR_MM / 10).toFixed(1),
      alto: (img.height / PX_POR_MM / 10).toFixed(1),
    });
  };
  for (const e of [area, tipografia, otra, altura, interlineado, alineacion, negrita, cursiva]) e.addEventListener("input", actualizar);

  const fila = (...hijos: HTMLElement[]) => {
    const d = document.createElement("div");
    d.className = "fila-texto";
    d.append(...hijos);
    return d;
  };
  const etiqueta = (texto: string, control: HTMLElement) => {
    const l = document.createElement("label");
    l.className = "campo-ficha";
    const s = document.createElement("span");
    s.textContent = texto;
    l.append(s, control);
    return l;
  };

  const colocar = document.createElement("button");
  colocar.type = "submit";
  colocar.className = "boton-texto primario";
  colocar.textContent = t("Colocar en el lienzo");
  const cancelar = document.createElement("button");
  cancelar.type = "button";
  cancelar.className = "boton-texto";
  cancelar.textContent = t("Cancelar");
  const pie = document.createElement("div");
  pie.className = "modal-pie";
  pie.append(cancelar, colocar);

  caja.append(
    titulo,
    area,
    fila(etiqueta(t("Tipografía"), tipografia), otra),
    fila(etiqueta(t("Altura de las mayúsculas (mm)"), altura), etiqueta(t("Interlineado"), interlineado), etiqueta(t("Alineación"), alineacion)),
    fila(negrita, cursiva),
    previa,
    info,
    pie,
  );
  document.body.append(fondo);
  area.focus();
  actualizar();

  const cerrar = () => {
    fondo.remove();
    window.removeEventListener("keydown", alTecla, true);
  };
  const alTecla = (e: KeyboardEvent) => {
    if (e.key === "Escape") cerrar();
    e.stopPropagation();
  };
  window.addEventListener("keydown", alTecla, true);
  cancelar.addEventListener("click", cerrar);
  fondo.addEventListener("mousedown", (e) => {
    if (e.target === fondo) cerrar();
  });
  caja.addEventListener("submit", async (e) => {
    e.preventDefault();
    const o = opciones();
    const img = renderizarTexto(o);
    if (!img) return;
    sessionStorageGuardar(o.texto);
    const bitmap = await createImageBitmap(img);
    const { ancho, alto } = lienzo.geo;
    // A tamaño real y centrado; se puede mover, girar o escalar antes de aplicar.
    panel.colocarImagen(
      bitmap,
      t("Texto «{texto}»", { texto: o.texto.split("\n")[0].slice(0, 24) }),
      new DOMMatrix().translate(Math.round((ancho - img.width) / 2), Math.round((alto - img.height) / 2)),
    );
    cerrar();
  });
}

function numero(valor: number, min: number, max: number, paso: number): HTMLInputElement {
  const e = document.createElement("input");
  e.type = "number";
  e.value = String(valor);
  e.min = String(min);
  e.max = String(max);
  e.step = String(paso);
  e.className = "numero";
  return e;
}

function casilla(texto: string): HTMLLabelElement {
  const l = document.createElement("label");
  l.className = "casilla";
  const c = document.createElement("input");
  c.type = "checkbox";
  l.append(c, " ", texto);
  return l;
}

/** El último texto escrito se recuerda durante la sesión. */
function sessionStorageLeer(): string | null {
  try {
    return sessionStorage.getItem("dermap.texto");
  } catch {
    return null;
  }
}

function sessionStorageGuardar(texto: string): void {
  try {
    sessionStorage.setItem("dermap.texto", texto);
  } catch {
    // Sin almacenamiento de sesión.
  }
}
