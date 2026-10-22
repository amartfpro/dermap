import { app } from "../estado";
import { ALTURA_MAXIMA, ALTURA_MINIMA, COMPLEXION_INICIAL } from "../modelos/formas";
import { asegurarProyecto } from "../proyectos/gestor";
import type { ModeloCuerpo } from "../proyectos/modelo";

/** Tonos de piel de partida (RF-14); el selector de color permite cualquier otro. */
const TONOS = ["#f3d6c4", "#e8bfa0", "#d8a98a", "#c08a64", "#8f5f3f", "#5e3d29"];

/**
 * Ajustes del cuerpo del proyecto (RF-12, RF-14): altura real, sexo, complexión,
 * musculatura y tono de piel. Se muestra como una ventana flotante sobre el visor 3D y
 * los cambios se ven en vivo; los lienzos siguen al cuerpo.
 */
export class PanelCuerpo {
  readonly element: HTMLElement;
  private altura: HTMLInputElement;
  private alturaNumero: HTMLInputElement;
  private sexo: HTMLInputElement;
  private peso: HTMLInputElement;
  private musculatura: HTMLInputElement;
  private color: HTMLInputElement;
  private muestras: HTMLButtonElement[] = [];

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "ventana-cuerpo";
    this.element.hidden = true;

    const cabecera = document.createElement("div");
    cabecera.className = "ventana-cabecera";
    const titulo = document.createElement("strong");
    titulo.textContent = "Cuerpo del cliente";
    const cerrar = document.createElement("button");
    cerrar.className = "boton-texto";
    cerrar.textContent = "×";
    cerrar.title = "Cerrar";
    cerrar.addEventListener("click", () => (this.element.hidden = true));
    cabecera.append(titulo, cerrar);

    this.altura = rango(ALTURA_MINIMA, ALTURA_MAXIMA, 1);
    this.alturaNumero = document.createElement("input");
    this.alturaNumero.type = "number";
    this.alturaNumero.min = String(ALTURA_MINIMA);
    this.alturaNumero.max = String(ALTURA_MAXIMA);
    this.alturaNumero.className = "numero";
    this.altura.addEventListener("input", () => {
      this.alturaNumero.value = this.altura.value;
      this.cambiar({ altura: Number(this.altura.value) });
    });
    this.alturaNumero.addEventListener("change", () => {
      const v = Math.min(ALTURA_MAXIMA, Math.max(ALTURA_MINIMA, Math.round(Number(this.alturaNumero.value) || 170)));
      this.alturaNumero.value = this.altura.value = String(v);
      this.cambiar({ altura: v });
    });

    this.sexo = rango(0, 100, 1);
    this.sexo.addEventListener("input", () => this.cambiar({ sexo: Number(this.sexo.value) / 100 }));
    this.peso = rango(0, 100, 1);
    this.peso.addEventListener("input", () => this.cambiar({ complexion: Number(this.peso.value) / 100 }));
    this.musculatura = rango(0, 100, 1);
    this.musculatura.addEventListener("input", () => this.cambiar({ musculatura: Number(this.musculatura.value) / 100 }));

    this.color = document.createElement("input");
    this.color.type = "color";
    this.color.className = "selector-color";
    this.color.title = "Otro tono";
    // «change» y no «input»: cambiar el tono recompone la vista previa de todos los lienzos.
    this.color.addEventListener("change", () => this.cambiar({ tonoPiel: this.color.value }));
    const tonos = document.createElement("div");
    tonos.className = "tonos";
    for (const tono of TONOS) {
      const b = document.createElement("button");
      b.className = "muestra";
      b.style.background = tono;
      b.title = tono;
      b.addEventListener("click", () => this.cambiar({ tonoPiel: tono }));
      this.muestras.push(b);
      tonos.append(b);
    }
    tonos.append(this.color);

    const alturaFila = document.createElement("div");
    alturaFila.className = "fila-altura";
    const cm = document.createElement("span");
    cm.textContent = "cm";
    alturaFila.append(this.altura, this.alturaNumero, cm);

    const restablecer = document.createElement("button");
    restablecer.className = "boton-texto";
    restablecer.textContent = "Restablecer";
    restablecer.addEventListener("click", () =>
      this.cambiar({
        altura: COMPLEXION_INICIAL.altura,
        sexo: COMPLEXION_INICIAL.sexo,
        complexion: COMPLEXION_INICIAL.peso,
        musculatura: COMPLEXION_INICIAL.musculatura,
      }),
    );
    const nota = document.createElement("p");
    nota.className = "nota";
    nota.textContent =
      "Es una aproximación para ver el diseño en proporción: la medida real del stencil es la del lienzo, en centímetros.";

    this.element.append(
      cabecera,
      campo("Altura", alturaFila),
      campo("Sexo", extremos("Mujer", this.sexo, "Hombre")),
      campo("Complexión", extremos("Delgada", this.peso, "Robusta")),
      campo("Musculatura", extremos("Poca", this.musculatura, "Mucha")),
      campo("Tono de piel", tonos),
      nota,
      restablecer,
    );
    this.sincronizar();
  }

  alternar(): void {
    this.element.hidden = !this.element.hidden;
    if (!this.element.hidden) this.sincronizar();
  }

  /** Muestra los valores del proyecto abierto. */
  sincronizar(): void {
    const m = app.proyecto?.datos.modelo;
    const altura = Math.round(m?.altura || COMPLEXION_INICIAL.altura);
    this.altura.value = this.alturaNumero.value = String(altura);
    this.sexo.value = String(Math.round((m?.sexo ?? COMPLEXION_INICIAL.sexo) * 100));
    this.peso.value = String(Math.round((m?.complexion ?? COMPLEXION_INICIAL.peso) * 100));
    this.musculatura.value = String(Math.round((m?.musculatura ?? COMPLEXION_INICIAL.musculatura) * 100));
    const tono = m?.tonoPiel ?? "#d8a98a";
    this.color.value = tono;
    for (const b of this.muestras) b.classList.toggle("activo", b.title === tono);
  }

  private cambiar(cambios: Partial<ModeloCuerpo>): void {
    void (async () => {
      const proyecto = app.proyecto ?? (await asegurarProyecto());
      proyecto.cambiarModelo(cambios);
      // Tras elegir un tono o restablecer, los controles deben reflejar los valores nuevos.
      if (cambios.tonoPiel || Object.keys(cambios).length > 1) this.sincronizar();
    })();
  }
}

function rango(min: number, max: number, paso: number): HTMLInputElement {
  const r = document.createElement("input");
  r.type = "range";
  r.min = String(min);
  r.max = String(max);
  r.step = String(paso);
  r.className = "deslizador";
  return r;
}

function campo(nombre: string, control: HTMLElement): HTMLElement {
  const fila = document.createElement("label");
  fila.className = "campo-cuerpo";
  const t = document.createElement("span");
  t.textContent = nombre;
  fila.append(t, control);
  return fila;
}

function extremos(izquierda: string, control: HTMLElement, derecha: string): HTMLElement {
  const fila = document.createElement("div");
  fila.className = "extremos";
  const a = document.createElement("small");
  a.textContent = izquierda;
  const b = document.createElement("small");
  b.textContent = derecha;
  fila.append(a, control, b);
  return fila;
}
