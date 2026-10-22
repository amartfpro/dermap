import type { Lienzo } from "./lienzo/lienzo";
import { AJUSTES_INICIALES, type AjustesPincel } from "./lienzo/pincel";
import type { Cuerpo } from "./modelos/cuerpo";

/**
 * Estado compartido entre paneles.
 *
 * Eventos:
 *  - «lienzos»: cambió la lista de lienzos, su orden o su visibilidad (el visor 3D se rehace).
 *  - «activo»: cambió el lienzo activo (el que se edita).
 *  - «ajustes»: cambiaron los ajustes del pincel.
 *  - «cuerpo»: se cargó el cuerpo base.
 */
class EstadoApp extends EventTarget {
  cuerpo: Cuerpo | null = null;
  /** Lienzos del proyecto abierto. El orden es el de dibujo en el 3D (el último, encima). */
  lienzos: Lienzo[] = [];
  activo: Lienzo | null = null;
  ajustes: AjustesPincel = { ...AJUSTES_INICIALES };

  fijarCuerpo(cuerpo: Cuerpo): void {
    this.cuerpo = cuerpo;
    this.dispatchEvent(new Event("cuerpo"));
  }

  fijarLienzos(lienzos: Lienzo[], activo: Lienzo | null = lienzos[lienzos.length - 1] ?? null): void {
    this.lienzos = lienzos;
    this.activo = activo;
    this.dispatchEvent(new Event("lienzos"));
    this.dispatchEvent(new Event("activo"));
  }

  añadirLienzo(lienzo: Lienzo): void {
    this.lienzos = [...this.lienzos, lienzo];
    this.dispatchEvent(new Event("lienzos"));
    this.activar(lienzo);
  }

  quitarLienzo(lienzo: Lienzo): void {
    this.lienzos = this.lienzos.filter((l) => l !== lienzo);
    if (this.activo === lienzo) this.activo = this.lienzos[this.lienzos.length - 1] ?? null;
    this.dispatchEvent(new Event("lienzos"));
    this.dispatchEvent(new Event("activo"));
  }

  /** Avisa de un cambio de orden o visibilidad de los lienzos ya cargados. */
  avisarLienzos(): void {
    this.dispatchEvent(new Event("lienzos"));
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
