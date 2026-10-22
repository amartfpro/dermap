/**
 * Convierte los targets de forma de MakeHuman (CC0) al formato compacto de Dermap.
 *
 *   npx tsx scripts/convertir-formas.ts ruta/a/base.obj ruta/a/targets/
 *
 * Los targets están en el repositorio de MakeHuman, en makehuman/data/targets/macrodetails:
 *   - {african,asian,caucasian}-{female,male}-young.target          sexo (las tres etnias a partes iguales)
 *   - universal-{female,male}-young-{min,average,max}muscle-{min,average,max}weight.target
 *   - height/{female,male}-young-averagemuscle-averageweight-{min,max}height.target
 *
 * Genera src/modelos/cuerpo-formas.bin con los desplazamientos de los vértices del cuerpo
 * (los mismos y en el mismo orden que cuerpo-base.bin) y de los centros de las articulaciones.
 *
 * Formato (little endian): "DMF1" · uint32 bytesJSON · JSON {formas, articulaciones, escala}
 * (relleno a 4 bytes) · por forma: uint32 n · uint16[n] vértices (relleno a 4) · int16[3n]
 * desplazamientos en unidades de `escala` cm (0,004) (relleno a 4) · float32[3·nArticulaciones] en cm.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [rutaObj, carpeta] = process.argv.slice(2);
if (!rutaObj || !carpeta) {
  console.error("Uso: npx tsx scripts/convertir-formas.ts base.obj carpeta-de-targets");
  process.exit(1);
}
const ESCALA = 0.004; // cm por unidad: ±131 cm con 0,04 mm de precisión

// Misma lectura que convertir-makehuman.ts: vértices del grupo «body» reindexados por orden de uso.
const cuadros: number[][] = [];
const articulaciones = new Map<string, Set<number>>();
let grupo = "";
let nTotal = 0;
for (const linea of readFileSync(rutaObj, "utf8").split("\n")) {
  if (linea.startsWith("v ")) nTotal++;
  else if (linea.startsWith("g ")) grupo = linea.split(/\s+/)[1];
  else if (linea.startsWith("f ")) {
    const indices = linea.trim().split(/\s+/).slice(1).map((t) => Number(t.split("/")[0]) - 1);
    if (grupo === "body") cuadros.push(indices);
    else if (grupo.startsWith("joint-")) {
      const conjunto = articulaciones.get(grupo) ?? new Set<number>();
      indices.forEach((i) => conjunto.add(i));
      articulaciones.set(grupo, conjunto);
    }
  }
}
const nuevo = new Map<number, number>();
for (const c of cuadros) for (const v of c) if (!nuevo.has(v)) nuevo.set(v, nuevo.size);
const juntas = [...articulaciones].sort();

function leerTarget(nombre: string): Float64Array {
  const d = new Float64Array(nTotal * 3);
  for (const linea of readFileSync(join(carpeta, nombre), "utf8").split("\n")) {
    if (!linea || linea.startsWith("#")) continue;
    const [i, x, y, z] = linea.trim().split(/\s+/).map(Number);
    d.set([x * 10, y * 10, z * 10], 3 * i); // dm → cm
  }
  return d;
}

const disponibles = new Set(readdirSync(carpeta));
const formas: { nombre: string; delta: Float64Array }[] = [];
for (const sexo of ["female", "male"]) {
  // Sexo con las tres etnias por igual, como el humano por defecto de MakeHuman.
  const suma = new Float64Array(nTotal * 3);
  for (const etnia of ["african", "asian", "caucasian"]) {
    const d = leerTarget(`${etnia}-${sexo}-young.target`);
    for (let k = 0; k < suma.length; k++) suma[k] += d[k] / 3;
  }
  formas.push({ nombre: sexo, delta: suma });
  for (const m of ["minmuscle", "averagemuscle", "maxmuscle"])
    for (const w of ["minweight", "averageweight", "maxweight"]) {
      const nombre = `universal-${sexo}-young-${m}-${w}.target`;
      formas.push({ nombre: `${sexo}-${m}-${w}`, delta: leerTarget(nombre) });
    }
  for (const h of ["minheight", "maxheight"]) {
    const nombre = `${sexo}-young-averagemuscle-averageweight-${h}.target`;
    if (!disponibles.has(nombre)) throw new Error(`Falta ${nombre}`);
    formas.push({ nombre: `${sexo}-${h}`, delta: leerTarget(nombre) });
  }
}

const partes: Buffer[] = [];
const cabeceraJson = Buffer.from(
  JSON.stringify({
    formas: formas.map((f) => f.nombre),
    articulaciones: juntas.map(([n]) => n.replace(/^joint-/, "")),
    escala: ESCALA,
  }),
);
const relleno = (b: Buffer) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
const inicio = Buffer.alloc(8);
inicio.write("DMF1", 0, "ascii");
inicio.writeUInt32LE(cabeceraJson.length, 4);
partes.push(inicio, relleno(cabeceraJson));
let maximo = 0;
for (const { delta } of formas) {
  const indices: number[] = [];
  const valores: number[] = [];
  for (const [original, i] of nuevo) {
    const d = [delta[3 * original], delta[3 * original + 1], delta[3 * original + 2]];
    if (Math.max(...d.map(Math.abs)) < ESCALA / 2) continue;
    maximo = Math.max(maximo, ...d.map(Math.abs));
    indices.push(i);
    valores.push(...d.map((x) => Math.round(x / ESCALA)));
  }
  const orden = indices.map((_, k) => k).sort((a, b) => indices[a] - indices[b]);
  const n = Buffer.alloc(4);
  n.writeUInt32LE(indices.length);
  partes.push(n);
  partes.push(relleno(Buffer.from(new Uint16Array(orden.map((k) => indices[k])).buffer)));
  partes.push(relleno(Buffer.from(new Int16Array(orden.flatMap((k) => valores.slice(3 * k, 3 * k + 3))).buffer)));
  const centros = new Float32Array(juntas.length * 3);
  juntas.forEach(([, conjunto], j) => {
    const vs = [...conjunto];
    for (let c = 0; c < 3; c++) centros[3 * j + c] = vs.reduce((s, v) => s + delta[3 * v + c], 0) / vs.length;
  });
  partes.push(Buffer.from(centros.buffer));
}
if (maximo / ESCALA > 32767) throw new Error(`Desplazamiento de ${maximo} cm fuera de rango`);
const salida = Buffer.concat(partes);
writeFileSync(new URL("../src/modelos/cuerpo-formas.bin", import.meta.url), salida);
console.log(`${formas.length} formas, desplazamiento máximo ${maximo.toFixed(1)} cm, ${(salida.length / 1024).toFixed(0)} KB`);
