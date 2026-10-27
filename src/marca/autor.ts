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
    traducible("¿Qué tal todo? Soy Ángel, ingeniero informático, desarrollador y diseñador. Trabajo como desarrollador fullstack en aplicaciones de operatividad crítica, como la gestión de incendios, donde una herramienta clara marca la diferencia. Estoy al frente del desarrollo frontend: hablo con quienes la usan, analizo sus flujos de trabajo y los convierto en interfaces sencillas, con mapas y datos geoespaciales, desde la idea hasta producción."),
    traducible("Desde 2020 también estoy en el mundo de la moda: diseño patrones y gráficos y preparo la documentación técnica para fábrica. En 2025 fundé mi propia marca junto a otros tres cracks."),
    traducible("AMART es mi firma personal, donde confluye todo lo que he construido estos años y mi pasión por dar soluciones perfectas a problemas reales: el equilibrio entre un diseño cuidado y accesible y una funcionalidad de verdad, nacida de investigar, escuchar y la experiencia."),
    traducible("Pensar que {aplicacion} te ayuda en tu trabajo es el motor para seguir dando pasos hacia adelante. Gracias, de verdad."),
  ],
  /** Texto del enlace a la web. */
  textoWeb: traducible("Conoce el resto de mis aplicaciones y diseños"),
  /** Texto junto al botón de apoyar. */
  textoApoyo: traducible("Si {aplicacion} te ahorra tiempo, puedes apoyar su desarrollo con una donación. Es voluntaria: la aplicación es igual para todos."),
};
