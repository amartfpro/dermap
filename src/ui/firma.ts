import urlAutor from "../marca/autor.svg";

/** Firma del desarrollador («Built by» + logo), común a todas sus aplicaciones. */
export function firma(): HTMLElement {
  const el = document.createElement("span");
  el.className = "firma";
  const img = document.createElement("img");
  img.src = urlAutor;
  img.alt = "";
  el.append("Built by", img);
  return el;
}
