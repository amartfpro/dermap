/**
 * Convierte la malla base de MakeHuman (base.obj, CC0) al formato compacto de Dermap.
 *
 *   npx tsx scripts/convertir-makehuman.ts ruta/a/base.obj
 *
 * El base.obj está en el repositorio de MakeHuman:
 *   https://github.com/makehumancommunity/makehuman/blob/master/makehuman/data/3dobjs/base.obj
 *
 * Genera src/modelos/cuerpo-base.bin y src/modelos/cuerpo-base.json:
 *   - Solo el grupo «body» (sin los cubos auxiliares de articulaciones ni la ropa auxiliar).
 *   - Unidades en centímetros (MakeHuman usa decímetros), pies en y = 0.
 *   - Cuadriláteros triangulados por la diagonal más corta.
 *   - Posición de cada articulación (centro de su cubo auxiliar), para encuadres y selecciones.
 *
 * Formato .bin (little endian): "DMC1" · uint32 nVértices · uint32 nTriángulos ·
 * float32[nV·3] posiciones · uint16[nT·3] índices.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const ruta = process.argv[2];
if (!ruta) {
  console.error("Uso: npx tsx scripts/convertir-makehuman.ts ruta/a/base.obj");
  process.exit(1);
}

const vertices: [number, number, number][] = [];
const cuadros: number[][] = [];
const articulaciones = new Map<string, Set<number>>();
let grupo = "";
for (const linea of readFileSync(ruta, "utf8").split("\n")) {
  if (linea.startsWith("v ")) {
    const [x, y, z] = linea.split(/\s+/).slice(1, 4).map(Number);
    vertices.push([x * 10, y * 10, z * 10]); // dm → cm
  } else if (linea.startsWith("g ")) {
    grupo = linea.split(/\s+/)[1];
  } else if (linea.startsWith("f ")) {
    const indices = linea.trim().split(/\s+/).slice(1).map((t) => Number(t.split("/")[0]) - 1);
    if (grupo === "body") cuadros.push(indices);
    else if (grupo.startsWith("joint-")) {
      const conjunto = articulaciones.get(grupo) ?? new Set<number>();
      indices.forEach((i) => conjunto.add(i));
      articulaciones.set(grupo, conjunto);
    }
  }
}

// Reindexa los vértices del cuerpo.
const nuevo = new Map<number, number>();
const usados: number[] = [];
for (const c of cuadros)
  for (const v of c)
    if (!nuevo.has(v)) {
      nuevo.set(v, usados.length);
      usados.push(v);
    }

const sueloY = Math.min(...usados.map((v) => vertices[v][1]));
const posiciones = new Float32Array(usados.length * 3);
usados.forEach((v, i) => posiciones.set([vertices[v][0], vertices[v][1] - sueloY, vertices[v][2]], i * 3));

const distancia2 = (a: number, b: number) =>
  (vertices[a][0] - vertices[b][0]) ** 2 + (vertices[a][1] - vertices[b][1]) ** 2 + (vertices[a][2] - vertices[b][2]) ** 2;
const triangulos: number[] = [];
for (const c of cuadros) {
  if (c.length === 3) {
    triangulos.push(...c.map((v) => nuevo.get(v)!));
    continue;
  }
  const [a, b, cc, d] = c;
  const t = distancia2(a, cc) <= distancia2(b, d) ? [a, b, cc, a, cc, d] : [a, b, d, b, cc, d];
  triangulos.push(...t.map((v) => nuevo.get(v)!));
}
if (usados.length > 65535) throw new Error("Demasiados vértices para índices de 16 bits");

const cabecera = Buffer.alloc(12);
cabecera.write("DMC1", 0, "ascii");
cabecera.writeUInt32LE(usados.length, 4);
cabecera.writeUInt32LE(triangulos.length / 3, 8);
const salida = Buffer.concat([
  cabecera,
  Buffer.from(posiciones.buffer),
  Buffer.from(new Uint16Array(triangulos).buffer),
]);

const centros: Record<string, [number, number, number]> = {};
for (const [nombre, conjunto] of [...articulaciones].sort()) {
  const vs = [...conjunto];
  const c = [0, 1, 2].map((k) => vs.reduce((s, v) => s + vertices[v][k], 0) / vs.length);
  centros[nombre.replace(/^joint-/, "")] = [round(c[0]), round(c[1] - sueloY), round(c[2])];
}

mkdirSync(new URL("../src/modelos/", import.meta.url), { recursive: true });
writeFileSync(new URL("../src/modelos/cuerpo-base.bin", import.meta.url), salida);
writeFileSync(
  new URL("../src/modelos/cuerpo-base.json", import.meta.url),
  JSON.stringify(
    {
      origen: "MakeHuman base.obj, grupo body (CC0)",
      unidades: "cm",
      altura: round(Math.max(...usados.map((v) => vertices[v][1])) - sueloY),
      articulaciones: centros,
    },
    null,
    1,
  ) + "\n",
);
console.log(`${usados.length} vértices, ${triangulos.length / 3} triángulos, ${(salida.length / 1024).toFixed(0)} KB`);

function round(x: number): number {
  return Math.round(x * 100) / 100;
}
