import { describe, expect, it } from "vitest";
import { bordesDe, corteExtraHasta, corteManual, corteSugerido, verticeMasCercano } from "../src/geometria/corte";
import { medirDeformacion } from "../src/geometria/metricas";
import { longitud, seleccionarPorEje, submalla, suavizarSeleccion } from "../src/geometria/seleccion";
import { ejeDelBrazo } from "../src/modelos/cuerpo";
import { aplanadorReal, cuerpoBase } from "./utilidades";

const cuerpo = cuerpoBase();
const eje = ejeDelBrazo(cuerpo, "l");
const manga = () => seleccionarPorEje(cuerpo, eje, 4, longitud(eje) - 2, 8);

describe("cuerpo base", () => {
  it("mide 166,6 cm con los pies en el suelo", () => {
    let min = Infinity, max = -Infinity;
    for (let i = 1; i < cuerpo.vertices.length; i += 3) {
      min = Math.min(min, cuerpo.vertices[i]);
      max = Math.max(max, cuerpo.vertices[i]);
    }
    expect(min).toBeCloseTo(0, 5);
    expect(max).toBeCloseTo(166.6, 0);
  });
});

describe("selección de zonas", () => {
  it("una manga tiene dos bordes y un parche uno", () => {
    expect(bordesDe(manga().malla)).toHaveLength(2);
    const parche = submalla(cuerpo, [...manga().triangulos].slice(0, 60));
    expect(bordesDe(parche.malla)).toHaveLength(1);
  });

  it("el suavizado rellena huecos de un triángulo", () => {
    const sel = new Set(manga().triangulos);
    const quitado = [...sel][200];
    sel.delete(quitado);
    expect(suavizarSeleccion(cuerpo, sel).has(quitado)).toBe(true);
  });
});

describe("corte", () => {
  it("el corte por defecto va de un borde al otro por la cara opuesta a la cámara", () => {
    const m = manga().malla;
    const [b0, b1] = bordesDe(m).map((b) => new Set(b));
    const corte = corteSugerido(m, [0, 1, 0])!;
    expect(corte).not.toBeNull();
    const [a, b] = corte.extremos;
    expect((b0.has(a) && b1.has(b)) || (b1.has(a) && b0.has(b))).toBe(true);
    // Mirando desde arriba (+y), el corte queda por debajo del eje del brazo.
    const yMedia = corte.camino.reduce((s, i) => s + m.vertices[3 * i + 1], 0) / corte.camino.length;
    const yEje = (eje[0][1] + eje[2][1]) / 2;
    expect(yMedia).toBeLessThan(yEje + 2);
  });

  it("un corte extra empieza en un borde y termina en el punto pedido", () => {
    const m = manga().malla;
    const bordes = new Set(bordesDe(m).flat());
    const objetivo = verticeMasCercano(m, eje[1]); // cerca del codo
    const camino = corteExtraHasta(m, objetivo);
    expect(bordes.has(camino[0])).toBe(true);
    expect(camino[camino.length - 1]).toBe(objetivo);
  });
});

describe("corte manual (RF-22, RF-24)", () => {
  it("pasa por los puntos marcados y une los dos bordes", () => {
    const m = manga().malla;
    const [b0, b1] = bordesDe(m).map((b) => new Set(b));
    const punto = verticeMasCercano(m, [eje[1][0], eje[1][1] + 6, eje[1][2]]); // encima del codo
    const camino = corteManual(m, [punto])!;
    expect(camino).not.toBeNull();
    expect(camino).toContain(punto);
    const [a, b] = [camino[0], camino[camino.length - 1]];
    expect((b0.has(a) && b1.has(b)) || (b1.has(a) && b0.has(b))).toBe(true);
  });

  it("se aplana con el corte del usuario", async () => {
    const m = manga().malla;
    const punto = verticeMasCercano(m, [eje[1][0], eje[1][1] + 6, eje[1][2]]);
    const camino = corteManual(m, [punto])!;
    const a = (await aplanadorReal()).aplanar(m, { corteManual: camino });
    expect(a.tipo).toBe("manga");
    expect(a.volteados).toBe(0);
    expect(Array.from(a.corte)).toEqual(camino);
    // Un camino que no llega al otro borde se rechaza (RF-24).
    expect(() => instancia!.aplanar(m, { corteManual: camino.slice(0, 3) })).toThrow();
  });
});

describe("aplanado (WebAssembly)", () => {
  it("un antebrazo se aplana rápido, sin solapes y con poca deformación (P1)", async () => {
    const sel = seleccionarPorEje(cuerpo, eje, longitud(eje.slice(0, 2)) + 3, longitud(eje) - 2, 7);
    const t0 = performance.now();
    const a = (await aplanadorReal()).aplanar(sel.malla, { direccionExterna: [0, 1, 0] });
    expect(performance.now() - t0).toBeLessThan(5000);
    expect(a.tipo).toBe("manga");
    expect(a.volteados).toBe(0);
    const d = medirDeformacion(sel.malla, a);
    expect(d.areaDentroDel2).toBeGreaterThan(80);
  });

  it("los cortes extra se devuelven tras el principal, separados por -1", async () => {
    const m = manga().malla;
    const extra = corteExtraHasta(m, verticeMasCercano(m, eje[1]));
    const a = (await aplanadorReal()).aplanar(m, { direccionExterna: [0, 1, 0], cortesExtra: [extra] });
    const separadores = Array.from(a.corte).filter((v) => v === -1).length;
    expect(separadores).toBe(1);
    expect(a.volteados).toBe(0);
  });

  it("rechaza una zona con agujeros (más de dos bordes)", async () => {
    const sel = manga();
    // Quita unos triángulos del centro de la manga para hacer un agujero.
    const sinCentro = [...sel.triangulos].filter((_, i) => i < 300 || i > 320);
    const conAgujero = submalla(cuerpo, sinCentro);
    if (bordesDe(conAgujero.malla).length <= 2) return; // el agujero cayó en un borde
    expect(() => aplanadorRealSync()(conAgujero.malla)).toThrow();
  });
});

let instancia: Awaited<ReturnType<typeof aplanadorReal>> | null = null;
await aplanadorReal().then((a) => (instancia = a));
function aplanadorRealSync() {
  return (m: Parameters<NonNullable<typeof instancia>["aplanar"]>[0]) => instancia!.aplanar(m);
}
