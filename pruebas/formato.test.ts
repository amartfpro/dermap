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

describe("archivo .dermap (RF-53)", () => {
  it("exporta e importa un proyecto sin pérdidas y sin sobrescribir", async () => {
    const { empaquetarProyecto, importarPaquete } = await import("../src/proyectos/paquete");
    const fs = new MemoriaArchivos();
    const proyecto = { version: 2, id: "abc", nombre: "Ana", ficha: {}, modelo: {}, arbol: [{ tipo: "lienzo", id: "l1", nombre: "Manga", carpeta: "Manga_l1.lienzo" }] };
    await fs.escribirTexto("Ana/proyecto.json", JSON.stringify(proyecto));
    await fs.escribirBinario("Ana/Manga_l1.lienzo/zona.bin", new Uint8Array([1, 2, 3, 4]));
    await fs.escribirBinario("Ana/Manga_l1.lienzo/capas/c1/t_0_0.png", new Uint8Array([137, 80, 78, 71]));
    await fs.escribirBinario("Ana/exportaciones/stencil.pdf", new Uint8Array([9]));
    const zip = await empaquetarProyecto(fs, "Ana");

    const carpeta = await importarPaquete(fs, zip);
    expect(carpeta).toBe("Ana (2)");
    const importado = JSON.parse(await fs.leerTexto("Ana (2)/proyecto.json"));
    expect(importado.nombre).toBe("Ana (2)");
    expect(importado.id).not.toBe("abc");
    expect(importado.arbol).toEqual(proyecto.arbol);
    expect(Array.from(await fs.leerBinario("Ana (2)/Manga_l1.lienzo/zona.bin"))).toEqual([1, 2, 3, 4]);
    expect(Array.from(await fs.leerBinario("Ana (2)/Manga_l1.lienzo/capas/c1/t_0_0.png"))).toEqual([137, 80, 78, 71]);
    expect(await fs.existe("Ana (2)/exportaciones/stencil.pdf")).toBe(false);
  });

  it("ignora rutas peligrosas y rechaza archivos que no son proyectos", async () => {
    const { importarPaquete } = await import("../src/proyectos/paquete");
    const { zipSync, strToU8 } = await import("fflate");
    const fs = new MemoriaArchivos();
    const zip = zipSync({
      "proyecto.json": strToU8(JSON.stringify({ version: 2, id: "x", nombre: "B", arbol: [] })),
      "../fuera.txt": strToU8("no"),
    });
    const carpeta = await importarPaquete(fs, zip);
    expect([...fs.datos.keys()].every((k) => k.startsWith(`${carpeta}/`))).toBe(true);
    await expect(importarPaquete(fs, zipSync({ "otra.txt": strToU8("hola") }))).rejects.toThrow();
    await expect(importarPaquete(fs, new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });
});

/** Sistema de archivos en memoria con la misma interfaz que el de la aplicación. */
class MemoriaArchivos {
  readonly escrituraAtomica = true;
  readonly descripcion = "memoria";
  datos = new Map<string, Uint8Array>();
  carpetas = new Set<string>();
  async existe(r: string) {
    return this.datos.has(r) || this.carpetas.has(r) || [...this.datos.keys()].some((k) => k.startsWith(`${r}/`));
  }
  async leerTexto(r: string) {
    return new TextDecoder().decode(await this.leerBinario(r));
  }
  async escribirTexto(r: string, t: string) {
    this.datos.set(r, new TextEncoder().encode(t));
  }
  async leerBinario(r: string) {
    const d = this.datos.get(r);
    if (!d) throw new Error(`No existe ${r}`);
    return d;
  }
  async escribirBinario(r: string, d: Uint8Array) {
    this.datos.set(r, d);
  }
  async listar(r: string) {
    const prefijo = r ? `${r}/` : "";
    const vistos = new Map<string, boolean>();
    for (const k of [...this.datos.keys(), ...this.carpetas]) {
      if (!k.startsWith(prefijo)) continue;
      const resto = k.slice(prefijo.length).split("/");
      if (!resto[0]) continue;
      vistos.set(resto[0], (vistos.get(resto[0]) ?? false) || resto.length > 1 || this.carpetas.has(prefijo + resto[0]));
    }
    return [...vistos].map(([nombre, carpeta]) => ({ nombre, carpeta }));
  }
  async crearCarpeta(r: string) {
    this.carpetas.add(r);
  }
  async borrar() {}
  async renombrar() {}
}
