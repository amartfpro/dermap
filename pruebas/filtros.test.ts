import { describe, expect, it } from "vitest";
import { filtrar } from "../src/lienzo/filtros";

/** Imagen de prueba: fondo claro y un cuadrado oscuro en el centro, de lado `n/2`. */
function cuadrado(n: number): Uint8ClampedArray {
  const p = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const dentro = x >= n / 4 && x < (3 * n) / 4 && y >= n / 4 && y < (3 * n) / 4;
      const i = 4 * (y * n + x);
      p[i] = p[i + 1] = p[i + 2] = dentro ? 30 : 230;
      p[i + 3] = 255;
    }
  return p;
}
const cuenta = (m: Uint8Array) => m.reduce((a, b) => a + b, 0);

describe("convertir a stencil", () => {
  it("el umbral pinta lo oscuro", () => {
    const m = filtrar(cuadrado(64), 64, 64, { modo: "umbral", umbral: 128, suavizado: 0, grosor: 0 });
    expect(cuenta(m)).toBe(32 * 32);
  });

  it("los contornos marcan el borde y no el interior", () => {
    const m = filtrar(cuadrado(64), 64, 64, { modo: "contornos", umbral: 140, suavizado: 1, grosor: 0 });
    expect(m[32 * 64 + 32]).toBe(0); // centro
    expect(m[32 * 64 + 16]).toBe(1); // borde izquierdo
    expect(cuenta(m)).toBeGreaterThan(100);
  });

  it("a más resolución da el mismo dibujo si el paso y el suavizado escalan", () => {
    const peq = filtrar(cuadrado(64), 64, 64, { modo: "contornos", umbral: 140, suavizado: 1, grosor: 0 });
    const grande = filtrar(cuadrado(256), 256, 256, { modo: "contornos", umbral: 140, suavizado: 4, grosor: 0, paso: 4 });
    // La proporción de tinta se parece (el grosor relativo de la línea es el mismo).
    expect(cuenta(grande) / (256 * 256)).toBeGreaterThan((0.5 * cuenta(peq)) / (64 * 64));
  });
});
