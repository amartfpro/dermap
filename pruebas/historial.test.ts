import { describe, expect, it } from "vitest";
import { Historial, type Paso } from "../src/lienzo/historial";

/** Paso de prueba: suma y resta un valor a un contador. */
function paso(estado: { valor: number }, delta: number, bytes = 10): Paso {
  return {
    descripcion: `+${delta}`,
    bytes: () => bytes,
    async deshacer() {
      estado.valor -= delta;
      return paso(estado, -delta, bytes);
    },
  };
}

describe("Historial", () => {
  it("deshace y rehace en orden", async () => {
    const estado = { valor: 0 };
    const h = new Historial();
    for (const d of [1, 2, 3]) {
      estado.valor += d;
      h.registrar(paso(estado, d));
    }
    await h.deshacer();
    expect(estado.valor).toBe(3);
    await h.deshacer();
    expect(estado.valor).toBe(1);
    await h.rehacer();
    expect(estado.valor).toBe(3);
    expect(h.puedeRehacer).toBe(true);
    // Un paso nuevo vacía lo que se podía rehacer.
    estado.valor += 10;
    h.registrar(paso(estado, 10));
    expect(h.puedeRehacer).toBe(false);
  });

  it("garantiza al menos 100 pasos aunque se pase del límite de memoria (RF-32)", async () => {
    const estado = { valor: 0 };
    const h = new Historial(100, 300, 1000); // 1000 bytes de límite
    for (let i = 0; i < 150; i++) {
      estado.valor += 1;
      h.registrar(paso(estado, 1, 100));
    }
    let deshechos = 0;
    while (h.puedeDeshacer) {
      await h.deshacer();
      deshechos++;
    }
    expect(deshechos).toBe(100);
  });

  it("guarda más de 100 pasos si caben en memoria", async () => {
    const estado = { valor: 0 };
    const h = new Historial(100, 300, 1e9);
    for (let i = 0; i < 250; i++) h.registrar(paso(estado, 1, 1));
    let n = 0;
    while (h.puedeDeshacer) {
      await h.deshacer();
      n++;
    }
    expect(n).toBe(250);
  });
});
