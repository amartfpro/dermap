import { beforeAll, describe, expect, it } from "vitest";

// Sin navegador: una superficie de dibujo que no hace nada basta para la estructura de capas.
beforeAll(() => {
  const ctx = new Proxy({}, { get: () => () => undefined, set: () => true });
  (globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
    constructor(
      public width: number,
      public height: number,
    ) {}
    getContext() {
      return ctx;
    }
  };
});

async function documento(n: number) {
  const { DocumentoLienzo } = await import("../src/lienzo/documento");
  const doc = new DocumentoLienzo(1000, 1000, 10);
  for (let i = 1; i < n; i++) doc.añadirCapa(`C${i}`);
  doc.capas[0].nombre = "C0";
  return doc;
}
const nombres = (doc: { capas: { nombre: string }[] }) => doc.capas.map((c) => c.nombre).join(",");

describe("grupos de capas", () => {
  it("agrupa, mete y saca capas arrastrando, y las del grupo quedan seguidas", async () => {
    const doc = await documento(4); // C0,C1,C2,C3 (de abajo arriba)
    const [c0, c1, c2, c3] = doc.capas;
    const g = doc.agrupar(c1);
    expect(doc.grupos).toEqual([g]);
    // C3 entra en el grupo, encima de C1: el grupo se junta.
    doc.colocarCapa(c3, c1, "encima", g);
    expect(nombres(doc)).toBe("C0,C1,C3,C2");
    expect(doc.capasDe(g)).toEqual([c1, c3]);
    // C1 sale del grupo y va arriba del todo.
    doc.colocarCapa(c1, null, "encima", null);
    expect(nombres(doc)).toBe("C0,C3,C2,C1");
    expect(c1.grupo).toBeNull();
    // El grupo entero se mueve debajo de C0.
    doc.colocarGrupo(g, c0, "debajo");
    expect(nombres(doc)).toBe("C3,C0,C2,C1");
    expect(c2.grupo).toBeNull();
  });

  it("la visibilidad, el bloqueo y la opacidad del grupo se aplican a sus capas", async () => {
    const doc = await documento(2);
    const [c0] = doc.capas;
    const g = doc.agrupar(c0);
    doc.cambiarGrupo(g, { opacidad: 0.5, visible: false, bloqueado: true });
    c0.opacidad = 0.8;
    expect(c0.opacidadTotal).toBeCloseTo(0.4);
    expect(c0.seVe).toBe(false);
    expect(c0.bloqueadaTotal).toBe(true);
    doc.desagrupar(g);
    expect(c0.seVe).toBe(true);
    expect(doc.grupos).toEqual([]);
  });

  it("deshacer restaura el grupo y el orden", async () => {
    const doc = await documento(3);
    const [c0, c1] = doc.capas;
    const paso = doc.instantaneaCapas("Agrupar");
    const g = doc.agrupar(c0);
    doc.colocarCapa(c1, c0, "debajo", g);
    await paso.deshacer();
    expect(nombres(doc)).toBe("C0,C1,C2");
    expect(doc.grupos).toEqual([]);
    expect(g.nombre).toBeTruthy();
  });

  it("eliminar un grupo borra sus capas, pero nunca deja el lienzo sin capas", async () => {
    const doc = await documento(3);
    const [c0, c1, c2] = doc.capas;
    const g = doc.agrupar(c1);
    doc.colocarCapa(c2, c1, "encima", g);
    doc.eliminarGrupo(g);
    expect(doc.capas).toEqual([c0]);
    const g2 = doc.agrupar(c0);
    doc.eliminarGrupo(g2);
    expect(doc.capas).toEqual([c0]);
  });
});
