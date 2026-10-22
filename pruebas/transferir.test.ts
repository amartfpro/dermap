import { describe, expect, it } from "vitest";

// DOMMatrix no existe en Node: una mínima basta para la función afín.
class Matriz {
  constructor(readonly v: number[]) {}
  get a() { return this.v[0]; } get b() { return this.v[1]; } get c() { return this.v[2]; }
  get d() { return this.v[3]; } get e() { return this.v[4]; } get f() { return this.v[5]; }
}
(globalThis as unknown as { DOMMatrix: unknown }).DOMMatrix ??= Matriz;

describe("transferencia entre lienzos (RF-29)", () => {
  it("la transformación afín lleva cada esquina a su pareja", async () => {
    const { afin } = await import("../src/lienzo/transferir");
    const s: [number, number][] = [[10, 20], [110, 25], [40, 160]];
    const d: [number, number][] = [[500, 300], [480, 410], [640, 330]];
    const m = afin(s, d);
    for (let k = 0; k < 3; k++) {
      expect(m.a * s[k][0] + m.c * s[k][1] + m.e).toBeCloseTo(d[k][0], 6);
      expect(m.b * s[k][0] + m.d * s[k][1] + m.f).toBeCloseTo(d[k][1], 6);
    }
  });
});
