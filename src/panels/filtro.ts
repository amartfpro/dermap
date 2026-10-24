import { desplegable } from "../ui/desplegable";
import { botonIcono } from "../ui/iconos";
import { app } from "../estado";
import { t } from "../i18n";
import { filtrar, type ModoFiltro, type OpcionesFiltro } from "../lienzo/filtros";
import { cajaDelDibujo } from "../lienzo/transformar";
import { contexto, desdeClave, teselasEn, TESELA } from "../lienzo/teselas";

/** Lado mayor de la vista previa, en píxeles (a más, más fiel y más lenta). */
const LADO_PREVIA = 1400;

/**
 * «Convertir a stencil…»: pasa la capa activa (una foto o un boceto importado) a líneas o a
 * blanco y negro, en una capa nueva con el color del pincel, encima de la original.
 *
 * Las medidas van en milímetros reales del lienzo (detalle, grosor de línea, manchas), así la
 * vista previa reducida y el resultado a resolución completa dan el mismo dibujo. La vista
 * previa se puede acercar (rueda), mover (arrastrar) y comparar con el original.
 */
export function abrirDialogoFiltro(): void {
  const lienzo = app.activo;
  if (!lienzo) return;
  const capa = lienzo.doc.activa;
  const caja = cajaDelDibujo([capa]);
  if (!caja) {
    window.alert(t("La capa activa está vacía."));
    return;
  }
  const pxPorMm = lienzo.doc.pxPorMm;

  // Contenido de la capa a resolución completa, recortado a su dibujo.
  const { x0, y0 } = caja;
  const W = caja.x1 - caja.x0, H = caja.y1 - caja.y0;
  const original = new OffscreenCanvas(W, H);
  const oc = original.getContext("2d", { willReadFrequently: true })!;
  for (const [clave, tesela] of capa.teselas) {
    const [tx, ty] = desdeClave(clave);
    oc.drawImage(tesela, tx * TESELA - x0, ty * TESELA - y0);
  }
  // Copia reducida para la vista previa.
  const escala = Math.min(1, LADO_PREVIA / Math.max(W, H));
  const pw = Math.max(1, Math.round(W * escala)), ph = Math.max(1, Math.round(H * escala));
  const reducida = new OffscreenCanvas(pw, ph);
  const rc = reducida.getContext("2d", { willReadFrequently: true })!;
  rc.imageSmoothingQuality = "high";
  rc.drawImage(original, 0, 0, pw, ph);
  const pixelesPrevia = rc.getImageData(0, 0, pw, ph).data;

  // ── Controles ──
  const modo = desplegable(
    [
      { valor: "lineas", texto: t("Líneas (como un dibujo a lápiz)") },
      { valor: "umbral", texto: t("Blanco y negro") },
    ],
    "lineas",
    t("Modo"),
  );
  const valores = { intensidad: 50, detalle: 0.4, grosor: 0, manchas: 0.3, radioLocal: 6 };
  /** Fila con nombre, valor y deslizador (las medidas se recalculan al moverlo). */
  const campo = (
    clave: keyof typeof valores,
    nombre: string,
    ayuda: string,
    min: number,
    max: number,
    texto: (v: number) => string,
  ) => {
    const el = document.createElement("label");
    el.className = "fila-filtro";
    el.title = ayuda;
    const cab = document.createElement("span");
    cab.className = "cabecera-filtro";
    const n = document.createElement("span");
    n.textContent = nombre;
    const v = document.createElement("span");
    v.className = "valor-filtro";
    v.textContent = texto(valores[clave]);
    cab.append(n, v);
    const r = document.createElement("input");
    r.type = "range";
    r.className = "deslizador";
    r.min = String(min);
    r.max = String(max);
    r.step = String((max - min) / 200);
    r.value = String(valores[clave]);
    r.addEventListener("input", () => {
      valores[clave] = Number(r.value);
      v.textContent = texto(valores[clave]);
      programar();
    });
    el.append(cab, r);
    return { el };
  };
  const mm = (v: number) => `${v.toFixed(v < 1 ? 2 : 1)} mm`;
  const intensidad = campo("intensidad", t("Intensidad"), t("Cuánto se marca: más, más tinta"), 0, 100, (v) => `${Math.round(v)} %`);
  const detalle = campo("detalle", t("Detalle"), t("Tamaño de lo que se convierte en línea: pequeño para detalles finos, grande para formas"), 0.1, 3, mm);
  const grosor = campo("grosor", t("Grosor de línea"), t("Engorda las líneas (en mm reales)"), 0, 1.5, mm);
  const manchas = campo("manchas", t("Quitar manchas"), t("Borra puntitos y manchas sueltas de menos de este tamaño (mm²)"), 0, 4, (v) => `${v.toFixed(1)} mm²`);
  const radioLocal = campo("radioLocal", t("Entorno"), t("Tamaño de la zona con la que se compara cada punto (mm)"), 1, 20, mm);
  const interruptor = (texto: string, ayuda: string, marcado: boolean) => {
    const l = document.createElement("label");
    l.className = "casilla con-conmutador";
    l.title = ayuda;
    const c = document.createElement("input");
    c.type = "checkbox";
    c.className = "conmutador";
    c.setAttribute("role", "switch");
    c.checked = marcado;
    l.append(c, texto);
    return { el: l, casilla: c };
  };
  const adaptativo = interruptor(t("Ajuste local"), t("Para fotos con luz desigual o lápiz sobre papel con sombras"), true);
  const ocultarOriginal = interruptor(t("Ocultar la capa original"), t("Al crear la capa del stencil, oculta la foto o el boceto de origen"), true);
  const verOriginal = interruptor(t("Ver el original debajo"), t("Muestra la foto o el boceto atenuado bajo el resultado, para comparar"), false);

  const fila = (texto: string, control: HTMLElement) => {
    const l = document.createElement("div");
    l.className = "fila-filtro";
    const s = document.createElement("span");
    s.className = "cabecera-filtro";
    s.textContent = texto;
    l.append(s, control);
    return l;
  };
  const filaRadio = radioLocal.el;
  const filaGrosor = grosor.el;
  const filaAdaptativo = adaptativo.el as HTMLElement;

  // ── Vista previa con zoom y desplazamiento ──
  const visor = document.createElement("div");
  visor.className = "visor-filtro";
  const lienzoPrevia = document.createElement("canvas");
  lienzoPrevia.width = pw;
  lienzoPrevia.height = ph;
  visor.append(lienzoPrevia);
  let zoom = 1, px = 0, py = 0;
  const aplicarVista = () => {
    lienzoPrevia.style.transform = `translate(${px}px, ${py}px) scale(${zoom})`;
    etiquetaZoom.textContent = `${Math.round(zoom * escala * 100)} %`;
  };
  const encajar = () => {
    const r = visor.getBoundingClientRect();
    zoom = Math.min((r.width - 24) / pw, (r.height - 24) / ph);
    px = (r.width - pw * zoom) / 2;
    py = (r.height - ph * zoom) / 2;
    aplicarVista();
  };
  /** Zoom alrededor de un punto del visor. */
  const acercar = (factor: number, cx: number, cy: number) => {
    const nuevo = Math.min(16 / escala, Math.max(0.05, zoom * factor));
    px = cx - ((cx - px) * nuevo) / zoom;
    py = cy - ((cy - py) * nuevo) / zoom;
    zoom = nuevo;
    aplicarVista();
  };
  visor.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = visor.getBoundingClientRect();
    acercar(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  });
  visor.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    visor.setPointerCapture(e.pointerId);
    visor.classList.add("moviendo");
    let ux = e.clientX, uy = e.clientY;
    const mover = (ev: PointerEvent) => {
      px += ev.clientX - ux;
      py += ev.clientY - uy;
      ux = ev.clientX;
      uy = ev.clientY;
      aplicarVista();
    };
    const soltar = () => {
      visor.classList.remove("moviendo");
      visor.removeEventListener("pointermove", mover);
      visor.removeEventListener("pointerup", soltar);
    };
    visor.addEventListener("pointermove", mover);
    visor.addEventListener("pointerup", soltar);
  });
  visor.addEventListener("dblclick", encajar);
  const etiquetaZoom = document.createElement("span");
  etiquetaZoom.className = "zoom-filtro";
  const centroVisor = () => {
    const r = visor.getBoundingClientRect();
    return [r.width / 2, r.height / 2] as const;
  };
  const barraVisor = document.createElement("div");
  barraVisor.className = "barra-visor-filtro";
  barraVisor.append(
    botonIcono("menos", t("Alejar"), () => acercar(1 / 1.25, ...centroVisor())),
    etiquetaZoom,
    botonIcono("mas", t("Acercar"), () => acercar(1.25, ...centroVisor())),
    botonIcono("encajar", t("Encajar (doble clic)"), encajar),
    botonIcono("recta", t("Tamaño real de los píxeles (100 %)"), () => {
      const [cx, cy] = centroVisor();
      acercar(1 / escala / zoom, cx, cy);
    }),
  );

  // ── Cálculo ──
  /** Opciones del filtro con las medidas en píxeles de una imagen a `e` veces la resolución del lienzo. */
  const opciones = (e: number): OpcionesFiltro => {
    const px = (v: number) => v * pxPorMm * e;
    return {
      modo: modo.value as ModoFiltro,
      intensidad: valores.intensidad,
      suavizado: px(valores.detalle),
      grosor: modo.value === "lineas" ? px(valores.grosor) : 0,
      adaptativo: adaptativo.casilla.checked,
      radioLocal: px(valores.radioLocal),
      manchas: valores.manchas * px(1) * px(1),
    };
  };
  const [r, g, b] = [1, 3, 5].map((k) => parseInt(app.ajustes.color.slice(k, k + 2), 16));
  const pintarMascara = (ctx: OffscreenCanvasRenderingContext2D, m: Uint8Array, w: number, h: number) => {
    const img = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      if (!m[i]) continue;
      img.data[4 * i] = r;
      img.data[4 * i + 1] = g;
      img.data[4 * i + 2] = b;
      img.data[4 * i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  };
  const resultadoPrevia = new OffscreenCanvas(pw, ph);
  const actualizar = () => {
    const lineas = modo.value === "lineas";
    filaGrosor.hidden = !lineas;
    filaAdaptativo.hidden = lineas;
    filaRadio.hidden = lineas || !adaptativo.casilla.checked;
    const m = filtrar(pixelesPrevia, pw, ph, opciones(escala));
    pintarMascara(resultadoPrevia.getContext("2d")!, m, pw, ph);
    const ctx = lienzoPrevia.getContext("2d")!;
    ctx.fillStyle = "#f4efe9";
    ctx.fillRect(0, 0, pw, ph);
    if (verOriginal.casilla.checked) {
      ctx.globalAlpha = 0.3;
      ctx.drawImage(reducida, 0, 0);
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(resultadoPrevia, 0, 0);
  };
  // Se recalcula como mucho una vez por fotograma mientras se arrastran los deslizadores.
  let pendiente = false;
  const programar = () => {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(() => {
      pendiente = false;
      actualizar();
    });
  };
  for (const e of [modo, adaptativo.casilla, verOriginal.casilla]) e.addEventListener("change", programar);

  // ── Ventana ──
  const fondo = document.createElement("div");
  fondo.className = "fondo-modal";
  const ventana = document.createElement("form");
  ventana.className = "modal modal-filtro";
  fondo.append(ventana);
  const titulo = document.createElement("h2");
  titulo.textContent = t("Convertir a stencil · {capa}", { capa: capa.nombre });
  const controles = document.createElement("div");
  controles.className = "controles-filtro";
  const nota = document.createElement("p");
  nota.className = "nota";
  nota.textContent = t(
    "Se crea una capa nueva encima con el color del pincel; la original se conserva. «Líneas» saca el trazo de fotos y bocetos; «Blanco y negro», las zonas oscuras.",
  );
  controles.append(
    fila(t("Modo"), modo),
    intensidad.el,
    detalle.el,
    filaGrosor,
    filaAdaptativo,
    filaRadio,
    manchas.el,
    verOriginal.el,
    nota,
  );
  const derecha = document.createElement("div");
  derecha.className = "previa-filtro";
  derecha.append(visor, barraVisor);

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
  pie.append(ocultarOriginal.el, estado, cancelar, aplicar);
  ventana.append(titulo, controles, derecha, pie);
  document.body.append(fondo);
  actualizar();
  requestAnimationFrame(encajar);

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
  ventana.addEventListener("submit", (e) => {
    e.preventDefault();
    aplicar.disabled = true;
    estado.textContent = t("Procesando a resolución completa…");
    // Se deja pintar el mensaje antes del cálculo a resolución completa.
    setTimeout(() => {
      const datos = oc.getImageData(0, 0, W, H).data;
      const m = filtrar(datos, W, H, opciones(1));
      const resultado = new OffscreenCanvas(W, H);
      pintarMascara(resultado.getContext("2d")!, m, W, H);
      const doc = lienzo.doc;
      lienzo.historial.registrar(doc.instantaneaCapas(t("Convertir a stencil")));
      const nueva = doc.añadirCapa(t("Stencil de «{capa}»", { capa: capa.nombre }), capa);
      for (const [tx, ty] of teselasEn(caja, doc.ancho, doc.alto)) {
        const tesela = nueva.obtenerOCrear(tx, ty);
        contexto(tesela).drawImage(resultado, x0 - tx * TESELA, y0 - ty * TESELA);
        nueva.sucias.add(`${tx},${ty}`);
      }
      if (ocultarOriginal.casilla.checked) doc.cambiarCapa(capa, { visible: false });
      doc.avisar(caja);
      lienzo.actualizarFantasma();
      cerrar();
    }, 30);
  });
}
