/**
 * Prueba P1 del prototipo: mide el aplanado de zonas del cuerpo real (MakeHuman).
 *   npx tsx scripts/medir-aplanado.ts
 *
 * Criterios (Documento de diseño, «Prototipo técnico»):
 *   - manga completa aplanada en menos de 5 s
 *   - deformación de longitudes ≤ 2 % en el antebrazo (p95 del área)
 *   - ningún triángulo invertido (solape)
 */
import { readFileSync } from "node:fs";
import { Aplanador, type Malla } from "../src/geometria/aplanador";
import { medirDeformacion } from "../src/geometria/metricas";
import { longitud, proyectarEnPolilinea, seleccionarPorEje } from "../src/geometria/seleccion";
import { ejeDelBrazo, ejeDeLaPierna, leerCuerpo } from "../src/modelos/cuerpo";

const bin = readFileSync(new URL("../src/modelos/cuerpo-base.bin", import.meta.url));
const cuerpo = leerCuerpo(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const aplanador = await Aplanador.crear(readFileSync(new URL("../src/geometria/dermap_geom.wasm", import.meta.url)));
const pct = (x: number) => `${(100 * x).toFixed(1)} %`;

const brazo = ejeDelBrazo(cuerpo, "l");
const largoBrazo = longitud(brazo);
const hastaCodo = longitud(brazo.slice(0, 2));
const pierna = ejeDeLaPierna(cuerpo, "l");
const largoPierna = longitud(pierna);
const hastaRodilla = longitud(pierna.slice(0, 2));
// Antebrazo sin la muñeca ni el codo (las zonas de más curvatura).
const enAntebrazo = (c: [number, number, number]) => {
  const { s } = proyectarEnPolilinea(c, brazo);
  return s > hastaCodo + 4 && s < largoBrazo - 4;
};

console.log(`Cuerpo base: ${cuerpo.vertices.length / 3} vértices, ${cuerpo.altura} cm`);

// Criterio de P1: manga completa del brazo izquierdo, de hombro a muñeca.
const manga = seleccionarPorEje(cuerpo, brazo, 4, largoBrazo - 2, 8).malla;
// Se mide con la malla subdividida una vez (4× triángulos), como se haría en la app.
let todoBien = true;
for (const [nombre, malla] of [
  ["Manga completa (malla base)", manga],
  ["Manga completa (subdividida ×4)", subdividir(manga)],
  ["Manga completa (subdividida ×16)", subdividir(subdividir(manga))],
] as const) {
  const t0 = performance.now();
  const aplanado = aplanador.aplanar(malla, { direccionExterna: [0, 1, 0] });
  const segundos = (performance.now() - t0) / 1000;
  const antebrazo = medirDeformacion(malla, aplanado, enAntebrazo);
  const okTiempo = segundos < 5;
  const okDeformacion = antebrazo.p95 <= 0.02;
  const okSolapes = aplanado.volteados === 0;
  todoBien &&= okTiempo && okDeformacion && okSolapes;
  const marca = (ok: boolean) => (ok ? "✓" : "✗");
  console.log(`\n${nombre}: ${malla.caras.length / 3} triángulos, ${aplanado.tipo}, corte de ${aplanado.corte.length} vértices`);
  console.log(`  ${marca(okTiempo)} tiempo: ${segundos.toFixed(2)} s`);
  console.log(`  ${marca(okDeformacion)} antebrazo: p95 ${pct(antebrazo.p95)}, ${antebrazo.areaDentroDel2.toFixed(0)} % del área ≤ 2 %`);
  console.log(`  ${marca(okSolapes)} triángulos invertidos: ${aplanado.volteados}`);
}

console.log("\nInformativo: deformación según la zona (p95 y % del área ≤ 2 %)");
const informe = (nombre: string, malla: Malla) => {
  const a = aplanador.aplanar(malla, { direccionExterna: [0, 1, 0] });
  const d = medirDeformacion(malla, a);
  console.log(`  ${nombre.padEnd(36)} ${a.tipo.padEnd(7)} p95 ${pct(d.p95).padStart(7)}, ${d.areaDentroDel2.toFixed(0).padStart(3)} %`);
};
informe("Cono (control, debe dar 0 %)", conoDeControl());
informe("Antebrazo (codo → muñeca)", seleccionarPorEje(cuerpo, brazo, hastaCodo + 3, largoBrazo - 2, 7).malla);
informe("Brazo (hombro → codo)", seleccionarPorEje(cuerpo, brazo, 4, hastaCodo - 3, 8).malla);
informe("Muslo (cadera → rodilla)", seleccionarPorEje(cuerpo, pierna, 12, hastaRodilla - 4, 11).malla);
informe("Gemelo (rodilla → tobillo)", seleccionarPorEje(cuerpo, pierna, hastaRodilla + 4, largoPierna - 4, 9).malla);

console.log(`\nP1 ${todoBien ? "SUPERADA" : "NO SUPERADA"}`);
process.exitCode = todoBien ? 0 : 1;

/** Divide cada triángulo en cuatro por los puntos medios de sus aristas. */
function subdividir(m: Malla): Malla {
  const vertices = Array.from(m.vertices);
  const medios = new Map<string, number>();
  const medio = (a: number, b: number) => {
    const k = a < b ? `${a},${b}` : `${b},${a}`;
    let i = medios.get(k);
    if (i === undefined) {
      i = vertices.length / 3;
      for (let c = 0; c < 3; c++) vertices.push((m.vertices[3 * a + c] + m.vertices[3 * b + c]) / 2);
      medios.set(k, i);
    }
    return i;
  };
  const caras: number[] = [];
  for (let f = 0; f < m.caras.length / 3; f++) {
    const [a, b, c] = [m.caras[3 * f], m.caras[3 * f + 1], m.caras[3 * f + 2]];
    const [ab, bc, ca] = [medio(a, b), medio(b, c), medio(c, a)];
    caras.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  return { vertices: new Float64Array(vertices), caras: new Int32Array(caras) };
}

/** Tronco de cono abierto: se despliega sin deformación, así que valida la medida. */
function conoDeControl(alrededor = 48, alLargo = 32): Malla {
  const vertices: number[] = [];
  const caras: number[] = [];
  for (let j = 0; j <= alLargo; j++) {
    const y = -30 + (60 * j) / alLargo;
    const r = 2.5 + (3 * j) / alLargo;
    for (let i = 0; i < alrededor; i++) {
      const a = (2 * Math.PI * i) / alrededor;
      vertices.push(r * Math.cos(a), y, r * Math.sin(a));
    }
  }
  for (let j = 0; j < alLargo; j++)
    for (let i = 0; i < alrededor; i++) {
      const a = j * alrededor + i;
      const b = j * alrededor + ((i + 1) % alrededor);
      caras.push(a, a + alrededor, b, b, a + alrededor, b + alrededor);
    }
  return { vertices: new Float64Array(vertices), caras: new Int32Array(caras) };
}
