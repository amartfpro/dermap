import { describe, expect, it } from "vitest";
import { necesitaTraduccion, textosDelCodigo } from "../scripts/textos";
import en from "../src/i18n/en.json";
import { t } from "../src/i18n";

const llaves = (x: string) => [...x.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("traducciones (RNF-14)", () => {
  const textos = [...textosDelCodigo()].filter(necesitaTraduccion);
  const ingles = en as Record<string, string>;

  it("hay textos que traducir", () => {
    expect(textos.length).toBeGreaterThan(200);
  });

  it("todos los textos del código están traducidos al inglés", () => {
    expect(textos.filter((x) => !ingles[x])).toEqual([]);
  });

  it("las traducciones conservan los valores variables", () => {
    const mal = textos.filter((x) => ingles[x] && llaves(x).join() !== llaves(ingles[x]).join());
    expect(mal).toEqual([]);
  });

  it("sustituye los valores en español", () => {
    expect(t("Capa «{capa}» copiada. Pégala con Ctrl+V en este u otro lienzo.", { capa: "Líneas" })).toBe(
      "Capa «Líneas» copiada. Pégala con Ctrl+V en este u otro lienzo.",
    );
  });
});
