import { icono, type NombreIcono } from "./iconos";

export interface OpcionMenu {
  texto: string;
  icono?: NombreIcono;
  atajo?: string;
  marcado?: boolean;
  deshabilitado?: boolean;
  /** Texto pequeño a la derecha (p. ej. «80 % común»). */
  detalle?: string;
  accion?: () => void;
}
export type ElementoMenu = OpcionMenu | "separador" | { titulo: string };

let cerrarAbierto: (() => void) | null = null;

/** Menú desplegable junto a un botón (como los menús de los paneles de Illustrator). */
export function abrirMenu(ancla: HTMLElement, elementos: ElementoMenu[], opciones: { lado?: "abajo" | "derecha" } = {}): void {
  if (cerrarAbierto) {
    const yaEraEste = ancla.classList.contains("menu-abierto");
    cerrarAbierto();
    if (yaEraEste) return;
  }
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.setAttribute("role", "menu");
  for (const el of elementos) {
    if (el === "separador") {
      menu.append(Object.assign(document.createElement("div"), { className: "menu-separador" }));
      continue;
    }
    if ("titulo" in el) {
      menu.append(Object.assign(document.createElement("div"), { className: "menu-titulo", textContent: el.titulo }));
      continue;
    }
    const b = document.createElement("button");
    b.type = "button";
    b.className = "menu-opcion";
    b.disabled = !!el.deshabilitado;
    const ico = document.createElement("span");
    ico.className = "menu-ico";
    if (el.marcado) ico.append(icono("check", 14));
    else if (el.icono) ico.append(icono(el.icono, 15));
    const texto = document.createElement("span");
    texto.className = "menu-texto";
    texto.textContent = el.texto;
    b.append(ico, texto);
    if (el.detalle || el.atajo) {
      const d = document.createElement("span");
      d.className = el.atajo ? "menu-atajo" : "menu-detalle";
      d.textContent = el.atajo ?? el.detalle ?? "";
      b.append(d);
    }
    b.addEventListener("click", () => {
      cerrar();
      el.accion?.();
    });
    menu.append(b);
  }
  document.body.append(menu);
  ancla.classList.add("menu-abierto");
  const r = ancla.getBoundingClientRect();
  const m = menu.getBoundingClientRect();
  let x = opciones.lado === "derecha" ? r.right + 6 : r.left;
  let y = opciones.lado === "derecha" ? r.top : r.bottom + 4;
  if (x + m.width > innerWidth - 6) x = innerWidth - m.width - 6;
  if (y + m.height > innerHeight - 6) y = Math.max(6, innerHeight - m.height - 6);
  menu.style.left = `${Math.max(6, x)}px`;
  menu.style.top = `${y}px`;

  const fuera = (e: PointerEvent) => {
    if (!menu.contains(e.target as Node) && !ancla.contains(e.target as Node)) cerrar();
  };
  const tecla = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      cerrar();
    }
  };
  function cerrar() {
    menu.remove();
    ancla.classList.remove("menu-abierto");
    document.removeEventListener("pointerdown", fuera, true);
    window.removeEventListener("keydown", tecla, true);
    cerrarAbierto = null;
  }
  setTimeout(() => document.addEventListener("pointerdown", fuera, true));
  window.addEventListener("keydown", tecla, true);
  cerrarAbierto = cerrar;
}

/** Botón de icono que abre un menú (con una flechita para indicarlo). */
export function botonMenu(nombre: NombreIcono, titulo: string, elementos: () => ElementoMenu[], opciones: { lado?: "abajo" | "derecha"; clase?: string } = {}): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `boton-texto solo-icono con-menu ${opciones.clase ?? ""}`.trim();
  b.title = titulo;
  b.setAttribute("aria-label", titulo);
  b.append(icono(nombre));
  b.addEventListener("click", () => abrirMenu(b, elementos(), opciones));
  return b;
}
