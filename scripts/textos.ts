import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Textos traducibles del código (RNF-14): los de `t("…")`, `traducible("…")` y
 * `plural(n, "…", "…")`. Los usan la prueba de traducciones y
 * `npx tsx scripts/textos.ts`, que lista los que faltan en un archivo de idioma.
 */
export function textosDelCodigo(carpeta = fileURLToPath(new URL("../src", import.meta.url))): Set<string> {
  const textos = new Set<string>();
  const literal = String.raw`"((?:[^"\\]|\\.)*)"`;
  const patrones = [
    new RegExp(String.raw`\bt\(\s*${literal}`, "g"),
    new RegExp(String.raw`\btraducible\(\s*${literal}`, "g"),
    new RegExp(String.raw`\bplural\(\s*[^,]+,\s*${literal},\s*${literal}`, "g"),
  ];
  const recorrer = (dir: string) => {
    for (const nombre of readdirSync(dir)) {
      const ruta = join(dir, nombre);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (ruta.endsWith(".ts") && !ruta.endsWith("i18n.ts")) {
        const codigo = readFileSync(ruta, "utf8");
        for (const p of patrones)
          for (const m of codigo.matchAll(p))
            for (const g of m.slice(1)) if (g !== undefined) textos.add(JSON.parse(`"${g}"`));
      }
    }
  };
  recorrer(carpeta);
  return textos;
}

/** Textos que necesitan traducción (los que tienen letras). */
export const necesitaTraduccion = (texto: string) => /[A-Za-zÁÉÍÓÚáéíóúÑñ]{2,}/.test(texto);

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const idioma = process.argv[2] ?? "en";
  const archivo = JSON.parse(readFileSync(new URL(`../src/i18n/${idioma}.json`, import.meta.url), "utf8")) as Record<string, string>;
  const faltan = [...textosDelCodigo()].filter((x) => necesitaTraduccion(x) && !archivo[x]);
  console.log(JSON.stringify(Object.fromEntries(faltan.map((x) => [x, ""])), null, 2));
  console.error(`${faltan.length} textos sin traducir en ${idioma}.json`);
}
