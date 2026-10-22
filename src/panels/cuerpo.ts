import { t } from "../i18n";
import { app } from "../estado";
import { ALTURA_MAXIMA, ALTURA_MINIMA, COMPLEXION_INICIAL } from "../modelos/formas";
import { asegurarProyecto } from "../proyectos/gestor";
import type { ModeloCuerpo } from "../proyectos/modelo";
import { POSE_RECTA, type Pose } from "../modelos/pose";
import type { Medida, Medidas } from "../modelos/medidas";

/** Tonos de piel de partida (RF-14); el selector de color permite cualquier otro. */
export const TONOS = ["#f3d6c4", "#e8bfa0", "#d8a98a", "#c08a64", "#8f5f3f", "#5e3d29"];

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
  private pose: Pose = { ...POSE_RECTA };
  private deslizadoresPose: Partial<Record<keyof Pose, HTMLInputElement>> = {};

  private camposMedida: Partial<Record<Medida, HTMLInputElement>> = {};

  constructor(
    private readonly alCambiarPose: (pose: Pose) => void = () => {},
    private readonly contornosModelo: () => Required<Medidas> | null = () => null,
  ) {
    this.element = document.createElement("div");
    this.element.className = "ventana-cuerpo";
    this.element.hidden = true;

    const cabecera = document.createElement("div");
    cabecera.className = "ventana-cabecera";
    const titulo = document.createElement("strong");
    titulo.textContent = t("Cuerpo del cliente");
    const cerrar = document.createElement("button");
    cerrar.className = "boton-texto";
    cerrar.textContent = t("×");
    cerrar.title = t("Cerrar");
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
    this.color.title = t("Otro tono");
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
    cm.textContent = t("cm");
    alturaFila.append(this.altura, this.alturaNumero, cm);

    const restablecer = document.createElement("button");
    restablecer.className = "boton-texto";
    restablecer.textContent = t("Restablecer");
    restablecer.addEventListener("click", () =>
      this.cambiar({
        altura: COMPLEXION_INICIAL.altura,
        sexo: COMPLEXION_INICIAL.sexo,
        complexion: COMPLEXION_INICIAL.peso,
        musculatura: COMPLEXION_INICIAL.musculatura,
        medidas: {},
      }),
    );
    const nota = document.createElement("p");
    nota.className = "nota";
    nota.textContent =
      t("Sin medidas del cliente, el cuerpo es una aproximación para ver el diseño en proporción. La medida del stencil es siempre la del lienzo, en centímetros.");

    // Postura (RF-13): solo para ver cómo se deforma el diseño; no se guarda ni cambia los lienzos.
    const postura = document.createElement("div");
    postura.className = "postura";
    const articulacion = (clave: keyof Pose, nombre: string) => {
      const r = rango(0, 140, 1);
      r.value = "0";
      r.title = t("{articulacion}: grados de flexión", { articulacion: nombre });
      r.addEventListener("input", () => {
        this.pose = { ...this.pose, [clave]: Number(r.value) };
        this.alCambiarPose({ ...this.pose });
      });
      this.deslizadoresPose[clave] = r;
      const fila = document.createElement("div");
      fila.className = "extremos";
      const etiqueta = document.createElement("small");
      etiqueta.textContent = nombre;
      fila.append(etiqueta, r);
      return fila;
    };
    const recta = document.createElement("button");
    recta.className = "boton-texto";
    recta.textContent = t("Postura recta");
    recta.addEventListener("click", () => {
      this.posturaRecta();
      this.alCambiarPose({ ...this.pose });
    });
    postura.append(
      articulacion("codoL", t("Codo izq.")),
      articulacion("codoR", t("Codo der.")),
      articulacion("rodillaL", t("Rodilla izq.")),
      articulacion("rodillaR", t("Rodilla der.")),
      recta,
    );

    // Medidas reales del cliente: con ellas los lienzos nuevos salen a su escala real.
    const medidas = document.createElement("div");
    medidas.className = "medidas";
    const NOMBRES: [Medida, string][] = [
      ["brazo", t("Brazo (bíceps)")],
      ["antebrazo", t("Antebrazo")],
      ["muneca", t("Muñeca")],
      ["muslo", t("Muslo")],
      ["gemelo", t("Gemelo")],
      ["tobillo", t("Tobillo")],
    ];
    for (const [clave, nombre] of NOMBRES) {
      const entrada = document.createElement("input");
      entrada.type = "number";
      entrada.min = "5";
      entrada.max = "120";
      entrada.step = "0.5";
      entrada.className = "numero";
      entrada.addEventListener("change", () => {
        const valor = Number(entrada.value);
        const actuales = { ...(app.proyecto?.datos.modelo.medidas ?? {}) };
        if (entrada.value === "" || !(valor > 0)) delete actuales[clave];
        else actuales[clave] = Math.min(120, Math.max(5, valor));
        this.cambiar({ medidas: actuales });
      });
      this.camposMedida[clave] = entrada;
      const fila = document.createElement("label");
      fila.className = "fila-medida";
      const texto = document.createElement("span");
      texto.textContent = nombre;
      const cm = document.createElement("small");
      cm.textContent = "cm";
      fila.append(texto, entrada, cm);
      medidas.append(fila);
    }
    const notaMedidas = document.createElement("p");
    notaMedidas.className = "nota";
    notaMedidas.textContent = t(
      "Contornos con cinta métrica, iguales en los dos lados. Con ellos, los lienzos que crees después salen a la escala real del cliente; los ya creados conservan su tamaño. En gris, la medida actual del modelo.",
    );

    this.element.append(
      cabecera,
      campo(t("Altura"), alturaFila),
      campo(t("Sexo"), extremos(t("Mujer"), this.sexo, t("Hombre"))),
      campo(t("Complexión"), extremos(t("Delgada"), this.peso, t("Robusta"))),
      campo(t("Musculatura"), extremos(t("Poca"), this.musculatura, t("Mucha"))),
      campo(t("Tono de piel"), tonos),
      nota,
      restablecer,
      campo(t("Medidas del cliente"), medidas),
      notaMedidas,
      campo(t("Postura (solo para ver)"), postura),
    );
    this.sincronizar();
  }

  /** Vuelve a la postura recta (sin avisar). */
  posturaRecta(): void {
    this.pose = { ...POSE_RECTA };
    for (const r of Object.values(this.deslizadoresPose)) if (r) r.value = "0";
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
    const modelo = this.contornosModelo();
    for (const [clave, entrada] of Object.entries(this.camposMedida) as [Medida, HTMLInputElement][]) {
      const valor = m?.medidas?.[clave];
      entrada.value = valor ? String(valor) : "";
      entrada.placeholder = modelo ? modelo[clave].toFixed(1) : "";
    }
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
