import { t } from "../i18n";
import { AUTOR } from "../marca/autor";
import urlAutor from "../marca/autor.svg";
import { abrirEnlace } from "./enlaces";
import { icono, type NombreIcono } from "./iconos";
import { version } from "../../package.json";

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

  // Izquierda: la foto y, al fondo, los botones. Derecha: el texto, firmado como una carta.
  const carta = document.createElement("div");
  carta.className = "carta-autor";
  const lateral = document.createElement("div");
  lateral.className = "lateral-autor";
  if (AUTOR.foto) {
    const foto = document.createElement("img");
    foto.className = "foto-autor";
    foto.src = AUTOR.foto;
    foto.alt = AUTOR.nombre;
    lateral.append(foto);
  }
  const acciones = document.createElement("div");
  acciones.className = "acciones-autor";
  const accion = (nombre: NombreIcono, texto: string, url: string, clase = "", ayuda = "") => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `boton-texto con-icono ${clase}`.trim();
    b.append(icono(nombre, 15), texto);
    if (ayuda) b.title = ayuda;
    b.disabled = !url;
    if (!url) b.append(Object.assign(document.createElement("span"), { className: "pronto", textContent: t("Próximamente") }));
    b.addEventListener("click", () => url && void abrirEnlace(url));
    acciones.append(b);
  };
  // El portafolio siempre está: mientras la web no exista, el botón avisa de que llegará.
  accion("web", t("Mi portafolio"), AUTOR.web, "", t(AUTOR.textoWeb));
  if (AUTOR.donaciones) accion("corazon", t("Apoyar el proyecto"), AUTOR.donaciones, "primario", t(AUTOR.textoApoyo, valores));
  if (AUTOR.correo) {
    // Sugerencias y fallos por correo, con la aplicación y su versión ya en el asunto.
    const asunto = encodeURIComponent(`${AUTOR.aplicacion} ${version} · `);
    accion("mensaje", t("Sugerencias y contacto"), `mailto:${AUTOR.correo}?subject=${asunto}`, "", t("Escríbeme con una idea, un fallo o lo que quieras contarme"));
  }
  if (AUTOR.enlaces.length) {
    const redes = document.createElement("div");
    redes.className = "redes-autor";
    for (const e of AUTOR.enlaces) {
      const a = document.createElement("a");
      a.href = e.url;
      a.textContent = e.texto;
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        void abrirEnlace(e.url);
      });
      redes.append(a);
    }
    acciones.append(redes);
  }
  if (acciones.childElementCount) lateral.append(acciones);
  carta.append(lateral);

  const texto = document.createElement("div");
  texto.className = "columna-autor";
  texto.append(titulo, cuerpo, logo);
  carta.append(texto);
  caja.append(carta);

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
