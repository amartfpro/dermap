import { describe, expect, it } from "vitest";
import { engrosar, filtrar, quitarManchas } from "../src/lienzo/filtros";

/** Imagen de prueba (lado n): fondo claro y un cuadrado oscuro en el centro, de lado n/2. */
function cuadrado(n: number, fondo = 230): Uint8ClampedArray {
  const p = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const dentro = x >= n / 4 && x < (3 * n) / 4 && y >= n / 4 && y < (3 * n) / 4;
      const i = 4 * (y * n + x);
      p[i] = p[i + 1] = p[i + 2] = dentro ? 30 : fondo;
      p[i + 3] = 255;
    }
  return p;
}

/** Línea oscura vertical de `grosor` px en el centro de una imagen clara de lado n. */
function linea(n: number, grosor: number): Uint8ClampedArray {
  const p = new Uint8ClampedArray(n * n * 4).fill(235);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = 4 * (y * n + x);
      if (Math.abs(x - n / 2) < grosor / 2) p[i] = p[i + 1] = p[i + 2] = 20;
      p[i + 3] = 255;
    }
  return p;
}
const cuenta = (m: Uint8Array) => m.reduce((a, b) => a + b, 0);

describe("convertir a stencil", () => {
  it("el umbral pinta lo oscuro", () => {
    const m = filtrar(cuadrado(64), 64, 64, { modo: "umbral", intensidad: 50, suavizado: 0, grosor: 0 });
    expect(cuenta(m)).toBe(32 * 32);
  });

  it("el umbral adaptativo encuentra el cuadrado aunque el fondo sea oscuro", () => {
    const fijo = filtrar(cuadrado(64, 120), 64, 64, { modo: "umbral", intensidad: 50, suavizado: 0, grosor: 0 });
    const local = filtrar(cuadrado(64, 120), 64, 64, { modo: "umbral", intensidad: 50, suavizado: 0, grosor: 0, adaptativo: true, radioLocal: 12 });
    expect(cuenta(fijo)).toBeGreaterThan(64 * 64 * 0.9); // todo negro
    expect(local[32 * 64 + 20]).toBe(1); // dentro del cuadrado, cerca del borde
    expect(local[4 * 64 + 4]).toBe(0); // el fondo no
  });

  it("las líneas siguen un trazo con una sola línea (sin doble borde) y no rellenan las zonas lisas", () => {
    const n = 96;
    const m = filtrar(linea(n, 4), n, n, { modo: "lineas", intensidad: 60, suavizado: 1.5, grosor: 0 });
    const fila = Array.from({ length: n }, (_, x) => m[48 * n + x]);
    const tramos = fila.join("").split(/0+/).filter(Boolean).length;
    expect(tramos).toBe(1);
    expect(m[48 * n + 48]).toBe(1);
    expect(m[48 * n + 10]).toBe(0);
    // Un cuadrado grande: se marca su contorno, no el interior.
    const c = filtrar(cuadrado(64), 64, 64, { modo: "lineas", intensidad: 60, suavizado: 1.5, grosor: 0 });
    expect(c[32 * 64 + 32]).toBe(0);
  });

  it("a más resolución da el mismo dibujo si las medidas escalan con ella", () => {
    const o = { modo: "lineas" as const, intensidad: 60, grosor: 0 };
    const peq = filtrar(linea(64, 4), 64, 64, { ...o, suavizado: 1.5 });
    const grande = filtrar(linea(256, 16), 256, 256, { ...o, suavizado: 6 });
    const r = cuenta(grande) / (256 * 256) / (cuenta(peq) / (64 * 64));
    expect(r).toBeGreaterThan(0.6);
    expect(r).toBeLessThan(1.6);
  });

  it("quita las manchas pequeñas y engorda las líneas", () => {
    const m = new Uint8Array(20 * 20);
    m[5 * 20 + 5] = 1; // mancha de 1 px
    for (let x = 2; x < 18; x++) m[12 * 20 + x] = 1; // línea de 16 px
    const limpia = quitarManchas(m, 20, 20, 4);
    expect(limpia[5 * 20 + 5]).toBe(0);
    expect(cuenta(limpia)).toBe(16);
    expect(cuenta(engrosar(limpia, 20, 20, 1))).toBeGreaterThan(40);
  });
});
