import { t } from "../i18n";
import { AUTOR } from "../marca/autor";
import urlAutor from "../marca/autor.svg";
import { abrirSobreAutor } from "./sobre-autor";

/** Firma del desarrollador («Built by» + logo), común a todas sus aplicaciones. Abre «Sobre AMART». */
export function firma(): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "firma";
  el.title = t("Sobre {nombre}", { nombre: AUTOR.nombre });
  const img = document.createElement("img");
  img.src = urlAutor;
  img.alt = AUTOR.nombre;
  const texto = document.createElement("span");
  texto.className = "texto-firma";
  texto.textContent = t("Construido por");
  el.append(texto, img);
  el.addEventListener("click", abrirSobreAutor);
  return el;
}
