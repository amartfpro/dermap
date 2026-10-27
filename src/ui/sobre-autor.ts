import { t } from "../i18n";
import { AUTOR } from "../marca/autor";
import urlAutor from "../marca/autor.svg";
import { version } from "../../package.json";
import { abrirEnlace } from "./enlaces";

/** «Sobre AMART»: quién hace la aplicación, agradecimiento, enlaces y, si la hay, donaciones. */
export function abrirSobreAutor(): void {
  if (document.querySelector(".modal-autor")) return;
  const valores = { aplicacion: AUTOR.aplicacion };
  const fondo = document.createElement("div");
  fondo.className = "fondo-modal";
  const caja = document.createElement("div");
  caja.className = "modal modal-autor";
  caja.setAttribute("role", "dialog");
  caja.setAttribute("aria-label", t("Sobre {nombre}", { nombre: AUTOR.nombre }));
  fondo.append(caja);

  const logo = document.createElement("img");
  logo.className = "logo-autor";
  logo.src = urlAutor;
  logo.alt = AUTOR.nombre;
  const titulo = document.createElement("h2");
  titulo.textContent = t("Sobre {nombre}", { nombre: AUTOR.nombre });

  const cuerpo = document.createElement("div");
  cuerpo.className = "texto-autor";
  for (const texto of AUTOR.textos) {
    const p = document.createElement("p");
    p.textContent = t(texto, valores);
    cuerpo.append(p);
  }

  // Cabecera: la foto (si la hay) junto al logo y el título.
  const cabecera = document.createElement("div");
  cabecera.className = "cabecera-autor";
  if (AUTOR.foto) {
    const foto = document.createElement("img");
    foto.className = "foto-autor";
    foto.src = AUTOR.foto;
    foto.alt = AUTOR.nombre;
    cabecera.append(foto);
  }
  const nombre = document.createElement("div");
  nombre.className = "nombre-autor";
  nombre.append(logo, titulo);
  cabecera.append(nombre);
  caja.append(cabecera, cuerpo);

  if (AUTOR.donaciones) {
    const apoyo = document.createElement("div");
    apoyo.className = "apoyo-autor";
    const p = document.createElement("p");
    p.textContent = t(AUTOR.textoApoyo, valores);
    const boton = document.createElement("button");
    boton.type = "button";
    boton.className = "boton-texto primario";
    boton.textContent = t("Apoyar el proyecto");
    boton.addEventListener("click", () => void abrirEnlace(AUTOR.donaciones));
    apoyo.append(p, boton);
    caja.append(apoyo);
  }

  if (AUTOR.enlaces.length) {
    const enlaces = document.createElement("div");
    enlaces.className = "enlaces-autor";
    for (const e of AUTOR.enlaces) {
      const a = document.createElement("a");
      a.href = e.url;
      a.textContent = e.texto;
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        void abrirEnlace(e.url);
      });
      enlaces.append(a);
    }
    caja.append(enlaces);
  }

  const pie = document.createElement("div");
  pie.className = "modal-pie";
  const version_ = document.createElement("span");
  version_.className = "estado-modal";
  version_.textContent = `${AUTOR.aplicacion} ${version}`;
  const cerrarBoton = document.createElement("button");
  cerrarBoton.type = "button";
  cerrarBoton.className = "boton-texto";
  cerrarBoton.textContent = t("Cerrar");
  pie.append(version_, cerrarBoton);
  caja.append(pie);

  const cerrar = () => {
    fondo.remove();
    window.removeEventListener("keydown", alTecla, true);
  };
  const alTecla = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      cerrar();
    }
  };
  window.addEventListener("keydown", alTecla, true);
  cerrarBoton.addEventListener("click", cerrar);
  fondo.addEventListener("mousedown", (e) => {
    if (e.target === fondo) cerrar();
  });
  document.body.append(fondo);
  cerrarBoton.focus();
}
