import { traducible } from "../i18n";

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
  aplicacion: "Dermap",
  /** Página de donaciones. */
  donaciones: "",
  /** Web, redes y contacto (mailto: para el correo). */
  enlaces: [] as { texto: string; url: string }[],
  /** Párrafos de la presentación, en orden. */
  textos: [
    traducible("Soy AMART, desarrollador independiente. Hago herramientas para oficios creativos: aplicaciones cuidadas, que funcionan sin conexión y que respetan tu trabajo y tus datos."),
    traducible("Gracias por usar {aplicacion}. Cada proyecto que planificas con ella me ayuda a seguir mejorándola."),
    traducible("Mi objetivo es construir una familia de aplicaciones para artistas y estudios: útiles de verdad, sin publicidad y sin suscripciones obligatorias."),
  ],
  /** Texto junto al botón de apoyar. */
  textoApoyo: traducible("Si {aplicacion} te ahorra tiempo, puedes apoyar su desarrollo con una donación. Es voluntaria: la aplicación es igual para todos."),
};
