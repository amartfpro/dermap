/**
 * Tooltips propios (como en Illustrator): aparecen enseguida, con el nombre y el atajo de
 * teclado aparte. Se aplican a cualquier elemento con `title`: al pasar el ratón, el título se
 * mueve a `data-tip` para que no salga además el del sistema.
 */
let caja: HTMLElement | null = null;
let temporizador: ReturnType<typeof setTimeout> | null = null;
let actual: HTMLElement | null = null;
/** Si se acaba de ver un tooltip, el siguiente sale sin espera (al recorrer una barra). */
let ultimoCierre = 0;

export function instalarTooltips(): void {
  document.addEventListener("pointerover", (e) => {
    const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>("[title], [data-tip]");
    if (!el || el === actual) return;
    if (el.hasAttribute("title")) {
      const t = el.getAttribute("title") ?? "";
      el.removeAttribute("title");
      if (t) el.dataset.tip = t;
    }
    if (!el.dataset.tip) return;
    ocultar();
    actual = el;
    const espera = Date.now() - ultimoCierre < 600 ? 0 : 450;
    temporizador = setTimeout(() => mostrar(el), espera);
  });
  document.addEventListener("pointerout", (e) => {
    if (!actual) return;
    const hacia = e.relatedTarget as Node | null;
    if (hacia && actual.contains(hacia)) return;
    ocultar();
  });
  for (const ev of ["pointerdown", "wheel", "keydown"]) document.addEventListener(ev, () => ocultar(), true);
}

function mostrar(el: HTMLElement): void {
  if (!el.isConnected || actual !== el) return;
  const texto = el.dataset.tip ?? "";
  caja ??= Object.assign(document.createElement("div"), { className: "tooltip" });
  caja.replaceChildren();
  // «Nombre (atajo)» → nombre y atajo por separado.
  const m = /^(.*?)\s*\(([^()]{1,24})\)\s*([.:]?)$/.exec(texto);
  const atajo = m && /^(Ctrl|Mayús|Shift|Alt|Cmd|F\d|Intro|Enter|Esc|[A-Z0-9[\]+ ·o,]+$)/.test(m[2]) ? m[2] : null;
  const nombre = document.createElement("span");
  nombre.textContent = atajo ? m![1] : texto;
  caja.append(nombre);
  if (atajo) {
    const k = document.createElement("kbd");
    k.textContent = atajo;
    caja.append(k);
  }
  document.body.append(caja);
  const r = el.getBoundingClientRect();
  const c = caja.getBoundingClientRect();
  // En los rieles verticales, a la derecha; en el resto, debajo (o encima si no cabe).
  const enRiel = !!el.closest(".riel");
  let x: number, y: number;
  if (enRiel) {
    x = r.right + 8;
    y = r.top + r.height / 2 - c.height / 2;
  } else {
    x = r.left + r.width / 2 - c.width / 2;
    y = r.bottom + 6;
    if (y + c.height > innerHeight - 6) y = r.top - c.height - 6;
  }
  caja.style.left = `${Math.max(6, Math.min(innerWidth - c.width - 6, x))}px`;
  caja.style.top = `${Math.max(6, y)}px`;
  caja.classList.add("visible");
}

function ocultar(): void {
  if (temporizador) clearTimeout(temporizador);
  temporizador = null;
  if (caja?.classList.contains("visible")) ultimoCierre = Date.now();
  caja?.classList.remove("visible");
  caja?.remove();
  actual = null;
}
