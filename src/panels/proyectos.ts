import type { IContentRenderer } from "dockview-core";
import { confirmar } from "../dialogos";
import { app } from "../estado";
import { abrirProyecto, crearProyecto, duplicarLienzo, eliminarNodo, proyectos } from "../proyectos/gestor";
import type { NodoArbol } from "../proyectos/modelo";
import type { ProyectoAbierto } from "../proyectos/proyecto";
import { sistemaArchivos } from "../proyectos/sistema-archivos";
import { boton } from "./lienzo";

/**
 * Panel izquierdo: proyectos (uno por cliente, RF-01) y el árbol de carpetas y lienzos del
 * proyecto abierto (RF-02). Desde aquí se abren lienzos en pestañas, se ocultan en el 3D
 * (RF-07), se reordenan arrastrando (RF-06), se duplican (RF-08), se renombran y se borran.
 */
export class PanelProyectos implements IContentRenderer {
  readonly element: HTMLElement;
  private selector: HTMLSelectElement;
  private formulario: HTMLFormElement;
  private campoNombre: HTMLInputElement;
  private acciones: HTMLElement;
  private arbol: HTMLElement;
  private pie: HTMLElement;
  private proyecto: ProyectoAbierto | null = null;
  private arrastrado: string | null = null;
  private alCambiarProyecto = () => this.conectar(app.proyecto);
  private alCambiarArbol = () => this.pintarArbol();
  private alCambiarActivo = () => this.pintarArbol();
  private alProgreso = (e: Event) => (this.pie.textContent = (e as CustomEvent<string>).detail);

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "panel panel-proyectos";

    const barra = document.createElement("div");
    barra.className = "herramientas";
    this.selector = document.createElement("select");
    this.selector.className = "desplegable selector-proyecto";
    this.selector.addEventListener("change", () => void this.elegirProyecto());
    barra.append(this.selector);

    this.formulario = document.createElement("form");
    this.formulario.className = "formulario-en-linea";
    this.formulario.hidden = true;
    this.campoNombre = document.createElement("input");
    this.campoNombre.placeholder = "Nombre del cliente o del proyecto";
    this.campoNombre.className = "campo-nombre";
    const crear = document.createElement("button");
    crear.type = "submit";
    crear.className = "boton-texto primario";
    crear.textContent = "Crear";
    this.formulario.append(this.campoNombre, crear, boton("Cancelar", () => (this.formulario.hidden = true)));
    this.formulario.addEventListener("submit", (e) => {
      e.preventDefault();
      void this.nuevoProyecto();
    });

    this.acciones = document.createElement("div");
    this.acciones.className = "herramientas";
    const nuevaCarpeta = boton("+ Carpeta", () => {
      const nodo = this.proyecto?.crearCarpeta(this.nombreCarpetaLibre());
      if (nodo) requestAnimationFrame(() => this.empezarRenombrado(nodo.id));
    });
    nuevaCarpeta.title = "Nueva carpeta, por ejemplo «Tatuajes previos» o «Propuestas»";
    const guardar = boton("Guardar", () => void this.proyecto?.guardar());
    guardar.title = "Guardar ahora (Ctrl+S). Se guarda solo cada pocos segundos.";
    this.acciones.append(nuevaCarpeta, guardar);

    this.arbol = document.createElement("div");
    this.arbol.className = "arbol";
    this.arbol.addEventListener("dragover", (e) => e.preventDefault());
    this.arbol.addEventListener("drop", (e) => {
      // Soltar en el hueco libre: al final de la raíz.
      if (e.target !== this.arbol || !this.arrastrado) return;
      e.preventDefault();
      this.proyecto?.mover(this.arrastrado, null);
      this.arrastrado = null;
    });

    this.pie = document.createElement("div");
    this.pie.className = "pie-panel";

    this.element.append(barra, this.formulario, this.acciones, this.arbol, this.pie);
    app.addEventListener("proyecto", this.alCambiarProyecto);
    app.addEventListener("activo", this.alCambiarActivo);
    app.addEventListener("progreso", this.alProgreso);
    this.conectar(app.proyecto);
  }

  init(): void {}

  dispose(): void {
    app.removeEventListener("proyecto", this.alCambiarProyecto);
    app.removeEventListener("activo", this.alCambiarActivo);
    app.removeEventListener("progreso", this.alProgreso);
    this.proyecto?.removeEventListener("arbol", this.alCambiarArbol);
    this.proyecto?.removeEventListener("guardado", this.alCambiarArbol);
  }

  private conectar(p: ProyectoAbierto | null): void {
    this.proyecto?.removeEventListener("arbol", this.alCambiarArbol);
    this.proyecto?.removeEventListener("guardado", this.alCambiarArbol);
    this.proyecto = p;
    p?.addEventListener("arbol", this.alCambiarArbol);
    p?.addEventListener("guardado", this.alCambiarArbol);
    this.acciones.hidden = !p;
    void this.rellenarSelector();
    this.pintarArbol();
  }

  // ── Proyectos ─────────────────────────────────────────────────────────────────

  private async rellenarSelector(): Promise<void> {
    const lista = await proyectos().catch(() => []);
    this.selector.replaceChildren(
      new Option(this.proyecto ? `Proyecto: ${this.proyecto.nombre}` : "Elige o crea un proyecto…", "", true, true),
      ...lista.filter((p) => p.carpeta !== this.proyecto?.carpeta).map((p) => new Option(p.nombre, p.carpeta)),
      new Option("+ Nuevo proyecto…", "__nuevo__"),
    );
  }

  private async elegirProyecto(): Promise<void> {
    const valor = this.selector.value;
    this.selector.value = "";
    if (!valor) return;
    if (valor === "__nuevo__") {
      this.formulario.hidden = false;
      this.campoNombre.value = "";
      this.campoNombre.focus();
      return;
    }
    this.pie.textContent = "Abriendo proyecto…";
    try {
      await abrirProyecto(valor, (t) => (this.pie.textContent = t));
    } catch (error) {
      this.pie.textContent = `No se pudo abrir el proyecto: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async nuevoProyecto(): Promise<void> {
    const nombre = this.campoNombre.value.trim();
    if (!nombre) return;
    this.formulario.hidden = true;
    try {
      await crearProyecto(nombre);
    } catch (error) {
      this.pie.textContent = `No se pudo crear el proyecto: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  // ── Árbol ─────────────────────────────────────────────────────────────────────

  private pintarArbol(): void {
    this.arbol.replaceChildren();
    const p = this.proyecto;
    if (!p) {
      this.arbol.append(aviso("No hay ningún proyecto abierto. Crea uno (un proyecto por cliente) o elige uno de la lista. Si aplanas una zona sin proyecto, se crea uno «Sin título»."));
      void this.pintarPie();
      return;
    }
    if (p.datos.arbol.length === 0)
      this.arbol.append(aviso("Proyecto vacío. Selecciona una zona en el visor 3D y pulsa «Aplanar zona» para crear el primer lienzo: un tatuaje nuevo, uno existente o una cicatriz."));
    const pintar = (lista: NodoArbol[], nivel: number, visiblePadre: boolean) => {
      for (const nodo of lista) {
        this.arbol.append(this.fila(nodo, nivel, visiblePadre));
        if (nodo.tipo === "carpeta" && nodo.abierta) pintar(nodo.hijos, nivel + 1, visiblePadre && nodo.visible);
      }
    };
    pintar(p.datos.arbol, 0, true);
    void this.pintarPie();
  }

  private async pintarPie(): Promise<void> {
    const p = this.proyecto;
    const donde = await (await sistemaArchivos()).descripcion();
    if (!p) {
      this.pie.textContent = `Los proyectos se guardan en ${donde}.`;
      return;
    }
    const estado = {
      guardado: "Guardado",
      pendiente: "Cambios sin guardar",
      guardando: "Guardando…",
      error: `Error al guardar: ${p.ultimoError}`,
    }[p.estadoGuardado];
    this.pie.textContent = `${estado} · ${donde}`;
    this.pie.classList.toggle("error", p.estadoGuardado === "error");
  }

  private fila(nodo: NodoArbol, nivel: number, visiblePadre: boolean): HTMLElement {
    const p = this.proyecto!;
    const fila = document.createElement("div");
    fila.className = `fila-arbol ${nodo.tipo}`;
    fila.dataset.id = nodo.id;
    fila.style.paddingLeft = `${6 + nivel * 14}px`;
    fila.draggable = true;
    const lienzo = nodo.tipo === "lienzo" ? p.lienzos.get(nodo.id) : undefined;
    if (lienzo && lienzo === app.activo) fila.classList.add("activa");
    if (!nodo.visible || !visiblePadre) fila.classList.add("oculta");
    const fallo = p.noAbiertos.get(nodo.id);
    if (fallo) {
      fila.classList.add("dañada");
      fila.title = `No se pudo abrir: ${fallo}`;
    }

    const flecha = document.createElement("span");
    flecha.className = "flecha";
    if (nodo.tipo === "carpeta") {
      flecha.textContent = nodo.abierta ? "▾" : "▸";
      flecha.addEventListener("click", (e) => {
        e.stopPropagation();
        p.alternarAbierta(nodo.id);
      });
    }
    const ojo = document.createElement("button");
    ojo.className = "icono";
    ojo.textContent = nodo.visible ? "◉" : "○";
    ojo.title = nodo.visible ? "Ocultar en el 3D" : "Mostrar en el 3D";
    ojo.addEventListener("click", (e) => {
      e.stopPropagation();
      p.alternarVisible(nodo.id);
    });
    const icono = document.createElement("span");
    icono.className = "tipo";
    icono.textContent = nodo.tipo === "carpeta" ? "▤" : lienzo?.zona.aplanado.tipo === "manga" ? "◫" : "▭";
    icono.title = nodo.tipo === "carpeta" ? "Carpeta" : lienzo?.zona.aplanado.tipo === "manga" ? "Manga (con corte)" : "Parche";
    const nombre = document.createElement("span");
    nombre.className = "nombre";
    nombre.textContent = fallo ? `${nodo.nombre} (no se pudo abrir)` : nodo.nombre;
    nombre.title = "Doble clic para renombrar";
    nombre.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      this.empezarRenombrado(nodo.id);
    });

    const extra = document.createElement("span");
    extra.className = "acciones-fila";
    if (nodo.tipo === "lienzo") {
      const duplicar = document.createElement("button");
      duplicar.className = "icono";
      duplicar.textContent = "⧉";
      duplicar.title = "Duplicar (para probar otra versión del diseño)";
      duplicar.addEventListener("click", (e) => {
        e.stopPropagation();
        void duplicarLienzo(nodo.id);
      });
      extra.append(duplicar);
    }
    const borrar = document.createElement("button");
    borrar.className = "icono";
    borrar.textContent = "×";
    borrar.title = "Eliminar";
    borrar.addEventListener("click", async (e) => {
      e.stopPropagation();
      const que = nodo.tipo === "carpeta" ? `la carpeta «${nodo.nombre}» y todo lo que contiene` : `el lienzo «${nodo.nombre}»`;
      if (await confirmar(`¿Eliminar ${que}? No se puede deshacer.`)) await eliminarNodo(nodo.id);
    });
    extra.append(borrar);

    fila.append(flecha, ojo, icono, nombre, extra);
    fila.addEventListener("click", () => {
      if (lienzo) app.abrir(lienzo);
      else if (nodo.tipo === "carpeta") p.alternarAbierta(nodo.id);
    });

    // Arrastrar: sobre una carpeta, dentro; sobre un lienzo, justo antes.
    fila.addEventListener("dragstart", (e) => {
      this.arrastrado = nodo.id;
      e.dataTransfer?.setData("text/plain", nodo.id);
    });
    fila.addEventListener("dragover", (e) => {
      if (!this.arrastrado || this.arrastrado === nodo.id) return;
      e.preventDefault();
      fila.classList.add(nodo.tipo === "carpeta" ? "destino-dentro" : "destino-antes");
    });
    fila.addEventListener("dragleave", () => fila.classList.remove("destino-dentro", "destino-antes"));
    fila.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = this.arrastrado;
      this.arrastrado = null;
      if (!id || id === nodo.id) return;
      if (nodo.tipo === "carpeta") p.mover(id, nodo.id);
      else p.mover(id, null, nodo.id);
    });
    return fila;
  }

  private empezarRenombrado(id: string): void {
    const fila = this.arbol.querySelector<HTMLElement>(`.fila-arbol[data-id="${id}"]`);
    const span = fila?.querySelector<HTMLElement>(".nombre");
    const nodo = this.proyecto?.buscar(id)?.nodo;
    if (!span || !nodo) return;
    const campo = document.createElement("input");
    campo.className = "campo-nombre";
    campo.value = nodo.nombre;
    span.replaceWith(campo);
    campo.focus();
    campo.select();
    let hecho = false;
    const terminar = (guardar: boolean) => {
      if (hecho) return;
      hecho = true;
      if (guardar && campo.value.trim() && campo.value.trim() !== nodo.nombre) this.proyecto?.renombrar(id, campo.value);
      else this.pintarArbol();
    };
    campo.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") terminar(true);
      if (e.key === "Escape") terminar(false);
    });
    campo.addEventListener("click", (e) => e.stopPropagation());
    campo.addEventListener("blur", () => terminar(true));
  }

  private nombreCarpetaLibre(): string {
    const nombres = new Set<string>();
    const recorrer = (lista: NodoArbol[]) =>
      lista.forEach((n) => {
        nombres.add(n.nombre);
        if (n.tipo === "carpeta") recorrer(n.hijos);
      });
    recorrer(this.proyecto?.datos.arbol ?? []);
    let nombre = "Carpeta nueva";
    for (let n = 2; nombres.has(nombre); n++) nombre = `Carpeta nueva ${n}`;
    return nombre;
  }
}

function aviso(texto: string): HTMLElement {
  const d = document.createElement("div");
  d.className = "aviso";
  d.textContent = texto;
  return d;
}
