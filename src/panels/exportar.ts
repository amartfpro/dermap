import { exportarStencil, planificar, rectContenido, type OpcionesStencil } from "../exportar/stencil";
import { guardarExportacion } from "../exportar/guardar";
import { PX_POR_MM } from "../lienzo/geometria-zona";
import type { Lienzo } from "../lienzo/lienzo";
import { contexto, crearLamina } from "../lienzo/teselas";

/**
 * Diálogo «Exportar stencil»: capas a incluir (RF-54), modo para impresora térmica, formato
 * (PDF A4 en piezas o PNG) y una vista previa con el reparto en hojas (RF-50, RF-51).
 */
export function abrirDialogoExportar(lienzo: Lienzo): void {
  const fondo = document.createElement("div");
  fondo.className = "fondo-modal";
  const caja = document.createElement("div");
  caja.className = "modal";
  fondo.append(caja);

  const opciones: OpcionesStencil = {
    capas: new Set(lienzo.doc.capas.filter((c) => c.enStencil && c.visible).map((c) => c.id)),
    soloLineas: true,
    contorno: true,
    formato: "pdf",
  };

  const titulo = document.createElement("h2");
  titulo.textContent = `Exportar stencil · ${lienzo.nombre}`;

  const columnas = document.createElement("div");
  columnas.className = "modal-columnas";
  const izquierda = document.createElement("div");
  izquierda.className = "modal-opciones";
  const derecha = document.createElement("div");
  derecha.className = "modal-previa";
  columnas.append(izquierda, derecha);

  // Capas (de arriba abajo, como en el panel).
  const capas = seccion("Capas");
  for (const capa of [...lienzo.doc.capas].reverse()) {
    capas.append(
      casilla(capa.nombre, opciones.capas.has(capa.id), (v) => {
        if (v) opciones.capas.add(capa.id);
        else opciones.capas.delete(capa.id);
        actualizar();
      }),
    );
  }
  const modo = seccion("Impresión");
  modo.append(
    casilla("Solo líneas en negro (impresora térmica)", opciones.soloLineas, (v) => {
      opciones.soloLineas = v;
      actualizar();
    }),
    casilla("Marcar contorno y corte (para unir piezas)", opciones.contorno, (v) => {
      opciones.contorno = v;
      actualizar();
    }),
  );
  const formato = seccion("Formato");
  formato.append(
    radio("formato", "PDF A4 a escala real (en piezas si no cabe)", true, () => {
      opciones.formato = "pdf";
      actualizar();
    }),
    radio("formato", "PNG a 300 ppp (una sola imagen)", false, () => {
      opciones.formato = "png";
      actualizar();
    }),
  );
  izquierda.append(capas, modo, formato);

  const lienzoPrevia = document.createElement("canvas");
  const resumen = document.createElement("p");
  resumen.className = "resumen";
  derecha.append(lienzoPrevia, resumen);

  const estado = document.createElement("span");
  estado.className = "estado-modal";
  const exportar = document.createElement("button");
  exportar.className = "boton-texto primario";
  exportar.textContent = "Exportar…";
  const cancelar = document.createElement("button");
  cancelar.className = "boton-texto";
  cancelar.textContent = "Cerrar";
  const pie = document.createElement("div");
  pie.className = "modal-pie";
  pie.append(estado, cancelar, exportar);

  caja.append(titulo, columnas, pie);
  document.body.append(fondo);

  const cerrar = () => {
    fondo.remove();
    window.removeEventListener("keydown", alTecla);
  };
  const alTecla = (e: KeyboardEvent) => {
    if (e.key === "Escape") cerrar();
  };
  window.addEventListener("keydown", alTecla);
  cancelar.addEventListener("click", cerrar);
  fondo.addEventListener("click", (e) => {
    if (e.target === fondo) cerrar();
  });

  exportar.addEventListener("click", async () => {
    if (opciones.capas.size === 0) {
      estado.textContent = "Elige al menos una capa.";
      return;
    }
    exportar.disabled = true;
    try {
      const r = await exportarStencil(lienzo, opciones, (t) => (estado.textContent = t));
      const ruta = await guardarExportacion(r.bytes, `${lienzo.nombre} - stencil`, {
        descripcion: r.extension === "pdf" ? "PDF" : "Imagen PNG",
        extension: r.extension,
        mime: r.extension === "pdf" ? "application/pdf" : "image/png",
      });
      estado.textContent = ruta ? `Guardado: ${ruta}` : "Exportación cancelada.";
    } catch (error) {
      estado.textContent = `No se pudo exportar: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      exportar.disabled = false;
    }
  });

  function actualizar(): void {
    const rect = rectContenido(lienzo, opciones.capas);
    const plan = planificar(rect);
    const anchoCm = (rect.x1 - rect.x0) / PX_POR_MM / 10;
    const altoCm = (rect.y1 - rect.y0) / PX_POR_MM / 10;
    resumen.textContent =
      `${anchoCm.toFixed(1)} × ${altoCm.toFixed(1)} cm` +
      (opciones.formato === "pdf"
        ? ` · ${plan.piezas.length === 1 ? "1 hoja A4" : `${plan.piezas.length} hojas A4`} ` +
          `${plan.apaisado ? "apaisada" : "vertical"}${plan.piezas.length === 1 ? "" : "s"}` +
          (plan.piezas.length > 1 ? ", con 1 cm de solape" : "")
        : " · 300 ppp");

    // Vista previa a baja resolución, con el reparto en hojas encima.
    const lado = 420;
    const escala = Math.min(lado / (rect.x1 - rect.x0), lado / (rect.y1 - rect.y0));
    const w = Math.max(1, Math.round((rect.x1 - rect.x0) * escala));
    const h = Math.max(1, Math.round((rect.y1 - rect.y0) * escala));
    lienzoPrevia.width = w;
    lienzoPrevia.height = h;
    const ctx = lienzoPrevia.getContext("2d")!;
    const temporal = crearLamina(w, h);
    const t = contexto(temporal);
    t.fillStyle = "#fff";
    t.fillRect(0, 0, w, h);
    t.setTransform(escala, 0, 0, escala, -rect.x0 * escala, -rect.y0 * escala);
    t.save();
    t.clip(lienzo.geo.recorte);
    t.imageSmoothingQuality = "high";
    lienzo.doc.componer(t, rect, (c) => opciones.capas.has(c.id));
    t.restore();
    if (opciones.soloLineas) {
      t.setTransform(1, 0, 0, 1, 0, 0);
      const img = t.getImageData(0, 0, w, h);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2] < 128 ? 0 : 255;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      }
      t.putImageData(img, 0, 0);
      t.setTransform(escala, 0, 0, escala, -rect.x0 * escala, -rect.y0 * escala);
    }
    if (opciones.contorno) {
      t.strokeStyle = "#000";
      t.lineWidth = 1 / escala;
      t.setLineDash([4 / escala, 3 / escala]);
      t.stroke(lienzo.geo.contorno);
      t.stroke(lienzo.geo.costura);
    }
    ctx.drawImage(temporal, 0, 0);
    if (opciones.formato === "pdf" && plan.piezas.length > 1) {
      ctx.strokeStyle = "rgba(217, 119, 75, 0.9)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillStyle = "rgba(217, 119, 75, 1)";
      plan.piezas.forEach((p, i) => {
        const x = (p.rect.x0 - rect.x0) * escala;
        const y = (p.rect.y0 - rect.y0) * escala;
        ctx.strokeRect(x + 1, y + 1, (p.rect.x1 - p.rect.x0) * escala - 2, (p.rect.y1 - p.rect.y0) * escala - 2);
        ctx.fillText(String(i + 1), x + 6, y + 16);
      });
    }
  }

  actualizar();
  exportar.focus();
}

function seccion(texto: string): HTMLFieldSetElement {
  const f = document.createElement("fieldset");
  const l = document.createElement("legend");
  l.textContent = texto;
  f.append(l);
  return f;
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

function radio(grupo: string, texto: string, inicial: boolean, alElegir: () => void): HTMLLabelElement {
  const etiqueta = document.createElement("label");
  etiqueta.className = "interruptor";
  const r = document.createElement("input");
  r.type = "radio";
  r.name = grupo;
  r.checked = inicial;
  r.addEventListener("change", () => r.checked && alElegir());
  etiqueta.append(r, ` ${texto}`);
  return etiqueta;
}
