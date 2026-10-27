import { traducible } from "../i18n";
import urlFoto from "./autor-foto.jpg";

/**
 * Datos del desarrollador para «Sobre AMART», comunes a todas sus aplicaciones: al reutilizar
 * la firma en otra aplicación basta con cambiar `aplicacion` (y, si hace falta, los textos).
 * Los textos se traducen como el resto de la interfaz (i18n/en.json).
 *
 * Un enlace vacío no se muestra: el botón de apoyar aparece cuando `donaciones` tiene la
 * dirección de la página (Ko-fi, Buy Me a Coffee, GitHub Sponsors, PayPal…).
 */
export const AUTOR = {
  nombre: "AMART",
  /** Nombre de la persona: el saludo del diálogo. */
  persona: "Ángel",
  aplicacion: "Dermap",
  /** Foto del autor (se muestra entera, en cuadrado). Vacía: sin foto. */
  foto: urlFoto as string,
  /** Web con el portafolio completo de aplicaciones y diseños (común a todas las aplicaciones). */
  web: "",
  /** Página de donaciones. */
  donaciones: "",
  /** Redes y contacto (mailto: para el correo). */
  enlaces: [] as { texto: string; url: string }[],
  /** Título del diálogo. */
  saludo: traducible("Sobre {nombre}"),
  /** Párrafos de la presentación, en orden. */
  textos: [
    traducible("¿Qué tal todo? Soy Ángel, desarrollador y diseñador. Soy ingeniero informático, trabajo creando aplicaciones web y, desde 2020, diseño para mis propias marcas de ropa."),
    traducible("AMART es donde junto las dos cosas: aplicaciones que hago de principio a fin, con el mismo cuidado por cómo funcionan que por cómo se ven."),
    traducible("Si estás usando {aplicacion}, gracias de verdad. Saber que te sirve en tu trabajo es lo que me anima a seguir mejorándola."),
  ],
  /** Texto del enlace a la web. */
  textoWeb: traducible("Conoce el resto de mis aplicaciones y diseños"),
  /** Texto junto al botón de apoyar. */
  textoApoyo: traducible("Si {aplicacion} te ahorra tiempo, puedes apoyar su desarrollo con una donación. Es voluntaria: la aplicación es igual para todos."),
};
