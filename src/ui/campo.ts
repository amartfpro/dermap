/**
 * Campo numérico compacto con deslizador desplegable (como los de la barra de control de
 * Illustrator): muestra «Etiqueta 1,5 mm»; arrastrar la etiqueta en horizontal cambia el valor
 * y un clic abre un deslizador. Ocupa poco y deja la barra en una sola fila.
 */
export interface CampoDeslizante {
  el: HTMLElement;
  /** Fija la posición del deslizador (0–1000 u otra escala del control) sin avisar. */
  fijar: (valorDeslizador: number, texto: string) => void;
}

export function campoDeslizante(
  etiqueta: string,
  titulo: string,
  min: number,
  max: number,
  alCambiar: (valorDeslizador: number) => void,
): CampoDeslizante {
  const el = document.createElement("div");
  el.className = "campo-deslizante";
  el.title = titulo;
  const nombre = document.createElement("span");
  nombre.className = "nombre-campo";
  nombre.textContent = etiqueta;
  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "valor-campo";
  el.append(nombre, boton);

  const rango = document.createElement("input");
  rango.type = "range";
  rango.min = String(min);
  rango.max = String(max);
  rango.step = "any";
  rango.className = "deslizador";
  rango.addEventListener("input", () => alCambiar(Number(rango.value)));

  const pop = document.createElement("div");
  pop.className = "popover-campo";
  pop.append(rango);
  const cerrar = () => {
    pop.remove();
    document.removeEventListener("pointerdown", fuera, true);
  };
  const fuera = (e: PointerEvent) => {
    if (!pop.contains(e.target as Node) && !boton.contains(e.target as Node)) cerrar();
  };
  boton.addEventListener("click", () => {
    if (pop.isConnected) return cerrar();
    document.body.append(pop);
    const r = boton.getBoundingClientRect();
    pop.style.left = `${Math.max(6, Math.min(innerWidth - 200, r.left + r.width / 2 - 100))}px`;
    pop.style.top = `${r.bottom + 6}px`;
    setTimeout(() => document.addEventListener("pointerdown", fuera, true));
  });

  // Arrastrar la etiqueta: «scrub» del valor (rápido y sin abrir nada).
  nombre.addEventListener("pointerdown", (e) => {
    nombre.setPointerCapture(e.pointerId);
    const x0 = e.clientX, v0 = Number(rango.value);
    const mover = (ev: PointerEvent) => {
      const v = Math.min(max, Math.max(min, v0 + ((ev.clientX - x0) / 200) * (max - min)));
      rango.value = String(v);
      alCambiar(v);
    };
    const fin = () => {
      nombre.removeEventListener("pointermove", mover);
      nombre.removeEventListener("pointerup", fin);
    };
    nombre.addEventListener("pointermove", mover);
    nombre.addEventListener("pointerup", fin);
  });

  return {
    el,
    fijar: (v, texto) => {
      if (document.activeElement !== rango) rango.value = String(v);
      boton.textContent = texto;
    },
  };
}
