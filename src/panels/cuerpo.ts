import { t } from "../i18n";
import { botonIcono } from "../ui/iconos";
import { botonColorLibre } from "../ui/selector-color";
import { app } from "../estado";
import { ALTURA_MAXIMA, ALTURA_MINIMA, COMPLEXION_INICIAL } from "../modelos/formas";
import { asegurarProyecto } from "../proyectos/gestor";
import type { ModeloCuerpo } from "../proyectos/modelo";
import { LIMITES_POSE, mismaPose, POSE_EN_T, POSE_NATURAL, POSE_RECTA, poseDe, type Pose } from "../modelos/pose";

/** Tonos de piel de partida (RF-14); el selector de color permite cualquier otro. */
export const TONOS = ["#f3d6c4", "#e8bfa0", "#d8a98a", "#c08a64", "#8f5f3f", "#5e3d29", "#3f281b", "#2a1a12"];

/**
 * Ajustes del cuerpo del proyecto (RF-12, RF-14): altura real, sexo, complexión,
 * musculatura y tono de piel. Se muestra como una ventana flotante sobre el visor 3D y
 * los cambios se ven en vivo; los lienzos siguen al cuerpo.
 */
export class PanelCuerpo {
  readonly element: HTMLElement;
  private altura: HTMLInputElement;
  private alturaNumero: HTMLInputElement;
  private sexo: HTMLElement;
  private peso: HTMLInputElement;
  private musculatura: HTMLInputElement;
  private color: ReturnType<typeof botonColorLibre>;
  private muestras: HTMLButtonElement[] = [];
  private pose: Pose = { ...POSE_NATURAL };
  private casillaSimetrica!: HTMLInputElement;
  /** Botones de postura: el de la postura actual se marca como activo. */
  private botonesPostura: [HTMLButtonElement, Pose][] = [];
  private deslizadoresPose: Partial<Record<keyof Pose, HTMLInputElement>> = {};
  private valoresPose: Partial<Record<keyof Pose, HTMLElement>> = {};


  constructor() {
    this.element = document.createElement("div");
    this.element.className = "ventana-cuerpo";
    this.element.hidden = true;

    const cabecera = document.createElement("div");
    cabecera.className = "ventana-cabecera";
    const titulo = document.createElement("strong");
    titulo.textContent = t("Modelo");
    const cerrar = botonIcono("cerrar", t("Cerrar"), () => (this.element.hidden = true));
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

    // Hombre o mujer (formas de MakeHuman al 100 %, sin mezclas).
    this.sexo = document.createElement("div");
    this.sexo.className = "segmentado sexo";
    for (const [valor, texto] of [
      [0, t("Mujer")],
      [1, t("Hombre")],
    ] as const) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "boton-texto";
      b.textContent = texto;
      b.dataset.valor = String(valor);
      b.addEventListener("click", () => {
        this.cambiar({ sexo: valor });
        this.marcarSexo(valor);
      });
      this.sexo.append(b);
    }
    this.peso = rango(0, 100, 1);
    this.peso.addEventListener("input", () => this.cambiar({ complexion: Number(this.peso.value) / 100 }));
    this.musculatura = rango(0, 100, 1);
    this.musculatura.addEventListener("input", () => this.cambiar({ musculatura: Number(this.musculatura.value) / 100 }));

    // Otro tono: el mismo selector de color que el del lienzo.
    this.color = botonColorLibre(
      t("Otro tono"),
      () => app.proyecto?.datos.modelo.tonoPiel ?? "#d8a98a",
      (c) => this.cambiar({ tonoPiel: c }),
      "dermap.tonos-piel",
    );
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

    const nota = document.createElement("p");
    nota.className = "nota";
    nota.textContent =
      t("El modelo es una aproximación para ver el diseño en proporción. La medida del stencil es siempre la del lienzo, en centímetros.");

    // Postura (RF-13): para ver el diseño en una postura natural y para seleccionar mejor las
    // zonas. No se guarda ni cambia los lienzos (se aplanan siempre en la postura base).
    const postura = document.createElement("div");
    postura.className = "postura";
    const simetrica = document.createElement("label");
    simetrica.className = "casilla con-conmutador";
    const casillaSimetrica = (this.casillaSimetrica = document.createElement("input"));
    casillaSimetrica.type = "checkbox";
    casillaSimetrica.className = "conmutador";
    casillaSimetrica.setAttribute("role", "switch");
    casillaSimetrica.checked = true;
    simetrica.append(casillaSimetrica, " " + t("Simetría"));
    simetrica.title = t("Mover igual los dos lados; desmárcala para ajustar cada lado por separado");
    postura.classList.add("simetrica");
    casillaSimetrica.addEventListener("change", () => {
      postura.classList.toggle("simetrica", casillaSimetrica.checked);
      // Al volver a la simetría, el lado derecho copia al izquierdo.
      if (casillaSimetrica.checked) {
        const pose = { ...this.pose };
        for (const k of Object.keys(pose) as (keyof Pose)[]) if (k.endsWith("L")) pose[k.replace(/L$/, "R") as keyof Pose] = pose[k];
        this.fijarPose(pose);
      }
    });
    const fila = (nombre: string, izq: keyof Pose, der: keyof Pose, extremoA: string, extremoB: string) => {
      const f = document.createElement("div");
      f.className = "fila-postura";
      const titulo = document.createElement("span");
      titulo.className = "nombre-postura";
      titulo.textContent = nombre;
      const valor = document.createElement("span");
      valor.className = "valor-postura";
      const lados = document.createElement("div");
      lados.className = "lados-postura";
      const deslizador = (clave: keyof Pose, otra: keyof Pose, lado: string) => {
        const [min, max] = LIMITES_POSE[clave];
        const r = rango(min, max, 1);
        r.value = "0";
        r.title = t("{articulacion} ({lado}): de «{a}» a «{b}»", { articulacion: nombre, lado, a: extremoA, b: extremoB });
        r.addEventListener("input", () => {
          const v = Number(r.value);
          this.pose = { ...this.pose, [clave]: v };
          if (casillaSimetrica.checked) {
            this.pose = { ...this.pose, [otra]: v };
            const o = this.deslizadoresPose[otra];
            if (o) o.value = String(v);
          }
          this.mostrarValoresPose();
          this.guardarPose();
        });
        this.deslizadoresPose[clave] = r;
        const l = document.createElement("label");
        l.className = "lado-postura";
        const s = document.createElement("small");
        s.textContent = lado;
        l.append(s, r);
        return l;
      };
      // Torso y cabeza: un solo deslizador.
      if (izq === der) {
        lados.classList.add("unico");
        lados.append(deslizador(izq, izq, ""));
      } else lados.append(deslizador(izq, der, t("izq.")), deslizador(der, izq, t("der.")));
      this.valoresPose[izq] = valor;
      const cab = document.createElement("div");
      cab.className = "cabecera-postura";
      cab.append(titulo, valor);
      f.append(cab, lados);
      return f;
    };
    const recta = document.createElement("button");
    recta.className = "boton-texto";
    recta.textContent = t("Base");
    recta.title = t("La postura de la malla base, sin girar nada");
    recta.addEventListener("click", () => {
      this.fijarPose(POSE_RECTA);
    });
    const natural = document.createElement("button");
    natural.className = "boton-texto";
    natural.textContent = t("Natural");
    natural.title = t("Brazos bajados junto al cuerpo, codos casi rectos, manos relajadas y piernas juntas");
    natural.addEventListener("click", () => {
      this.fijarPose(POSE_NATURAL);
    });
    const enT = document.createElement("button");
    enT.className = "boton-texto";
    enT.textContent = t("En T");
    enT.title = t("Brazos en horizontal (útil para mangas y axilas)");
    enT.addEventListener("click", () => this.fijarPose(POSE_EN_T));
    this.botonesPostura = [[natural, POSE_NATURAL], [recta, POSE_RECTA], [enT, POSE_EN_T]];
    const atajos = document.createElement("div");
    atajos.className = "atajos-postura";
    atajos.append(natural, recta, enT);
    postura.append(
      atajos,
      simetrica,
      fila(t("Hombros"), "hombroL", "hombroR", t("abajo"), t("en T")),
      fila(t("Brazos"), "brazoL", "brazoR", t("atrás"), t("delante")),
      fila(t("Codos"), "codoL", "codoR", t("recto"), t("doblado")),
      fila(t("Muñecas"), "munecaL", "munecaR", t("hacia fuera"), t("hacia la palma")),
      fila(t("Dedos"), "dedosL", "dedosR", t("abiertos"), t("cerrados")),
      fila(t("Caderas"), "caderaL", "caderaR", t("juntas"), t("abiertas")),
      fila(t("Piernas"), "piernaL", "piernaR", t("atrás"), t("delante")),
      fila(t("Rodillas"), "rodillaL", "rodillaR", t("recta"), t("doblada")),
      fila(t("Cabeza"), "cabeza", "cabeza", t("giro a la derecha"), t("giro a la izquierda")),
    );

    // Cabecera fija; los ajustes, debajo, con su propio scroll.
    const contenido = document.createElement("div");
    contenido.className = "ventana-contenido";
    contenido.append(
      campo(t("Altura"), alturaFila),
      campo(t("Sexo"), this.sexo),
      campo(t("Complexión"), extremos(t("Delgada"), this.peso, t("Robusta"))),
      campo(t("Musculatura"), extremos(t("Poca"), this.musculatura, t("Mucha"))),
      campo(t("Tono de piel"), tonos),
      nota,
      campo(t("Postura"), postura),
    );
    this.element.append(cabecera, contenido);
    this.sincronizar();
  }

  private fijarPose(pose: Pose): void {
    this.mostrarPose(pose);
    this.guardarPose();
  }

  /** Pone los deslizadores en una postura, sin guardarla. */
  private mostrarPose(pose: Pose): void {
    this.pose = { ...pose };
    for (const [k, r] of Object.entries(this.deslizadoresPose) as [keyof Pose, HTMLInputElement][]) r.value = String(pose[k]);
    this.mostrarValoresPose();
  }

  /** La postura se guarda en el proyecto, con el resto del cuerpo. */
  private guardarPose(): void {
    this.cambiar({ pose: { ...this.pose } });
  }

  private mostrarValoresPose(): void {
    for (const [b, p] of this.botonesPostura) b.classList.toggle("activo", mismaPose(this.pose, p));
    const pares: [keyof Pose, keyof Pose][] = [
      ["hombroL", "hombroR"],
      ["brazoL", "brazoR"],
      ["codoL", "codoR"],
      ["munecaL", "munecaR"],
      ["dedosL", "dedosR"],
      ["caderaL", "caderaR"],
      ["piernaL", "piernaR"],
      ["rodillaL", "rodillaR"],
      ["cabeza", "cabeza"],
    ];
    for (const [a, b] of pares) {
      const el = this.valoresPose[a];
      if (!el) continue;
      el.textContent = this.pose[a] === this.pose[b] ? `${this.pose[a]}°` : `${this.pose[a]}° · ${this.pose[b]}°`;
    }
  }

  private marcarSexo(valor: number): void {
    for (const b of this.sexo.querySelectorAll<HTMLElement>("button")) b.classList.toggle("activo", Number(b.dataset.valor) === valor);
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
    this.marcarSexo((m?.sexo ?? 0) >= 0.5 ? 1 : 0);
    this.peso.value = String(Math.round((m?.complexion ?? COMPLEXION_INICIAL.peso) * 100));
    this.musculatura.value = String(Math.round((m?.musculatura ?? COMPLEXION_INICIAL.musculatura) * 100));
    const tono = m?.tonoPiel ?? "#d8a98a";
    for (const b of this.muestras) b.classList.toggle("activo", b.title === tono);
    this.color.refrescar();
    // Postura del proyecto; «Simetría» queda marcada si los dos lados están igual.
    this.mostrarPose(poseDe(m?.pose));
    const simetrica = (Object.keys(this.pose) as (keyof Pose)[]).every((k) => !k.endsWith("L") || this.pose[k] === this.pose[k.replace(/L$/, "R") as keyof Pose]);
    this.casillaSimetrica.checked = simetrica;
    this.casillaSimetrica.closest(".postura")?.classList.toggle("simetrica", simetrica);
  }

  private cambiar(cambios: Partial<ModeloCuerpo>): void {
    void (async () => {
      const proyecto = app.proyecto ?? (await asegurarProyecto());
      proyecto.cambiarModelo(cambios);
      // Tras elegir un tono, los controles deben reflejar los valores nuevos.
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
