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
      // El muslo y el tobillo no se han pedido: se quedan como estaban.
      const antes = medirContornos(c);
      expect(Math.abs(m.muslo / antes.muslo - 1)).toBeLessThan(0.01);
      expect(Math.abs(m.tobillo / antes.tobillo - 1)).toBeLessThan(0.01);
      // La cabeza no se mueve.
      const cabeza = c.vertices.length / 3 - 1;
      let maxY = 0, iMax = 0;
      for (let i = 0; i <= cabeza; i++) if (c.vertices[3 * i + 1] > maxY) { maxY = c.vertices[3 * i + 1]; iMax = i; }
      expect(ajustado.vertices[3 * iMax + 1]).toBe(c.vertices[3 * iMax + 1]);
    }
  });

  it("medir solo el bíceps no cambia el antebrazo ni la muñeca; los valores se limitan", async () => {
    const { limpiarMedidas } = await import("../src/modelos/medidas");
    const c = aplicarComplexion(cuerpoBase(), await formasBase(), COMPLEXION_INICIAL);
    const antes = medirContornos(c);
    const m = medirContornos(aplicarMedidas(c, { brazo: 38 }));
    expect(Math.abs(m.brazo / 38 - 1)).toBeLessThan(0.01);
    expect(Math.abs(m.antebrazo / antes.antebrazo - 1)).toBeLessThan(0.01);
    expect(Math.abs(m.muneca / antes.muneca - 1)).toBeLessThan(0.01);
    expect(limpiarMedidas({ brazo: 200, muneca: 14.3, tobillo: 0 })).toEqual({ brazo: 60, muneca: 14.5 });
  });
});
