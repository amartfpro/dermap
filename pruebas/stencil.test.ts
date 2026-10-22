import { describe, expect, it } from "vitest";
import { planificar } from "../src/exportar/stencil";
import { PX_POR_MM } from "../src/lienzo/geometria-zona";

const mm = (x: number) => Math.round(x * PX_POR_MM);

describe("reparto del stencil en hojas A4 (RF-51)", () => {
  it("un diseño pequeño cabe en una hoja", () => {
    const plan = planificar({ x0: 0, y0: 0, x1: mm(150), y1: mm(100) });
    expect(plan.piezas).toHaveLength(1);
  });

  it("elige la orientación con menos hojas", () => {
    // 260 × 150 mm cabe en una hoja apaisada (281 × 176 útiles) pero no en vertical.
    const plan = planificar({ x0: 0, y0: 0, x1: mm(260), y1: mm(150) });
    expect(plan.apaisado).toBe(true);
    expect(plan.piezas).toHaveLength(1);
  });

  it("una manga se divide en piezas que cubren todo con solape", () => {
    const rect = { x0: 100, y0: 50, x1: 100 + mm(400), y1: 50 + mm(320) };
    const plan = planificar(rect);
    expect(plan.piezas.length).toBeGreaterThan(1);
    // Cada punto del diseño está en alguna pieza.
    for (let x = rect.x0; x < rect.x1; x += 200)
      for (let y = rect.y0; y < rect.y1; y += 200)
        expect(plan.piezas.some((p) => x >= p.rect.x0 && x < p.rect.x1 && y >= p.rect.y0 && y < p.rect.y1)).toBe(true);
    // Piezas vecinas se solapan 1 cm.
    const [a, b] = plan.piezas.filter((p) => p.fila === 0);
    if (b) expect(a.rect.x1 - b.rect.x0).toBeCloseTo(mm(10), -1);
  });
});
