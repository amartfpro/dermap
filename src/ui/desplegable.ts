import { abrirMenu } from "./menu";

export interface OpcionDesplegable {
  valor: string;
  texto: string;
  /** Tipografía con la que se muestra la opción (p. ej. en el selector de tipografías). */
  fuente?: string;
}

/**
 * Desplegable propio (en lugar del `<select>` del sistema): un botón con el valor actual que abre
 * el menú de la aplicación. Se usa como un `<select>`: `value` y los eventos «input» y «change».
 */
export interface Desplegable extends HTMLButtonElement {
  value: string;
  opciones: OpcionDesplegable[];
}

export function desplegable(opciones: OpcionDesplegable[], valor = opciones[0]?.valor ?? "", titulo = ""): Desplegable {
  const b = document.createElement("button") as Desplegable;
  b.type = "button";
  b.className = "desplegable";
  if (titulo) b.title = titulo;
  const etiqueta = document.createElement("span");
  etiqueta.className = "desplegable-texto";
  b.append(etiqueta);

  let actual = valor;
  let lista = opciones;
  const pintar = () => {
    const o = lista.find((x) => x.valor === actual);
    etiqueta.textContent = o?.texto ?? "";
    etiqueta.style.fontFamily = o?.fuente ?? "";
  };
  Object.defineProperty(b, "value", {
    get: () => actual,
    set: (v: string) => {
      actual = String(v);
      pintar();
    },
  });
  Object.defineProperty(b, "opciones", {
    get: () => lista,
    set: (v: OpcionDesplegable[]) => {
      lista = v;
      pintar();
    },
  });
  const elegir = (v: string) => {
    if (v === actual) return;
    actual = v;
    pintar();
    // Como un <select>: «input» y «change».
    b.dispatchEvent(new Event("input", { bubbles: true }));
    b.dispatchEvent(new Event("change", { bubbles: true }));
  };
  b.addEventListener("click", () =>
    abrirMenu(
      b,
      lista.map((o) => ({ texto: o.texto, fuente: o.fuente, marcado: o.valor === actual, accion: () => elegir(o.valor) })),
      { anchoMinimo: b.getBoundingClientRect().width },
    ),
  );
  // Flechas con el desplegable enfocado: opción anterior o siguiente, como un <select>.
  b.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = lista.findIndex((o) => o.valor === actual);
    const j = Math.min(lista.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)));
    if (lista[j]) elegir(lista[j].valor);
  });
  pintar();
  return b;
}
