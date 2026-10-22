import { describe, expect, it } from "vitest";
import { aplicarComplexion, COMPLEXION_INICIAL } from "../src/modelos/formas";
import { ejeDelBrazo } from "../src/modelos/cuerpo";
import { longitud } from "../src/geometria/seleccion";
import { cuerpoBase, formasBase } from "./utilidades";

const alturaDe = (v: Float64Array) => {
  let min = Infinity, max = -Infinity;
  for (let i = 1; i < v.length; i += 3) {
    min = Math.min(min, v[i]);
    max = Math.max(max, v[i]);
  }
  return { min, max };
};

describe("complexión del cuerpo (RF-12)", () => {
  it("da la altura exacta con los pies en el suelo y la misma topología", async () => {
    const base = cuerpoBase();
    for (const altura of [150, 170, 195]) {
      const c = aplicarComplexion(base, await formasBase(), { ...COMPLEXION_INICIAL, altura });
      const { min, max } = alturaDe(c.vertices);
      expect(min).toBeCloseTo(0, 6);
      expect(max).toBeCloseTo(altura, 6);
      expect(c.vertices.length).toBe(base.vertices.length);
      expect(c.caras).toBe(base.caras);
      expect(c.altura).toBe(altura);
    }
  });

  it("los brazos crecen con la altura y la robustez engorda el brazo", async () => {
    const base = cuerpoBase();
    const f = await formasBase();
    const bajo = aplicarComplexion(base, f, { ...COMPLEXION_INICIAL, altura: 155 });
    const alto = aplicarComplexion(base, f, { ...COMPLEXION_INICIAL, altura: 190 });
    expect(longitud(ejeDelBrazo(alto, "l"))).toBeGreaterThan(longitud(ejeDelBrazo(bajo, "l")) * 1.1);

    // Distancia media de los vértices del antebrazo a su eje.
    const grosor = (peso: number) => {
      const c = aplicarComplexion(base, f, { ...COMPLEXION_INICIAL, peso });
      const [, codo, mano] = ejeDelBrazo(c, "l");
      let suma = 0, n = 0;
      for (let i = 0; i < c.vertices.length; i += 3) {
        const p = [c.vertices[i], c.vertices[i + 1], c.vertices[i + 2]];
        const d = [mano[0] - codo[0], mano[1] - codo[1], mano[2] - codo[2]];
        const l2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
        const t = ((p[0] - codo[0]) * d[0] + (p[1] - codo[1]) * d[1] + (p[2] - codo[2]) * d[2]) / l2;
        if (t < 0.3 || t > 0.7) continue;
        const q = [codo[0] + t * d[0] - p[0], codo[1] + t * d[1] - p[1], codo[2] + t * d[2] - p[2]];
        const r = Math.hypot(q[0], q[1], q[2]);
        if (r > 7) continue;
        suma += r;
        n++;
      }
      return suma / n;
    };
    expect(grosor(1)).toBeGreaterThan(grosor(0) * 1.1);
  });
});
