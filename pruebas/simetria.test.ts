import { describe, expect, it } from "vitest";
import { calcularSimetria } from "../src/geometria/simetria";
import { cuerpoBase } from "./utilidades";

describe("simetría izquierda–derecha", () => {
  it("empareja casi todos los vértices y triángulos con su reflejo", () => {
    const c = cuerpoBase();
    const s = calcularSimetria(c);
    const v = c.vertices;
    let lejos = 0, sinT = 0;
    for (let i = 0; i < s.vertices.length; i++) {
      const j = s.vertices[i];
      const d = j < 0 ? Infinity : Math.hypot(v[3 * j] + v[3 * i], v[3 * j + 1] - v[3 * i + 1], v[3 * j + 2] - v[3 * i + 2]);
      if (d > 0.05) lejos++;
    }
    for (const t of s.triangulos) if (t < 0) sinT++;
    console.log("vértices lejos", lejos, "/", s.vertices.length, "triángulos sin pareja", sinT, "/", s.triangulos.length);
    expect(lejos / s.vertices.length).toBeLessThan(0.01);
    expect(sinT / s.triangulos.length).toBeLessThan(0.01);
    // Involución.
    let malos = 0;
    s.triangulos.forEach((t, i) => { if (t >= 0 && s.triangulos[t] !== i) malos++; });
    expect(malos).toBe(0);
  });
});
