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

describe("postura de hombros y caderas", () => {
  it("baja el brazo hacia el costado sin mover el tronco ni el otro brazo", async () => {
    const { aplicarComplexion, COMPLEXION_INICIAL } = await import("../src/modelos/formas");
    const { aplicarPose, POSE_RECTA } = await import("../src/modelos/pose");
    const { cuerpoBase, formasBase } = await import("./utilidades");
    const c = aplicarComplexion(cuerpoBase(), await formasBase(), COMPLEXION_INICIAL);
    const p = aplicarPose(c, { ...POSE_RECTA, hombroL: -30 });
    const a0 = c.articulaciones, a1 = p.articulaciones;
    // La mano baja y se acerca al cuerpo.
    expect(a1["l-hand"][1]).toBeLessThan(a0["l-hand"][1] - 5);
    expect(a1["l-hand"][0]).toBeLessThan(a0["l-hand"][0] - 5);
    expect(a1["r-hand"]).toEqual(a0["r-hand"]);
    // El esternón y la columna no se mueven.
    const v0 = c.vertices, v1 = p.vertices;
    let tronco = 0;
    for (let i = 0; i < v0.length / 3; i++) {
      if (Math.abs(v0[3 * i]) < 9 && v0[3 * i + 1] > 95 && v0[3 * i + 1] < 135) {
        tronco = Math.max(tronco, Math.hypot(v1[3 * i] - v0[3 * i], v1[3 * i + 1] - v0[3 * i + 1], v1[3 * i + 2] - v0[3 * i + 2]));
      }
    }
    expect(tronco).toBeLessThan(0.01);
  });

  it("sube el brazo en T y el codo sigue doblando hacia delante", async () => {
    const { aplicarComplexion, COMPLEXION_INICIAL } = await import("../src/modelos/formas");
    const { aplicarPose, POSE_RECTA } = await import("../src/modelos/pose");
    const { cuerpoBase, formasBase } = await import("./utilidades");
    const c = aplicarComplexion(cuerpoBase(), await formasBase(), COMPLEXION_INICIAL);
    const p = aplicarPose(c, { ...POSE_RECTA, hombroL: 48, codoL: 90 });
    const a = p.articulaciones;
    // Codo casi a la altura del hombro y antebrazo hacia delante.
    expect(Math.abs(a["l-elbow"][1] - a["l-shoulder"][1])).toBeLessThan(6);
    expect(a["l-hand"][2]).toBeGreaterThan(a["l-elbow"][2] + 15);
  });

  it("cierra la pierna moviendo el tobillo hacia dentro", async () => {
    const { aplicarComplexion, COMPLEXION_INICIAL } = await import("../src/modelos/formas");
    const { aplicarPose, POSE_RECTA } = await import("../src/modelos/pose");
    const { cuerpoBase, formasBase } = await import("./utilidades");
    const c = aplicarComplexion(cuerpoBase(), await formasBase(), COMPLEXION_INICIAL);
    const p = aplicarPose(c, { ...POSE_RECTA, caderaR: -6 });
    expect(Math.abs(p.articulaciones["r-ankle"][0])).toBeLessThan(Math.abs(c.articulaciones["r-ankle"][0]) - 2);
    expect(p.articulaciones["l-ankle"]).toEqual(c.articulaciones["l-ankle"]);
  });
});

describe("postura natural", () => {
  it("no mueve la cabeza, el pecho ni el ombligo", async () => {
    const { aplicarComplexion, COMPLEXION_INICIAL } = await import("../src/modelos/formas");
    const { aplicarPose, POSE_RECTA } = await import("../src/modelos/pose");
    const { cuerpoBase, formasBase } = await import("./utilidades");
    const c = aplicarComplexion(cuerpoBase(), await formasBase(), COMPLEXION_INICIAL);
    const p = aplicarPose(c, { ...POSE_RECTA, hombroL: -32, hombroR: -32, caderaL: -6, caderaR: -6 });
    const v0 = c.vertices, v1 = p.vertices;
    let max = 0;
    for (let i = 0; i < v0.length / 3; i++) {
      // Tronco central de 100 a 175 cm (sin brazos: |x| < 10).
      if (Math.abs(v0[3 * i]) < 10 && v0[3 * i + 1] > 100) {
        max = Math.max(max, Math.hypot(v1[3 * i] - v0[3 * i], v1[3 * i + 1] - v0[3 * i + 1], v1[3 * i + 2] - v0[3 * i + 2]));
      }
    }
    expect(max).toBeLessThan(0.01);
  });
});
