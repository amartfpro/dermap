/**
 * Prueba P1 del prototipo: mide el aplanado de una manga contra sus criterios.
 *   npx tsx scripts/medir-aplanado.ts
 *
 * Criterios (Documento de diseño, «Prototipo técnico»):
 *   - manga completa aplanada en menos de 5 s
 *   - deformación de longitudes ≤ 2 % en el antebrazo
 *   - ningún triángulo invertido (solape)
 */
import { readFileSync } from "node:fs";
import { Aplanador, type Malla } from "../src/geometria/aplanador";
import { mangaDePrueba, parcheDePrueba } from "../src/geometria/brazo-prueba";
import { medirDeformacion } from "../src/geometria/metricas";

const bytes = readFileSync(new URL("../src/geometria/dermap_geom.wasm", import.meta.url));
const aplanador = await Aplanador.crear(bytes);

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

// Antebrazo sin la muñeca ni el codo, que son las zonas de más curvatura.
const enAntebrazo = ([, y]: [number, number, number]) => y > -28 && y < -6;
const pct = (x: number) => `${(100 * x).toFixed(1)} %`;

const casos = [
  { nombre: "Manga, resolución tipo MakeHuman", malla: mangaDePrueba(-33, 32, 40, 28) },
  { nombre: "Manga, resolución media", malla: mangaDePrueba(-33, 32, 64, 48) },
  { nombre: "Manga, resolución alta (subdividida)", malla: mangaDePrueba(-33, 32, 128, 96) },
  { nombre: "Parche en el antebrazo", malla: parcheDePrueba(64, 48) },
];

let todoBien = true;
for (const { nombre, malla } of casos) {
  const t0 = performance.now();
  const aplanado = aplanador.aplanar(malla, { iteraciones: 30 });
  const segundos = (performance.now() - t0) / 1000;
  const total = medirDeformacion(malla, aplanado);
  const antebrazo = medirDeformacion(malla, aplanado, enAntebrazo);

  const okTiempo = segundos < 5;
  const okDeformacion = antebrazo.p95 <= 0.02;
  const okSolapes = aplanado.volteados === 0;
  todoBien &&= okTiempo && okDeformacion && okSolapes;
  const marca = (ok: boolean) => (ok ? "✓" : "✗");

  console.log(`\n${nombre}`);
  console.log(`  ${malla.vertices.length / 3} vértices, ${malla.caras.length / 3} triángulos, tipo: ${aplanado.tipo}` +
    (aplanado.corte.length ? `, corte de ${aplanado.corte.length} vértices` : ""));
  console.log(`  ${marca(okTiempo)} tiempo: ${segundos.toFixed(2)} s`);
  console.log(`  ${marca(okDeformacion)} antebrazo: p95 ${pct(antebrazo.p95)}, ${antebrazo.areaDentroDel2.toFixed(1)} % del área ≤ 2 %, máx ${pct(antebrazo.maximo)}`);
  console.log(`    zona completa: p95 ${pct(total.p95)}, ${total.areaDentroDel2.toFixed(1)} % del área ≤ 2 %, máx ${pct(total.maximo)}`);
  console.log(`  ${marca(okSolapes)} triángulos invertidos: ${aplanado.volteados}`);
}

// Comprobaciones informativas (no cuentan para el criterio).
console.log("\nInformativo: deformación según el tamaño de la zona");
const informe = (nombre: string, malla: Malla) => {
  const d = medirDeformacion(malla, aplanador.aplanar(malla, { iteraciones: 30 }));
  console.log(`  ${nombre.padEnd(44)} p95 ${pct(d.p95)}, ${d.areaDentroDel2.toFixed(0)} % del área ≤ 2 %`);
};
informe("Cono (control: desplegable, debe dar 0 %)", conoDeControl());
informe("Antebrazo completo (muñeca → codo)", mangaDePrueba(-30, -4, 64, 32));
informe("Media manga de antebrazo", mangaDePrueba(-30, -15, 64, 24));
informe("Brazo (codo → hombro)", mangaDePrueba(2, 32, 64, 32));

console.log(`\nP1 ${todoBien ? "SUPERADA" : "NO SUPERADA"}`);
process.exitCode = todoBien ? 0 : 1;
