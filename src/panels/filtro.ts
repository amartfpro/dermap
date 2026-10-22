import { app } from "../estado";
import { t } from "../i18n";
import { filtrar, type ModoFiltro, type OpcionesFiltro } from "../lienzo/filtros";
import { contexto, TESELA } from "../lienzo/teselas";

/**
 * «Convertir a stencil…»: pasa la capa activa (una foto o un boceto importado) a líneas o a
 * blanco y negro, en una capa nueva con el color del pincel. La capa original se conserva.
 */
export function abrirDialogoFiltro(): void {
  const lienzo = app.activo;
  if (!lienzo) return;
  const capa = lienzo.doc.activa;
  if (!capa.teselas.size) {
    window.alert(t("La capa activa está vacía."));
    return;
  }

  // Contenido de la capa a resolución completa, recortado a sus teselas.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const clave of capa.teselas.keys()) {
    const [tx, ty] = clave.split(",").map(Number);
    x0 = Math.min(x0, tx * TESELA);
    y0 = Math.min(y0, ty * TESELA);
    x1 = Math.max(x1, (tx + 1) * TESELA);
    y1 = Math.max(y1, (ty + 1) * TESELA);
  }
  const W = x1 - x0, H = y1 - y0;
  const original = new OffscreenCanvas(W, H);
  const oc = original.getContext("2d", { willReadFrequently: true })!;
  for (const [clave, tesela] of capa.teselas) {
    const [tx, ty] = clave.split(",").map(Number);
    oc.drawImage(tesela, tx * TESELA - x0, ty * TESELA - y0);
  }
  // Copia reducida para la vista previa.
  const escala = Math.min(1, 520 / Math.max(W, H));
  const pw = Math.max(1, Math.round(W * escala)), ph = Math.max(1, Math.round(H * escala));
  const reducida = new OffscreenCanvas(pw, ph);
  const rc = reducida.getContext("2d", { willReadFrequently: true })!;
  rc.drawImage(original, 0, 0, pw, ph);
  const pixelesPrevia = rc.getImageData(0, 0, pw, ph).data;

  const fondo = document.createElement("div");
  fondo.className = "fondo-modal";
  const caja = document.createElement("form");
  caja.className = "modal modal-texto";
  fondo.append(caja);
  const titulo = document.createElement("h2");
  titulo.textContent = t("Convertir a stencil · {capa}", { capa: capa.nombre });

  const modo = document.createElement("select");
  modo.className = "desplegable";
  modo.append(new Option(t("Contornos (dibujo de líneas)"), "contornos"), new Option(t("Blanco y negro (umbral)"), "umbral"));
  const umbral = rango(0, 255, 140);
  const suavizado = rango(0, 6, 1);
  const grosor = rango(0, 4, 1);
  const previa = document.createElement("canvas");
  previa.className = "previa-texto";
  previa.width = pw;
  previa.height = ph;

  /** El suavizado y el grosor se dan en píxeles de la previa y se escalan a la imagen real. */
  const opciones = (factor: number): OpcionesFiltro => ({
    modo: modo.value as ModoFiltro,
    umbral: Number(umbral.value),
    suavizado: Number(suavizado.value) * factor,
    grosor: modo.value === "contornos" ? Number(grosor.value) * factor : 0,
    paso: factor,
  });
  const pintarMascara = (ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, m: Uint8Array, w: number, h: number) => {
    const img = ctx.createImageData(w, h);
    const [r, g, b] = [1, 3, 5].map((k) => parseInt(app.ajustes.color.slice(k, k + 2), 16));
    for (let i = 0; i < w * h; i++) {
      if (!m[i]) continue;
      img.data[4 * i] = r;
      img.data[4 * i + 1] = g;
      img.data[4 * i + 2] = b;
      img.data[4 * i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  };
  const actualizar = () => {
    grosor.disabled = modo.value !== "contornos";
    const ctx = previa.getContext("2d")!;
    const m = filtrar(pixelesPrevia, pw, ph, opciones(1));
    const capaPrevia = new OffscreenCanvas(pw, ph);
    pintarMascara(capaPrevia.getContext("2d")!, m, pw, ph);
    ctx.fillStyle = "#f4efe9";
    ctx.fillRect(0, 0, pw, ph);
    ctx.drawImage(capaPrevia, 0, 0);
  };
  for (const e of [modo, umbral, suavizado, grosor]) e.addEventListener("input", actualizar);

  const etiqueta = (texto: string, control: HTMLElement) => {
    const l = document.createElement("label");
    l.className = "campo-ficha";
    const s = document.createElement("span");
    s.textContent = texto;
    l.append(s, control);
    return l;
  };
  const filaControles = document.createElement("div");
  filaControles.className = "fila-texto";
  filaControles.append(
    etiqueta(t("Modo"), modo),
    etiqueta(t("Umbral"), umbral),
    etiqueta(t("Suavizado"), suavizado),
    etiqueta(t("Grosor de línea"), grosor),
  );
  const aplicar = document.createElement("button");
  aplicar.type = "submit";
  aplicar.className = "boton-texto primario";
  aplicar.textContent = t("Crear capa");
  const cancelar = document.createElement("button");
  cancelar.type = "button";
  cancelar.className = "boton-texto";
  cancelar.textContent = t("Cancelar");
  const estado = document.createElement("span");
  estado.className = "estado-modal";
  const pie = document.createElement("div");
  pie.className = "modal-pie";
  pie.append(estado, cancelar, aplicar);
  const nota = document.createElement("p");
  nota.className = "nota";
  nota.textContent = t("La capa original se conserva: oculta o borra la foto cuando el resultado te guste.");
  caja.append(titulo, filaControles, previa, nota, pie);
  document.body.append(fondo);
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
  caja.addEventListener("submit", (e) => {
    e.preventDefault();
    aplicar.disabled = true;
    estado.textContent = t("Procesando…");
    // Se deja pintar el mensaje antes del cálculo a resolución completa.
    setTimeout(() => {
      const datos = oc.getImageData(0, 0, W, H).data;
      const m = filtrar(datos, W, H, opciones(1 / escala));
      const resultado = new OffscreenCanvas(W, H);
      pintarMascara(resultado.getContext("2d")!, m, W, H);
      const doc = lienzo.doc;
      lienzo.historial.registrar(doc.instantaneaCapas(t("Convertir a stencil")));
      const nueva = doc.añadirCapa(t("Stencil de «{capa}»", { capa: capa.nombre }));
      for (const clave of capa.teselas.keys()) {
        const [tx, ty] = clave.split(",").map(Number);
        const tesela = nueva.obtenerOCrear(tx, ty);
        contexto(tesela).drawImage(resultado, x0 - tx * TESELA, y0 - ty * TESELA);
        nueva.sucias.add(clave);
      }
      doc.avisar({ x0, y0, x1, y1 });
      lienzo.actualizarFantasma();
      cerrar();
    }, 30);
  });
}

function rango(min: number, max: number, valor: number): HTMLInputElement {
  const r = document.createElement("input");
  r.type = "range";
  r.min = String(min);
  r.max = String(max);
  r.step = "1";
  r.value = String(valor);
  r.className = "deslizador";
  return r;
}
