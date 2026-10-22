import { describe, expect, it } from "vitest";
import { aplicarComplexion, COMPLEXION_INICIAL } from "../src/modelos/formas";
import { aplicarMedidas, medirContornos, perimetroEnvolvente } from "../src/modelos/medidas";
import { cuerpoBase, formasBase } from "./utilidades";

describe("medidas reales del cliente", () => {
  it("el perímetro de la envolvente de un círculo es 2πr", () => {
    const pts = Array.from({ length: 200 }, (_, i) => [5 * Math.cos(i / 31.83), 5 * Math.sin(i / 31.83)] as [number, number]);
    expect(perimetroEnvolvente(pts)).toBeCloseTo(2 * Math.PI * 5, 1);
  });

  it("los contornos del modelo son los de un adulto medio", async () => {
    const m = medirContornos(aplicarComplexion(cuerpoBase(), await formasBase(), COMPLEXION_INICIAL));
    expect(m.brazo).toBeGreaterThan(22);
    expect(m.brazo).toBeLessThan(34);
    expect(m.muslo).toBeGreaterThan(m.gemelo);
    expect(m.gemelo).toBeGreaterThan(m.tobillo);
    expect(m.antebrazo).toBeGreaterThan(m.muneca);
  });

  it("ajusta el modelo a los contornos pedidos (±1 %) sin tocar lo no medido", async () => {
    for (const cx of [COMPLEXION_INICIAL, { sexo: 1, musculatura: 0.8, peso: 0.8, altura: 185 }]) {
      const c = aplicarComplexion(cuerpoBase(), await formasBase(), cx);
      const objetivo = { brazo: 33, antebrazo: 28, muneca: 17, gemelo: 39 };
      const ajustado = aplicarMedidas(c, objetivo);
      const m = medirContornos(ajustado);
      for (const [k, v] of Object.entries(objetivo)) expect(Math.abs(m[k as keyof typeof m] / v - 1)).toBeLessThan(0.01);
      // El muslo no se ha pedido: se queda como estaba (salvo la rampa hacia el gemelo).
      expect(Math.abs(m.muslo / medirContornos(c).muslo - 1)).toBeLessThan(0.03);
      // La cabeza no se mueve.
      const cabeza = c.vertices.length / 3 - 1;
      let maxY = 0, iMax = 0;
      for (let i = 0; i <= cabeza; i++) if (c.vertices[3 * i + 1] > maxY) { maxY = c.vertices[3 * i + 1]; iMax = i; }
      expect(ajustado.vertices[3 * iMax + 1]).toBe(c.vertices[3 * iMax + 1]);
    }
  });
});
