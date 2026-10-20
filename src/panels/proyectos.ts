import type { IContentRenderer } from "dockview-core";
import { listarProyectos, crearProyecto, carpetaRaiz, enTauri } from "../proyectos/almacen";

/** Panel izquierdo: lista los proyectos guardados en Documentos/Dermap. */
export class PanelProyectos implements IContentRenderer {
  readonly element: HTMLElement;
  private lista: HTMLUListElement;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "panel panel-proyectos";

    const acciones = document.createElement("div");
    acciones.className = "acciones";
    const nuevo = document.createElement("button");
    nuevo.className = "boton-texto";
    nuevo.textContent = "+ Nuevo proyecto";
    nuevo.addEventListener("click", () => this.nuevoProyecto());
    acciones.appendChild(nuevo);

    this.lista = document.createElement("ul");
    this.lista.className = "arbol";

    this.element.append(acciones, this.lista);
  }

  init(): void {
    void this.refrescar();
  }

  private async refrescar(): Promise<void> {
    this.lista.replaceChildren();
    if (!enTauri()) {
      this.mostrarAviso("Ejecuta la app con «npm run tauri dev» para trabajar con proyectos en disco.");
      return;
    }
    try {
      const proyectos = await listarProyectos();
      if (proyectos.length === 0) {
        this.mostrarAviso(`Aún no hay proyectos. Se guardarán en ${await carpetaRaiz()}.`);
        return;
      }
      for (const p of proyectos) {
        const li = document.createElement("li");
        li.textContent = `▸ ${p.nombre}`;
        li.title = p.ruta;
        this.lista.appendChild(li);
      }
    } catch (error) {
      this.mostrarAviso(`No se pudo leer la carpeta de proyectos: ${String(error)}`);
    }
  }

  private async nuevoProyecto(): Promise<void> {
    if (!enTauri()) return;
    const nombre = window.prompt("Nombre del proyecto (por ejemplo, el del cliente):")?.trim();
    if (!nombre) return;
    try {
      await crearProyecto(nombre);
    } catch (error) {
      window.alert(String(error));
    }
    await this.refrescar();
  }

  private mostrarAviso(texto: string): void {
    const li = document.createElement("li");
    li.className = "aviso";
    li.textContent = texto;
    this.lista.appendChild(li);
  }
}
