import { describe, expect, it } from "vitest";
import { desempaquetarZona, empaquetarZona, nombreSeguro } from "../src/proyectos/formato";
import { seleccionarPorEje, longitud } from "../src/geometria/seleccion";
import { medirDeformacion } from "../src/geometria/metricas";
import { ejeDelBrazo } from "../src/modelos/cuerpo";
import { aplanadorReal, cuerpoBase } from "./utilidades";

describe("zona.bin", () => {
  it("guarda y lee la zona y su aplanado sin pérdidas", async () => {
    const cuerpo = cuerpoBase();
    const eje = ejeDelBrazo(cuerpo, "l");
    const sel = seleccionarPorEje(cuerpo, eje, longitud(eje.slice(0, 2)) + 3, longitud(eje) - 2, 7);
    const aplanado = (await aplanadorReal()).aplanar(sel.malla);
    const zona = {
      malla: sel.malla,
      aplanado,
      errorPorCara: medirDeformacion(sel.malla, aplanado).porCara,
      triangulos: sel.triangulos,
      verticeBase: sel.verticeBase,
    };
    const bytes = empaquetarZona(zona);
    // Copia desalineada a propósito: el lector no debe depender de la posición del búfer.
    const desalineado = new Uint8Array(bytes.length + 3).subarray(3);
    desalineado.set(bytes);
    const leida = desempaquetarZona(desalineado);
    expect(leida.aplanado.tipo).toBe(aplanado.tipo);
    expect(Array.from(leida.triangulos)).toEqual(Array.from(zona.triangulos));
    expect(Array.from(leida.aplanado.uv)).toEqual(Array.from(aplanado.uv));
    expect(Array.from(leida.aplanado.corte)).toEqual(Array.from(aplanado.corte));
    expect(Array.from(leida.malla.vertices)).toEqual(Array.from(sel.malla.vertices));
    expect(Array.from(leida.errorPorCara)).toEqual(Array.from(zona.errorPorCara));
  });

  it("rechaza archivos que no son zona.bin", () => {
    expect(() => desempaquetarZona(new Uint8Array(32))).toThrow();
  });
});

describe("nombreSeguro", () => {
  it("quita caracteres no válidos en Windows y macOS", () => {
    expect(nombreSeguro('Ana: García?')).toBe("Ana García");
    expect(nombreSeguro("Proyecto/1")).toBe("Proyecto1");
    expect(nombreSeguro("lienzo. ")).toBe("lienzo");
    expect(nombreSeguro("   ")).toBe("Sin nombre");
  });
  it("evita los nombres reservados de Windows", () => {
    expect(nombreSeguro("CON")).toBe("CON_");
    expect(nombreSeguro("com1")).toBe("com1_");
    expect(nombreSeguro("Concha")).toBe("Concha");
  });
});
