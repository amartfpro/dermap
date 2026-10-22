import type { Lienzo } from "./lienzo/lienzo";
import { AJUSTES_INICIALES, type AjustesPincel } from "./lienzo/pincel";
import type { Cuerpo } from "./modelos/cuerpo";
import type { ProyectoAbierto } from "./proyectos/proyecto";

/**
 * Estado compartido entre paneles.
 *
 * Eventos:
 *  - «lienzos»: cambió la lista de lienzos, su orden o su visibilidad (el visor 3D se rehace).
 *  - «activo»: cambió el lienzo activo (el que se edita).
 *  - «abiertos»: cambiaron las pestañas de lienzos abiertos (RF-42).
 *  - «proyecto»: se abrió o cerró un proyecto.
 *  - «ajustes»: cambiaron los ajustes del pincel.
 *  - «cuerpo»: se cargó el cuerpo base.
 */
class EstadoApp extends EventTarget {
  cuerpo: Cuerpo | null = null;
  proyecto: ProyectoAbierto | null = null;
  /** Lienzos del proyecto abierto. El orden es el de dibujo en el 3D (el último, encima). */
  lienzos: Lienzo[] = [];
  /** Lienzos abiertos en pestañas para editar. */
  abiertos: Lienzo[] = [];
  activo: Lienzo | null = null;
  ajustes: AjustesPincel = { ...AJUSTES_INICIALES };

  fijarCuerpo(cuerpo: Cuerpo): void {
    this.cuerpo = cuerpo;
    this.dispatchEvent(new Event("cuerpo"));
  }

  fijarProyecto(proyecto: ProyectoAbierto | null, lienzos: Lienzo[]): void {
    this.proyecto = proyecto;
    this.lienzos = lienzos;
    this.abiertos = [];
    this.activo = null;
    this.dispatchEvent(new Event("proyecto"));
    this.dispatchEvent(new Event("lienzos"));
    this.dispatchEvent(new Event("abiertos"));
    this.dispatchEvent(new Event("activo"));
  }

  /** Nueva lista u orden de lienzos (se conservan las pestañas que sigan existiendo). */
  actualizarLienzos(lienzos: Lienzo[]): void {
    this.lienzos = lienzos;
    const antes = this.abiertos.length;
    this.abiertos = this.abiertos.filter((l) => lienzos.includes(l));
    this.dispatchEvent(new Event("lienzos"));
    if (this.abiertos.length !== antes) this.dispatchEvent(new Event("abiertos"));
    if (this.activo && !lienzos.includes(this.activo)) this.activar(this.abiertos[this.abiertos.length - 1] ?? null);
  }

  /** Abre un lienzo en una pestaña y lo activa. */
  abrir(lienzo: Lienzo): void {
    if (!this.abiertos.includes(lienzo)) {
      this.abiertos = [...this.abiertos, lienzo];
      this.dispatchEvent(new Event("abiertos"));
    }
    this.activar(lienzo);
  }

  cerrar(lienzo: Lienzo): void {
    const i = this.abiertos.indexOf(lienzo);
    if (i < 0) return;
    this.abiertos = this.abiertos.filter((l) => l !== lienzo);
    this.dispatchEvent(new Event("abiertos"));
    if (this.activo === lienzo) this.activar(this.abiertos[Math.min(i, this.abiertos.length - 1)] ?? null);
  }

  activar(lienzo: Lienzo | null): void {
    if (this.activo === lienzo) return;
    this.activo = lienzo;
    this.dispatchEvent(new Event("activo"));
  }

  cambiarAjustes(cambios: Partial<AjustesPincel>): void {
    this.ajustes = { ...this.ajustes, ...cambios };
    this.dispatchEvent(new Event("ajustes"));
  }
}

export const app = new EstadoApp();
