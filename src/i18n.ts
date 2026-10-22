import en from "./i18n/en.json";

/**
 * Textos de la interfaz (RNF-14). El texto en español es la clave: `t("Guardar")`. Cada
 * idioma es un archivo de traducción en src/i18n/ (español → idioma); lo que falte se
 * muestra en español. Los valores variables van entre llaves: `t("Capa «{nombre}»", { nombre })`.
 *
 * Para traducir a otro idioma: copia src/i18n/en.json con otro nombre, traduce los valores y
 * añádelo a IDIOMAS. `npm test` comprueba que ningún texto del código falte en los archivos.
 */
export const IDIOMAS: Record<string, { nombre: string; textos: Record<string, string> }> = {
  es: { nombre: "Español", textos: {} },
  en: { nombre: "English", textos: en as Record<string, string> },
};

const CLAVE = "dermap.idioma";

function idiomaInicial(): string {
  try {
    const guardado = localStorage.getItem(CLAVE);
    if (guardado && IDIOMAS[guardado]) return guardado;
  } catch {
    // Sin almacenamiento local.
  }
  // Por defecto, español (el idioma de origen); el otro se elige en la barra superior.
  return "es";
}

let idioma = idiomaInicial();

export function idiomaActual(): string {
  return idioma;
}

/** Cambia el idioma y recarga la interfaz (los textos se leen al construir los paneles). */
export function cambiarIdioma(nuevo: string): void {
  if (!IDIOMAS[nuevo] || nuevo === idioma) return;
  try {
    localStorage.setItem(CLAVE, nuevo);
  } catch {
    // Sin almacenamiento local: solo dura esta sesión.
  }
  idioma = nuevo;
  location.reload();
}

/** Texto traducido al idioma actual, con los valores `{nombre}` sustituidos. */
export function t(texto: string, valores?: Record<string, string | number>): string {
  const traducido = IDIOMAS[idioma]?.textos[texto] || texto;
  if (!valores) return traducido;
  return traducido.replace(/\{(\w+)\}/g, (m, k: string) => (k in valores ? String(valores[k]) : m));
}

/** Singular o plural: `plural(n, "lienzo", "lienzos")` → «1 lienzo», «3 lienzos». */
export function plural(n: number, uno: string, varios: string): string {
  return t(n === 1 ? uno : varios, { n });
}

/** Marca un texto para traducir sin traducirlo aún (datos que se traducen al mostrarlos). */
export const traducible = (texto: string): string => texto;
