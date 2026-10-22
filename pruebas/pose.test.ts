import { describe, expect, it } from "vitest";
import { aplicarComplexion, COMPLEXION_INICIAL } from "../src/modelos/formas";
import { aplicarPose, POSE_RECTA } from "../src/modelos/pose";
import { cuerpoBase, formasBase } from "./utilidades";

describe("postura (RF-13)", () => {
  it("dobla el codo moviendo antebrazo y mano enteros, sin tocar el torso ni el otro brazo", async () => {
    const c = aplicarComplexion(cuerpoBase(), await formasBase(), COMPLEXION_INICIAL);
    expect(aplicarPose(c, POSE_RECTA)).toBe(c);
    const p = aplicarPose(c, { ...POSE_RECTA, codoL: 90 });
    const v0 = c.vertices, v1 = p.vertices;
    const movido = (i: number) => Math.hypot(v1[3 * i] - v0[3 * i], v1[3 * i + 1] - v0[3 * i + 1], v1[3 * i + 2] - v0[3 * i + 2]);
    const cerca = (pt: number[]) => {
      let mejor = 0, d = Infinity;
      for (let i = 0; i < v0.length / 3; i++) {
        const e = (v0[3 * i] - pt[0]) ** 2 + (v0[3 * i + 1] - pt[1]) ** 2 + (v0[3 * i + 2] - pt[2]) ** 2;
        if (e < d) { d = e; mejor = i; }
      }
      return mejor;
    };
    const a = c.articulaciones;
    expect(movido(cerca(a["l-hand"]))).toBeGreaterThan(15);
    expect(movido(cerca(a["l-finger-3-3"] ?? a["l-hand"]))).toBeGreaterThan(15);
    expect(movido(cerca(a["r-hand"]))).toBe(0);
    expect(movido(cerca(a["spine-3"] ?? [0, 120, 0]))).toBe(0);
    expect(movido(cerca(a["l-shoulder"]))).toBe(0);
  });

  it("dobla la rodilla llevando el pie hacia atrás", async () => {
    const c = aplicarComplexion(cuerpoBase(), await formasBase(), COMPLEXION_INICIAL);
    const p = aplicarPose(c, { ...POSE_RECTA, rodillaL: 90 });
    expect(p.articulaciones["l-ankle"][2]).toBeLessThan(c.articulaciones["l-ankle"][2] - 20);
    expect(p.articulaciones["r-ankle"]).toEqual(c.articulaciones["r-ankle"]);
  });
});
