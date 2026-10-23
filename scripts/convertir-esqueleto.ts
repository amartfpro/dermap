/**
 * Convierte el esqueleto y los pesos de MakeHuman (MPFB, CC0) al formato de Dermap.
 *
 *   npx tsx scripts/convertir-esqueleto.ts ruta/a/base.obj ruta/a/rig.default.json ruta/a/weights.default.json
 *
 * Los dos .json están en https://github.com/makehumancommunity/mpfb2 (src/mpfb/data/rigs/standard).
 * Genera src/modelos/esqueleto.json:
 *   - huesos: nombre, padre y cómo se calculan su cabeza y su cola a partir del cuerpo actual
 *     (centro de un cubo de articulación, media de vértices del cuerpo o un punto entre dos
 *     articulaciones cuando MakeHuman usa vértices auxiliares que Dermap no carga).
 *   - pesos: los 4 huesos que más influyen en cada vértice del cuerpo (índices de Dermap) y
 *     su peso cuantizado a 0–255, en base64.
 */
import { readFileSync, writeFileSync } from "node:fs";

const [rutaObj, rutaRig, rutaPesos] = process.argv.slice(2);
if (!rutaObj || !rutaRig || !rutaPesos) {
  console.error("Uso: npx tsx scripts/convertir-esqueleto.ts base.obj rig.default.json weights.default.json");
  process.exit(1);
}

// Malla original: vértices, caras del cuerpo y cubos de articulación (igual que convertir-makehuman.ts).
const vertices: [number, number, number][] = [];
const cuadros: number[][] = [];
const cubos = new Map<string, Set<number>>();
let grupo = "";
for (const linea of readFileSync(rutaObj, "utf8").split("\n")) {
  if (linea.startsWith("v ")) {
    const [x, y, z] = linea.split(/\s+/).slice(1, 4).map(Number);
    vertices.push([x, y, z]);
  } else if (linea.startsWith("g ")) grupo = linea.split(/\s+/)[1];
  else if (linea.startsWith("f ")) {
    const indices = linea.trim().split(/\s+/).slice(1).map((t) => Number(t.split("/")[0]) - 1);
    if (grupo === "body") cuadros.push(indices);
    else if (grupo.startsWith("joint-")) {
      const c = cubos.get(grupo) ?? new Set<number>();
      indices.forEach((i) => c.add(i));
      cubos.set(grupo, c);
    }
  }
}
const nuevo = new Map<number, number>();
for (const c of cuadros) for (const v of c) if (!nuevo.has(v)) nuevo.set(v, nuevo.size);
const centroCubo = (nombre: string): [number, number, number] => {
  const vs = [...cubos.get(nombre)!];
  return [0, 1, 2].map((k) => vs.reduce((s, v) => s + vertices[v][k], 0) / vs.length) as [number, number, number];
};

type Ref = { c: string } | { v: number[] } | { e: [string, string]; t: number };
interface HuesoRig {
  head: { strategy: string; cube_name?: string; vertex_index?: number; vertex_indices?: number[] };
  tail: HuesoRig["head"];
  parent: string;
}
const rig = JSON.parse(readFileSync(rutaRig, "utf8")) as Record<string, HuesoRig>;

/** Cubos de articulación de la cadena del hueso (hasta 3 padres y 3 niveles de hijos). */
function cubosDeLaCadena(nombre: string): string[] {
  const res = new Set<string>();
  const anotar = (n: string) => {
    for (const r of [rig[n].head, rig[n].tail]) if (r.strategy === "CUBE") res.add(r.cube_name!);
  };
  let n: string | undefined = nombre;
  for (let k = 0; k < 4 && n; k++) {
    anotar(n);
    n = rig[n].parent || undefined;
  }
  let nivel = [nombre];
  for (let k = 0; k < 3; k++) {
    nivel = Object.keys(rig).filter((h) => nivel.includes(rig[h].parent));
    nivel.forEach(anotar);
  }
  return [...res];
}

/** El mismo punto (cola de un hueso y cabeza del siguiente) se resuelve siempre igual. */
const resueltos = new Map<string, Ref>();

function referencia(r: HuesoRig["head"], hueso: string): Ref {
  if (r.strategy === "CUBE") return { c: r.cube_name!.replace(/^joint-/, "") };
  const idx = r.strategy === "VERTEX" ? [r.vertex_index!] : r.vertex_indices!;
  const clave = idx.join(",");
  if (!resueltos.has(clave)) resueltos.set(clave, resolver(idx, hueso));
  return resueltos.get(clave)!;
}

function resolver(idx: number[], hueso: string): Ref {
  if (idx.every((i) => nuevo.has(i))) return { v: idx.map((i) => nuevo.get(i)!) };
  // Vértices auxiliares: el punto se expresa entre las dos articulaciones que mejor lo contienen.
  const p = [0, 1, 2].map((k) => idx.reduce((s, i) => s + vertices[i][k], 0) / idx.length);
  const buscar = (candidatos: string[]) => {
    let mejor: { e: [string, string]; t: number; d: number } | null = null;
    const centros = candidatos.map((n) => [n, centroCubo(n)] as const);
    for (const [na, a] of centros)
      for (const [nb, b] of centros) {
        if (na >= nb) continue;
        const ab = [0, 1, 2].map((k) => b[k] - a[k]);
        const l2 = ab.reduce((s, x) => s + x * x, 0);
        if (l2 < 1e-6) continue;
        const t = [0, 1, 2].reduce((s, k) => s + (p[k] - a[k]) * ab[k], 0) / l2;
        if (t < 0.02 || t > 0.98) continue;
        const d = Math.hypot(...[0, 1, 2].map((k) => a[k] + t * ab[k] - p[k]));
        if (!mejor || d < mejor.d) mejor = { e: [na.replace(/^joint-/, ""), nb.replace(/^joint-/, "")], t, d };
      }
    return mejor;
  };
  // Primero en la cadena del hueso (lo normal: un punto intermedio del brazo o la pierna).
  const enCadena = buscar(cubosDeLaCadena(hueso));
  if (enCadena && enCadena.d < 0.15) return { e: enCadena.e, t: Number(enCadena.t.toFixed(4)) };
  // Si no (huesos de la cara), la articulación más cercana: no pesan en el cuerpo que se usa.
  let cercano = "", dmin = Infinity;
  for (const n of cubos.keys()) {
    const c = centroCubo(n);
    const d = Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]);
    if (d < dmin) {
      dmin = d;
      cercano = n;
    }
  }
  return { c: cercano.replace(/^joint-/, "") };
}

const nombres = Object.keys(rig);
const huesos = nombres.map((n) => ({
  n,
  p: rig[n].parent ? nombres.indexOf(rig[n].parent) : -1,
  cabeza: referencia(rig[n].head, n),
  cola: referencia(rig[n].tail, n),
}));
// Orden de padres antes que hijos.
const orden: number[] = [];
const visto = new Set<number>();
const visitar = (i: number) => {
  if (visto.has(i)) return;
  if (huesos[i].p >= 0) visitar(huesos[i].p);
  visto.add(i);
  orden.push(i);
};
huesos.forEach((_, i) => visitar(i));
const reindex = new Map(orden.map((i, k) => [i, k]));
const ordenados = orden.map((i) => ({ ...huesos[i], p: huesos[i].p < 0 ? -1 : reindex.get(huesos[i].p)! }));

// Pesos: hasta 4 por vértice, normalizados.
const pesos = JSON.parse(readFileSync(rutaPesos, "utf8")).weights as Record<string, [number, number][]>;
const porVertice: [number, number][][] = Array.from({ length: nuevo.size }, () => []);
for (const [hueso, lista] of Object.entries(pesos)) {
  const h = reindex.get(nombres.indexOf(hueso));
  if (h === undefined) continue;
  for (const [v, w] of lista) {
    const i = nuevo.get(v);
    if (i !== undefined && w > 0) porVertice[i].push([h, w]);
  }
}
const indices = new Uint8Array(nuevo.size * 4);
const valores = new Uint8Array(nuevo.size * 4);
let sinPeso = 0;
porVertice.forEach((lista, i) => {
  lista.sort((a, b) => b[1] - a[1]);
  const top = lista.slice(0, 4);
  const suma = top.reduce((s, [, w]) => s + w, 0);
  if (!suma) {
    sinPeso++;
    return;
  }
  let resto = 255;
  top.forEach(([h, w], k) => {
    const q = k === top.length - 1 ? resto : Math.min(resto, Math.round((w / suma) * 255));
    indices[4 * i + k] = h;
    valores[4 * i + k] = q;
    resto -= q;
  });
});
if (ordenados.length > 255) throw new Error("Demasiados huesos para índices de 8 bits");
writeFileSync(
  new URL("../src/modelos/esqueleto.json", import.meta.url),
  JSON.stringify({
    fuente: "MakeHuman / MPFB rig «default» y sus pesos (CC0)",
    huesos: ordenados,
    indices: Buffer.from(indices).toString("base64"),
    pesos: Buffer.from(valores).toString("base64"),
  }),
);
console.log(`${ordenados.length} huesos, ${nuevo.size} vértices, ${sinPeso} sin peso`);
