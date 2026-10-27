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
  /** Web con el portafolio completo de aplicaciones y diseños (común a todas las aplicaciones). Vacía: el botón sale como «Próximamente». */
  web: "",
  /** Correo para sugerencias y fallos (el botón abre el programa de correo). */
  correo: "amartfpro@gmail.com",
  /** Página de donaciones. */
  donaciones: "",
  /** Redes (Instagram, GitHub, LinkedIn…), como enlaces de texto bajo los botones. */
  enlaces: [] as { texto: string; url: string }[],
  /** Título del diálogo. */
  saludo: traducible("Sobre {nombre}"),
  /** Párrafos de la presentación, en orden. */
  textos: [
    traducible("¿Qué tal? Soy Ángel, ingeniero informático y diseñador."),
    traducible("Como desarrollador fullstack creo aplicaciones GIS de operatividad crítica, como la gestión de incendios. Escucho a los operarios, analizo cómo trabajan y lo convierto en herramientas precisas para la labor correspondiente."),
    traducible("Desde 2020 también estoy metido en el mundo de la moda: creo patrones, diseño gráficos y preparo la documentación técnica para fábrica. En 2025 fundé mi propia marca, AM2T, junto a otros tres cracks."),
    traducible("AMART es mi firma personal, donde confluye todo lo que he construido estos años y mi pasión por dar soluciones perfectas a problemas reales: el equilibrio entre un diseño cuidado y accesible y una funcionalidad de verdad, nacida de investigar, escuchar y aprender."),
    traducible("Pensar que {aplicacion} te ayuda en tu trabajo es el motor para seguir dando pasos hacia adelante. Gracias, de verdad."),
  ],
  /** Texto de ayuda del botón del portafolio. */
  textoWeb: traducible("Conoce el resto de mis aplicaciones y diseños"),
  /** Texto junto al botón de apoyar. */
  textoApoyo: traducible("Si {aplicacion} te ahorra tiempo, puedes apoyar su desarrollo con una donación. Es voluntaria: la aplicación es igual para todos."),
};
