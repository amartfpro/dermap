import { t } from "../i18n";
import type { IContentRenderer } from "dockview-core";
import { app } from "../estado";
import { MODOS_FUSION, nuevoId, type Capa, type ModoFusion } from "../lienzo/capa";
import type { Lienzo } from "../lienzo/lienzo";
import { simetriaActual } from "../geometria/simetria";
import { transferirDibujo } from "../lienzo/transferir";
import { abrirDialogoTexto } from "./texto";
import { abrirDialogoFiltro } from "./filtro";
import { panelLienzoActual } from "./lienzo";
import { botonIcono, icono, seccion, segmentado, type NombreIcono } from "../ui/iconos";

/**
 * Capas del lienzo activo (RF-31): crear, duplicar, eliminar, reordenar, ocultar, bloquear,
 * opacidad y modo de fusión. También importa imágenes PNG/JPG como capa nueva (RF-33).
 * Todos los cambios de estructura se pueden deshacer.
 */
export class PanelCapas implements IContentRenderer {
  readonly element: HTMLElement;
  private lista: HTMLUListElement;
  private propiedades: HTMLElement;
  private lienzo: Lienzo | null = null;
  private arrastrada: Capa | null = null;
  private alCambiarActivo = () => this.mostrar(app.activo);
  private alCambiarCapas = () => this.pintar();

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "panel panel-capas";

    const barra = document.createElement("div");
    barra.className = "herramientas envolver";
    const archivo = document.createElement("input");
    archivo.type = "file";
    archivo.accept = "image/png,image/jpeg";
    archivo.hidden = true;
    archivo.addEventListener("change", () => {
      const f = archivo.files?.[0];
      archivo.value = "";
      if (f) void this.importar(f);
    });
    const traer = this.selectorTraer();
    barra.append(
      seccion(
        t("Añadir"),
        segmentado(
          botonIcono("mas", t("Nueva capa (Ctrl+Mayús+N)"), () => this.nueva()),
          botonIcono("imagen", t("Importar un PNG o JPG como capa nueva"), () => archivo.click()),
          botonIcono("texto", t("Escribir un texto (lettering) con tipografía y tamaño real (T)"), () => abrirDialogoTexto()),
        ),
      ),
      seccion(
        t("Capa"),
        segmentado(
          botonIcono("duplicar", t("Duplicar la capa activa (Ctrl+J)"), () => this.duplicar()),
          botonIcono("arriba", t("Subir la capa (Alt+↑)"), () => this.mover(1)),
          botonIcono("abajo", t("Bajar la capa (Alt+↓)"), () => this.mover(-1)),
          botonIcono("borrar", t("Eliminar la capa activa"), () => this.eliminar(), { clase: "peligro" }),
        ),
      ),
      seccion(
        t("Portapapeles"),
        segmentado(
          botonIcono("copiar", t("Copiar la capa activa (Ctrl+C)"), () => void panelLienzoActual()?.copiar()),
          botonIcono("pegar", t("Pegar la capa copiada, en este u otro lienzo (Ctrl+V)"), () => panelLienzoActual()?.pegar()),
        ),
      ),
      seccion(
        t("Convertir"),
        botonIcono("stencil", t("Convertir la capa activa (una foto o un boceto) en líneas o en blanco y negro"), () => abrirDialogoFiltro(), {
          texto: t("A stencil…"),
        }),
        traer,
      ),
      archivo,
    );

    this.propiedades = document.createElement("div");
    this.propiedades.className = "propiedades-capa";

    this.lista = document.createElement("ul");
    this.lista.className = "lista-capas";

    this.element.append(barra, this.lista, this.propiedades);
    app.addEventListener("activo", this.alCambiarActivo);
    this.mostrar(app.activo);
  }

  init(): void {}

  dispose(): void {
    app.removeEventListener("activo", this.alCambiarActivo);
    this.lienzo?.removeEventListener("capas", this.alCambiarCapas);
  }

  private mostrar(lienzo: Lienzo | null): void {
    this.lienzo?.removeEventListener("capas", this.alCambiarCapas);
    this.lienzo = lienzo;
    lienzo?.addEventListener("capas", this.alCambiarCapas);
    this.pintar();
  }

  // ── Acciones (todas registran un paso de historial antes de cambiar) ─────────

  private conPaso(descripcion: string, accion: (l: Lienzo) => void): void {
    const l = this.lienzo;
    if (!l) return;
    l.historial.registrar(l.doc.instantaneaCapas(descripcion));
    accion(l);
  }

  private nueva(): void {
    this.conPaso("Nueva capa", (l) => l.doc.añadirCapa());
  }

  private duplicar(): void {
    this.conPaso("Duplicar capa", (l) => {
      const origen = l.doc.activa;
      const copia = origen.duplicar(nuevoId(), t("{nombre} copia", { nombre: origen.nombre }));
      l.doc.insertarCapa(copia, l.doc.capas.indexOf(origen) + 1);
    });
  }

  private eliminar(): void {
    if (!this.lienzo || this.lienzo.doc.capas.length <= 1) return;
    this.conPaso("Eliminar capa", (l) => l.doc.eliminarCapa(l.doc.activa));
  }

  private mover(sentido: 1 | -1): void {
    const l = this.lienzo;
    if (!l) return;
    const i = l.doc.capas.indexOf(l.doc.activa);
    const destino = i + sentido;
    if (destino < 0 || destino >= l.doc.capas.length) return;
    this.conPaso("Mover capa", (lz) => lz.doc.moverCapa(lz.doc.activa, destino));
  }

  private cambiar(capa: Capa, cambios: Partial<Pick<Capa, "nombre" | "visible" | "bloqueada" | "opacidad" | "modo" | "enStencil">>, descripcion: string): void {
    this.conPaso(descripcion, (l) => l.doc.cambiarCapa(capa, cambios));
  }

  private async importar(archivo: File): Promise<void> {
    if (!this.lienzo) return;
    try {
      const imagen = await createImageBitmap(archivo);
      panelLienzoActual()?.colocarImagen(imagen, archivo.name);
    } catch {
      window.alert(t("No se pudo abrir «{archivo}». Usa una imagen PNG o JPG.", { archivo: archivo.name }));
    }
  }

  /**
   * «Traer dibujo de…»: lista los demás lienzos del proyecto que comparten piel con el
   * activo y copia su dibujo a una capa nueva, recolocado a través del cuerpo (RF-29).
   */
  private selectorTraer(): HTMLSelectElement {
    const s = document.createElement("select");
    s.className = "desplegable";
    s.title = t("Copiar el dibujo de otro lienzo que cubra la misma piel (por ejemplo, al rehacer una zona con otro corte)");
    const rellenar = () => {
      s.replaceChildren(new Option(t("Traer dibujo de…"), ""));
      const actual = this.lienzo;
      if (!actual) return;
      const propios = new Set(actual.zona.triangulos);
      const sim = simetriaActual();
      const reflejados = sim ? new Set(Array.from(actual.zona.triangulos, (tri) => sim.triangulos[tri])) : null;
      const espejos: HTMLOptionElement[] = [];
      for (const otro of app.lienzos) {
        if (otro === actual) continue;
        let comunes = 0, enEspejo = 0;
        for (const tri of otro.zona.triangulos) {
          if (propios.has(tri)) comunes++;
          if (reflejados?.has(tri)) enEspejo++;
        }
        const pct = Math.round((100 * comunes) / propios.size);
        const o = new Option(comunes ? t("{lienzo} ({pct} % común)", { lienzo: otro.nombre, pct }) : t("{lienzo} (no coincide)", { lienzo: otro.nombre }), otro.id);
        o.disabled = comunes === 0;
        s.append(o);
        // La zona simétrica (el otro brazo, la otra pierna…) se ofrece en espejo.
        if (enEspejo > propios.size * 0.05) {
          const pe = Math.round((100 * enEspejo) / propios.size);
          espejos.push(new Option(t("{lienzo} en espejo ({pct} %)", { lienzo: otro.nombre, pct: pe }), `espejo:${otro.id}`));
        }
      }
      if (espejos.length) {
        const grupo = document.createElement("optgroup");
        grupo.label = t("En espejo (lado contrario)");
        grupo.append(...espejos);
        s.append(grupo);
      }
      if (s.options.length === 1) s.append(Object.assign(new Option(t("No hay otros lienzos"), ""), { disabled: true }));
    };
    rellenar();
    s.addEventListener("pointerdown", rellenar);
    s.addEventListener("focus", rellenar);
    s.addEventListener("change", () => {
      const espejo = s.value.startsWith("espejo:");
      const id = espejo ? s.value.slice(7) : s.value;
      const origen = app.lienzos.find((l) => l.id === id);
      s.value = "";
      if (!origen || !this.lienzo) return;
      const sim = espejo ? simetriaActual() : null;
      if (espejo && !sim) return;
      const { comunes, total } = transferirDibujo(origen, this.lienzo, sim ?? undefined);
      const nombre = espejo ? t("{lienzo} (espejo)", { lienzo: origen.nombre }) : origen.nombre;
      if (comunes < total) {
        const fuera = Math.round((100 * (total - comunes)) / total);
        this.aviso(t("Dibujo traído de «{lienzo}». El {pct} % de esta zona no estaba en el original y queda vacío.", { lienzo: nombre, pct: fuera }));
      } else this.aviso(t("Dibujo traído de «{lienzo}».", { lienzo: nombre }));
    });
    return s;
  }

  private aviso(texto: string): void {
    this.propiedades.title = texto;
    const p = document.createElement("p");
    p.className = "aviso-capas";
    p.textContent = texto;
    this.element.querySelector(".aviso-capas")?.remove();
    this.propiedades.after(p);
    setTimeout(() => p.remove(), 8000);
  }

  // ── Pintado ───────────────────────────────────────────────────────────────────

  private pintar(): void {
    this.lista.replaceChildren();
    this.propiedades.replaceChildren();
    const l = this.lienzo;
    if (!l) {
      const aviso = document.createElement("li");
      aviso.className = "aviso";
      aviso.textContent = t("Sin lienzo abierto.");
      this.lista.appendChild(aviso);
      return;
    }
    const activa = l.doc.activa;

    // Propiedades de la capa activa: opacidad, modo de fusión y si va al stencil.
    const opacidad = document.createElement("input");
    opacidad.type = "range";
    opacidad.min = "0";
    opacidad.max = "100";
    opacidad.value = String(Math.round(activa.opacidad * 100));
    opacidad.className = "deslizador";
    const valor = document.createElement("span");
    valor.className = "valor";
    valor.textContent = `${opacidad.value} %`;
    let pasoRegistrado = false;
    opacidad.addEventListener("input", () => {
      // Un único paso de historial por arrastre del deslizador.
      if (!pasoRegistrado) l.historial.registrar(l.doc.instantaneaCapas("Opacidad de capa"));
      pasoRegistrado = true;
      valor.textContent = `${opacidad.value} %`;
      l.doc.cambiarCapa(activa, { opacidad: Number(opacidad.value) / 100 });
    });
    const modo = document.createElement("select");
    modo.className = "desplegable";
    for (const m of MODOS_FUSION) modo.append(new Option(t(m.nombre), m.modo, false, m.modo === activa.modo));
    modo.addEventListener("change", () => this.cambiar(activa, { modo: modo.value as ModoFusion }, "Modo de fusión"));
    const stencil = document.createElement("label");
    stencil.className = "interruptor";
    stencil.title = t("Incluir esta capa al exportar el stencil");
    const casilla = document.createElement("input");
    casilla.type = "checkbox";
    casilla.checked = activa.enStencil;
    casilla.addEventListener("change", () => this.cambiar(activa, { enStencil: casilla.checked }, "Capa en stencil"));
    stencil.append(casilla, " " + t("Stencil"));
    const filaOpacidad = document.createElement("label");
    filaOpacidad.className = "control-etiquetado";
    filaOpacidad.append(t("Opacidad"), opacidad, valor);
    this.propiedades.append(filaOpacidad, modo, stencil);

    // Lista, de la capa superior a la inferior.
    for (const capa of [...l.doc.capas].reverse()) {
      const li = document.createElement("li");
      li.className = "fila-capa" + (capa === activa ? " activa" : "");
      li.draggable = true;

      const ojo = iconoBoton(capa.visible ? "ojo" : "ojoCerrado", capa.visible ? t("Ocultar") : t("Mostrar"), () =>
        this.cambiar(capa, { visible: !capa.visible }, capa.visible ? "Ocultar capa" : "Mostrar capa"),
      );
      const candado = iconoBoton(capa.bloqueada ? "candado" : "candadoAbierto", capa.bloqueada ? t("Desbloquear") : t("Bloquear"), () =>
        this.cambiar(capa, { bloqueada: !capa.bloqueada }, capa.bloqueada ? "Desbloquear capa" : "Bloquear capa"),
      );
      candado.classList.toggle("tenue", !capa.bloqueada);
      ojo.classList.toggle("tenue", !capa.visible);
      const nombre = document.createElement("span");
      nombre.className = "nombre";
      nombre.textContent = capa.nombre;
      nombre.title = t("Doble clic para renombrar");
      nombre.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        this.renombrar(capa, nombre);
      });
      const detalle = document.createElement("span");
      detalle.className = "detalle";
      const partes = [];
      if (capa.opacidad < 1) partes.push(`${Math.round(capa.opacidad * 100)} %`);
      if (capa.modo !== "normal") partes.push(MODOS_FUSION.find((m) => m.modo === capa.modo)!.nombre);
      if (!capa.enStencil) partes.push(t("sin stencil"));
      detalle.textContent = partes.join(" · ");

      li.append(ojo, candado, nombre, detalle);
      li.addEventListener("click", () => l.doc.seleccionarCapa(capa));
      // Reordenar arrastrando.
      li.addEventListener("dragstart", () => (this.arrastrada = capa));
      li.addEventListener("dragover", (e) => {
        e.preventDefault();
        li.classList.add("destino");
      });
      li.addEventListener("dragleave", () => li.classList.remove("destino"));
      li.addEventListener("drop", (e) => {
        e.preventDefault();
        const origen = this.arrastrada;
        this.arrastrada = null;
        if (!origen || origen === capa) return;
        this.conPaso("Mover capa", (lz) => lz.doc.moverCapa(origen, lz.doc.capas.indexOf(capa)));
      });
      this.lista.appendChild(li);
    }
  }

  private renombrar(capa: Capa, span: HTMLElement): void {
    const campo = document.createElement("input");
    campo.className = "campo-nombre";
    campo.value = capa.nombre;
    span.replaceWith(campo);
    campo.focus();
    campo.select();
    const terminar = (guardar: boolean) => {
      const nuevo = campo.value.trim();
      if (guardar && nuevo && nuevo !== capa.nombre) this.cambiar(capa, { nombre: nuevo }, "Renombrar capa");
      else this.pintar();
    };
    campo.addEventListener("keydown", (e) => {
      if (e.key === "Enter") terminar(true);
      if (e.key === "Escape") terminar(false);
    });
    campo.addEventListener("blur", () => terminar(true));
  }
}

function iconoBoton(nombre: NombreIcono, titulo: string, alPulsar: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "icono";
  b.append(icono(nombre, 15));
  b.title = titulo;
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    alPulsar();
  });
  return b;
}
