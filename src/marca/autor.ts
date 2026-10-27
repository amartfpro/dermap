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
  /** Saludo (título del diálogo). */
  saludo: traducible("Hola, soy {persona}"),
  /** Párrafos de la presentación, en orden. */
  textos: [
    traducible("Soy desarrollador fullstack y diseñador. Detrás de AMART estoy yo: cada aplicación la hago de principio a fin, desde la primera idea y el diseño hasta la última línea de código."),
    traducible("Me gusta crear herramientas para gente que trabaja con las manos y con la imaginación. Si estás usando {aplicacion}, gracias de verdad: saber que te sirve en tu trabajo es lo que me anima a seguir."),
    traducible("Mi sueño es construir, poco a poco, una familia de aplicaciones útiles, bonitas y honestas, sin publicidad ni suscripciones obligatorias. Si tienes una idea o algo no funciona como esperas, me encantará leerte."),
  ],
  /** Texto del enlace a la web. */
  textoWeb: traducible("Conoce el resto de mis aplicaciones y diseños"),
  /** Texto junto al botón de apoyar. */
  textoApoyo: traducible("Si {aplicacion} te ahorra tiempo, puedes apoyar su desarrollo con una donación. Es voluntaria: la aplicación es igual para todos."),
};
