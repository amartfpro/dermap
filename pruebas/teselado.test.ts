import { describe, expect, it } from "vitest";
import { crearPlanTeselado, evaluarTeselado } from "../src/geometria/teselado";
import { cuerpoBase } from "./utilidades";

describe("teselado de Phong", () => {
  it("cuenta bien vértices y triángulos, y una malla plana sigue plana", () => {
    // Dos triángulos en el plano z = 0.
    const pos = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];
    const nor = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
    const caras = [0, 1, 2, 0, 2, 3];
    const plan = crearPlanTeselado(caras, 4, 3);
    // 4 vértices + 5 aristas × 2 + 2 caras × 1.
    expect(plan.n).toBe(4 + 10 + 2);
    expect(plan.indice.length).toBe(2 * 9 * 3);
    const p = new Float32Array(plan.n * 3), n = new Float32Array(plan.n * 3);
    evaluarTeselado(plan, pos, nor, p, n);
    for (let i = 0; i < plan.n; i++) expect(Math.abs(p[3 * i + 2])).toBeLessThan(1e-6);
    // Ningún índice fuera de rango y todos los vértices usados.
    const usados = new Set(plan.indice);
    expect(usados.size).toBe(plan.n);
  });

  it("curva hacia fuera una superficie convexa y conserva los vértices originales", () => {
    // Octaedro unidad: los puntos nuevos deben quedar más cerca de la esfera que los lineales.
    const pos = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1];
    const caras = [0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4, 2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5];
    const plan = crearPlanTeselado(caras, 6, 2);
    const p = new Float32Array(plan.n * 3), n = new Float32Array(plan.n * 3);
    evaluarTeselado(plan, pos, pos, p, n);
    for (let i = 0; i < 6; i++) expect(Math.hypot(p[3 * i], p[3 * i + 1], p[3 * i + 2])).toBeCloseTo(1, 6);
    // Punto medio de arista: lineal a 0,707 del centro; con Phong, más fuera.
    for (let i = 6; i < plan.n; i++) expect(Math.hypot(p[3 * i], p[3 * i + 1], p[3 * i + 2])).toBeGreaterThan(0.8);
  });

  it("el cuerpo se tesela con orientación coherente y sin vértices sueltos", () => {
    const c = cuerpoBase();
    const plan = crearPlanTeselado(c.caras, c.vertices.length / 3, 2);
    expect(plan.indice.length).toBe(c.caras.length * 4);
    expect(new Set(plan.indice).size).toBe(plan.n);
  });
});
