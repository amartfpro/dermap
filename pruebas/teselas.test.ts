import { describe, expect, it } from "vitest";
import { RegionSucia, teselasEn, TESELA, transformarRect, unir } from "../src/lienzo/teselas";

describe("teselas", () => {
  it("lista las teselas que toca un rectángulo, recortadas al lienzo", () => {
    expect(teselasEn({ x0: 0, y0: 0, x1: 10, y1: 10 }, 2000, 2000)).toEqual([[0, 0]]);
    expect(teselasEn({ x0: 500, y0: 0, x1: 530, y1: 10 }, 2000, 2000)).toEqual([[0, 0], [1, 0]]);
    // Fuera del lienzo no hay teselas.
    expect(teselasEn({ x0: -100, y0: -100, x1: -1, y1: -1 }, 2000, 2000)).toEqual([]);
    const ultima = Math.ceil(2000 / TESELA) - 1;
    expect(teselasEn({ x0: 1990, y0: 1990, x1: 5000, y1: 5000 }, 2000, 2000)).toEqual([[ultima, ultima]]);
  });

  it("une rectángulos y transforma cajas", () => {
    expect(unir({ x0: 0, y0: 0, x1: 1, y1: 1 }, { x0: 5, y0: -2, x1: 6, y1: 0 })).toEqual({ x0: 0, y0: -2, x1: 6, y1: 1 });
    const r = transformarRect({ x0: 0, y0: 0, x1: 10, y1: 20 }, new DOMMatrixLite().rotar90());
    expect(r.x1 - r.x0).toBeCloseTo(20);
    expect(r.y1 - r.y0).toBeCloseTo(10);
  });
});

describe("RegionSucia", () => {
  it("no une zonas alejadas (trazo y su copia al otro lado de la costura)", () => {
    const region = new RegionSucia();
    region.añadir({ x0: 100, y0: 3000, x1: 140, y1: 3040 });
    region.añadir({ x0: 120, y0: 200, x1: 160, y1: 240 });
    const rects = region.vaciar();
    expect(rects).toHaveLength(2);
    expect(region.vacia).toBe(true);
  });

  it("une zonas que se tocan", () => {
    const region = new RegionSucia();
    region.añadir({ x0: 0, y0: 0, x1: 50, y1: 50 });
    region.añadir({ x0: 60, y0: 10, x1: 90, y1: 40 }); // a menos de 32 px
    region.añadir({ x0: 85, y0: 30, x1: 120, y1: 70 });
    expect(region.vaciar()).toEqual([{ x0: 0, y0: 0, x1: 120, y1: 70 }]);
  });

  it("por encima de 16 regiones las junta todas", () => {
    const region = new RegionSucia();
    for (let i = 0; i < 20; i++) region.añadir({ x0: i * 1000, y0: 0, x1: i * 1000 + 10, y1: 10 });
    expect(region.vaciar().length).toBeLessThanOrEqual(16);
  });
});

/** DOMMatrix mínima para Node (solo lo que usa transformarRect). */
class DOMMatrixLite {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
  rotar90(): this {
    [this.a, this.b, this.c, this.d] = [0, 1, -1, 0];
    return this;
  }
  transformPoint(p: { x: number; y: number }) {
    return { x: this.a * p.x + this.c * p.y + this.e, y: this.b * p.x + this.d * p.y + this.f };
  }
}
