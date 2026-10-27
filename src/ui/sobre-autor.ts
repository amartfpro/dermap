import { t } from "../i18n";
import { AUTOR } from "../marca/autor";
import urlAutor from "../marca/autor.svg";
import { abrirEnlace } from "./enlaces";

/**
 * «Sobre AMART»: quién hace la aplicación, agradecimiento, enlaces y, si la hay, donaciones.
 * Se cierra con Esc o pulsando fuera.
 */
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
  logo.className = "firma-autor";
  logo.src = urlAutor;
  logo.alt = AUTOR.nombre;
  const titulo = document.createElement("h2");
  titulo.textContent = t(AUTOR.saludo, { nombre: AUTOR.nombre, persona: AUTOR.persona });

  const cuerpo = document.createElement("div");
  cuerpo.className = "texto-autor";
  for (const texto of AUTOR.textos) {
    const p = document.createElement("p");
    p.textContent = t(texto, valores);
    cuerpo.append(p);
  }

  // La foto (si la hay) a la izquierda; a la derecha el texto, firmado abajo como una carta.
  const carta = document.createElement("div");
  carta.className = "carta-autor";
  if (AUTOR.foto) {
    const foto = document.createElement("img");
    foto.className = "foto-autor";
    foto.src = AUTOR.foto;
    foto.alt = AUTOR.nombre;
    carta.append(foto);
  }
  const texto = document.createElement("div");
  texto.className = "columna-autor";
  texto.append(titulo, cuerpo, logo);
  // La web con todo el portafolio: el enlace principal del diálogo.
  if (AUTOR.web) {
    const web = document.createElement("a");
    web.className = "web-autor";
    web.href = AUTOR.web;
    web.textContent = `${t(AUTOR.textoWeb)} →`;
    web.addEventListener("click", (ev) => {
      ev.preventDefault();
      void abrirEnlace(AUTOR.web);
    });
    texto.append(web);
  }
  carta.append(texto);
  caja.append(carta);

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
  fondo.addEventListener("mousedown", (e) => {
    if (e.target === fondo) cerrar();
  });
  document.body.append(fondo);
}
