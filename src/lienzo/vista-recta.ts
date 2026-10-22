import { bordesDe } from "../geometria/corte";
import { PX_POR_CM } from "./geometria-zona";
import type { Lienzo } from "./lienzo";
import { afin } from "./transferir";

type P2 = [number, number];
type P3 = [number, number, number];

/** Tamaño de celda de la rejilla que acelera la búsqueda de triángulos (px del rectángulo). */
const CELDA = 96;

/**
 * Vista rectangular de una manga (RF-38): la piel desenrollada alrededor del eje del miembro,
 * con el corte en los bordes izquierdo y derecho. En horizontal, la vuelta al brazo; en
 * vertical, la longitud. Una línea horizontal aquí es un anillo alrededor del brazo.
 *
 * Es solo otra forma de ver y dibujar el mismo lienzo: cada triángulo de la zona tiene su
 * sitio en el lienzo y en el rectángulo, y los puntos se llevan de uno a otro con la
 * transformación afín de su triángulo. Las medidas a lo largo del brazo son reales; las de
 * la vuelta se reparten con el radio medio (aproximado donde el brazo se estrecha).
 */
export class VistaRecta {
  /** Tamaño del rectángulo en píxeles a 300 ppp. */
  readonly ancho: number;
  readonly alto: number;
  /** Margen alrededor del rectángulo, como en el lienzo. */
  readonly margen = Math.round(0.5 * PX_POR_CM);
  /** Tinta del lienzo vista en el rectángulo, a la escala de la vista previa. */
  readonly imagen: OffscreenCanvas;
  readonly escala: number;
  /** Contorno de la zona en el rectángulo (bordes de los extremos del brazo y del corte). */
  readonly contorno = new Path2D();

  private readonly trisLienzo: P2[][] = [];
  private readonly trisRecta: P2[][] = [];
  private readonly rejilla = new Map<string, number[]>();

  constructor(private readonly lienzo: Lienzo) {
    const { malla, aplanado } = lienzo.zona;
    const v = malla.vertices;
    const p = (i: number): P3 => [v[3 * i], v[3 * i + 1], v[3 * i + 2]];
    const bordes = bordesDe(malla);
    if (bordes.length !== 2 || !aplanado.corte.length) throw new Error("La vista rectangular es solo para mangas.");

    // Eje: una línea central curva que pasa por el centro de cada rodaja del miembro (el
    // brazo no es recto: el codo se dobla), de un extremo al otro.
    const centro = (b: number[]): P3 => {
      const c: P3 = [0, 0, 0];
      for (const i of b) for (let k = 0; k < 3; k++) c[k] += v[3 * i + k] / b.length;
      return c;
    };
    const c0 = centro(bordes[0]), c1 = centro(bordes[1]);
    const nV = v.length / 3;
    const recta = restar(c1, c0);
    const largoRecto = norma(recta);
    const dir = escalar(recta, 1 / largoRecto);
    const RODAJAS = 40;
    const sumas = Array.from({ length: RODAJAS }, () => ({ c: [0, 0, 0] as P3, n: 0 }));
    for (let i = 0; i < nV; i++) {
      const t = punto3(restar(p(i), c0), dir) / largoRecto;
      const k = Math.min(RODAJAS - 1, Math.max(0, Math.floor(t * RODAJAS)));
      for (let j = 0; j < 3; j++) sumas[k].c[j] += v[3 * i + j];
      sumas[k].n++;
    }
    const linea: P3[] = [c0];
    for (const r of sumas) if (r.n > 8) linea.push(escalar(r.c, 1 / r.n));
    linea.push(c1);
    // Suavizado ligero de la línea central.
    const eje: P3[] = linea.map((q, i) =>
      i === 0 || i === linea.length - 1 ? q : escalar(sumar(sumar(linea[i - 1], escalar(q, 2)), linea[i + 1]), 0.25),
    );
    const tangentes = eje.slice(1).map((q, i) => normalizar(restar(q, eje[i])));
    const acumulado = [0];
    for (let i = 1; i < eje.length; i++) acumulado.push(acumulado[i - 1] + norma(restar(eje[i], eje[i - 1])));

    // Referencia perpendicular transportada a lo largo del eje (sin giros bruscos).
    const corte = [...aplanado.corte];
    const finCorte = corte.indexOf(-1);
    const principal = finCorte < 0 ? corte : corte.slice(0, finCorte);
    let e1 = restar(p(principal[0]), eje[0]);
    e1 = normalizar(restar(e1, escalar(tangentes[0], punto3(e1, tangentes[0]))));
    const referencias: P3[] = [];
    for (const t of tangentes) {
      e1 = normalizar(restar(e1, escalar(t, punto3(e1, t))));
      referencias.push(e1);
    }
    /** Posición a lo largo del eje y ángulo alrededor de él. */
    const proyectar = (q: P3): { s: number; angulo: number; r: number } => {
      let mejor = { d: Infinity, s: 0, angulo: 0, r: 0 };
      for (let i = 0; i < tangentes.length; i++) {
        const seg = restar(eje[i + 1], eje[i]);
        const l2 = punto3(seg, seg) || 1;
        const t = Math.min(1, Math.max(0, punto3(restar(q, eje[i]), seg) / l2));
        const pie = sumar(eje[i], escalar(seg, t));
        const perp = restar(q, pie);
        const d = norma(perp);
        if (d < mejor.d) {
          const e2 = cruz(tangentes[i], referencias[i]);
          mejor = { d, s: acumulado[i] + t * Math.sqrt(l2), angulo: Math.atan2(punto3(perp, e2), punto3(perp, referencias[i])), r: d };
        }
      }
      return mejor;
    };
    const theta = new Float64Array(nV), sv = new Float64Array(nV);
    let radio = 0;
    for (let i = 0; i < nV; i++) {
      const q = proyectar(p(i));
      sv[i] = q.s;
      theta[i] = q.angulo;
      radio += q.r / nV;
    }
    // Suavizado sobre la malla: la proyección a una línea con codos tiene saltos donde un
    // vértice pasa de un tramo al siguiente; promediar con los vecinos los quita. El ángulo
    // se promedia como vector para no romperlo al dar la vuelta.
    {
      const vecinos: number[][] = Array.from({ length: nV }, () => []);
      const f = malla.caras;
      for (let k = 0; k < f.length; k += 3)
        for (let j = 0; j < 3; j++) {
          const a = f[k + j], b = f[k + ((j + 1) % 3)];
          vecinos[a].push(b);
          vecinos[b].push(a);
        }
      let cs = Float64Array.from(theta, Math.cos), sn = Float64Array.from(theta, Math.sin);
      let ss = Float64Array.from(sv);
      for (let it = 0; it < 12; it++) {
        const c2 = new Float64Array(nV), s2 = new Float64Array(nV), t2 = new Float64Array(nV);
        for (let i = 0; i < nV; i++) {
          const ns = vecinos[i];
          let mc = 0, ms = 0, mt = 0;
          for (const k of ns) {
            mc += cs[k];
            ms += sn[k];
            mt += ss[k];
          }
          const n = ns.length || 1;
          c2[i] = 0.5 * cs[i] + (0.5 * mc) / n;
          s2[i] = 0.5 * sn[i] + (0.5 * ms) / n;
          t2[i] = 0.5 * ss[i] + (0.5 * mt) / n;
        }
        cs = c2;
        sn = s2;
        ss = t2;
      }
      for (let i = 0; i < nV; i++) {
        theta[i] = Math.atan2(sn[i], cs[i]);
        sv[i] = ss[i];
      }
    }

    // El ángulo se mide desde el corte a cada altura: así el corte queda justo en los bordes
    // izquierdo y derecho del rectángulo.
    const puntosCorte = principal.map((i) => ({ s: sv[i], a: theta[i] })).sort((x, y) => x.s - y.s);
    for (let k = 1; k < puntosCorte.length; k++) {
      while (puntosCorte[k].a - puntosCorte[k - 1].a > Math.PI) puntosCorte[k].a -= 2 * Math.PI;
      while (puntosCorte[k - 1].a - puntosCorte[k].a > Math.PI) puntosCorte[k].a += 2 * Math.PI;
    }
    const anguloCorte = (sq: number) => {
      if (sq <= puntosCorte[0].s) return puntosCorte[0].a;
      for (let k = 1; k < puntosCorte.length; k++)
        if (sq <= puntosCorte[k].s) {
          const a0 = puntosCorte[k - 1], a1 = puntosCorte[k];
          const t = a1.s > a0.s ? (sq - a0.s) / (a1.s - a0.s) : 0;
          return a0.a + t * (a1.a - a0.a);
        }
      return puntosCorte[puntosCorte.length - 1].a;
    };
    for (let i = 0; i < nV; i++) {
      let t = theta[i] - anguloCorte(sv[i]);
      t = ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      theta[i] = t;
    }

    // Triángulos en los dos sistemas. En cada triángulo, los ángulos se desenrollan respecto
    // al de su centro para que los que tocan el corte no den la vuelta entera.
    const caras = aplanado.caras, origen = aplanado.origen;
    const geo = lienzo.geo;
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    const crudos: P2[][] = [];
    for (let f = 0; f < caras.length / 3; f++) {
      const vs = [caras[3 * f], caras[3 * f + 1], caras[3 * f + 2]];
      const os = vs.map((c) => origen[c]);
      const ts = os.map((o) => theta[o]);
      // Centro angular del triángulo (media circular).
      const cx = ts.reduce((a, t) => a + Math.cos(t), 0), cy = ts.reduce((a, t) => a + Math.sin(t), 0);
      let tc = Math.atan2(cy, cx);
      if (tc < 0) tc += 2 * Math.PI;
      const r: P2[] = os.map((o, k) => {
        let t = ts[k];
        if (t - tc > Math.PI) t -= 2 * Math.PI;
        if (tc - t > Math.PI) t += 2 * Math.PI;
        return [t * radio * PX_POR_CM, sv[o] * PX_POR_CM];
      });
      crudos.push(r);
      this.trisLienzo.push(vs.map((c) => geo.aLienzo(c) as P2));
      for (const [x, y] of r) {
        xMin = Math.min(xMin, x);
        xMax = Math.max(xMax, x);
        yMin = Math.min(yMin, y);
        yMax = Math.max(yMax, y);
      }
    }
    // Orientación: que arriba y abajo coincidan con el lienzo (correlación de las alturas),
    // y la izquierda con la izquierda.
    let cy = 0, cxx = 0;
    crudos.forEach((t, f) => {
      const yl = (this.trisLienzo[f][0][1] + this.trisLienzo[f][1][1] + this.trisLienzo[f][2][1]) / 3;
      const xl = (this.trisLienzo[f][0][0] + this.trisLienzo[f][1][0] + this.trisLienzo[f][2][0]) / 3;
      const yr = (t[0][1] + t[1][1] + t[2][1]) / 3, xr = (t[0][0] + t[1][0] + t[2][0]) / 3;
      cy += (yl - geo.alto / 2) * (yr - (yMin + yMax) / 2);
      cxx += (xl - geo.ancho / 2) * (xr - (xMin + xMax) / 2);
    });
    const m = this.margen;
    for (const t of crudos)
      this.trisRecta.push(
        t.map(([x, y]) => [
          (cxx >= 0 ? x - xMin : xMax - x) + m,
          (cy >= 0 ? y - yMin : yMax - y) + m,
        ] as P2),
      );
    this.ancho = Math.ceil(xMax - xMin + 2 * m);
    this.alto = Math.ceil(yMax - yMin + 2 * m);

    // Rejilla para encontrar el triángulo bajo un punto.
    this.trisRecta.forEach((t, f) => {
      const x0 = Math.floor(Math.min(t[0][0], t[1][0], t[2][0]) / CELDA), x1 = Math.floor(Math.max(t[0][0], t[1][0], t[2][0]) / CELDA);
      const y0 = Math.floor(Math.min(t[0][1], t[1][1], t[2][1]) / CELDA), y1 = Math.floor(Math.max(t[0][1], t[1][1], t[2][1]) / CELDA);
      for (let gx = x0; gx <= x1; gx++)
        for (let gy = y0; gy <= y1; gy++) {
          const k = `${gx},${gy}`;
          const lista = this.rejilla.get(k);
          if (lista) lista.push(f);
          else this.rejilla.set(k, [f]);
        }
    });

    // Contorno: aristas que solo pertenecen a un triángulo de la malla cortada.
    const usos = new Map<string, number>();
    const arista = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
    for (let f = 0; f < caras.length / 3; f++)
      for (let j = 0; j < 3; j++) {
        const k = arista(caras[3 * f + j], caras[3 * f + ((j + 1) % 3)]);
        usos.set(k, (usos.get(k) ?? 0) + 1);
      }
    for (let f = 0; f < caras.length / 3; f++)
      for (let j = 0; j < 3; j++) {
        if (usos.get(arista(caras[3 * f + j], caras[3 * f + ((j + 1) % 3)])) !== 1) continue;
        const a = this.trisRecta[f][j], b = this.trisRecta[f][(j + 1) % 3];
        this.contorno.moveTo(...a);
        this.contorno.lineTo(...b);
      }

    this.escala = geo.escalaPrevia;
    this.imagen = new OffscreenCanvas(Math.max(1, Math.ceil(this.ancho * this.escala)), Math.max(1, Math.ceil(this.alto * this.escala)));
    this.actualizar();
  }

  /** Vuelve a pintar la tinta en el rectángulo desde la vista previa del lienzo. */
  actualizar(): void {
    const ctx = this.imagen.getContext("2d")!;
    const k = this.escala;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.imagen.width, this.imagen.height);
    const tinta = this.lienzo.tinta;
    const sx = this.lienzo.geo.anchoPrevia / this.lienzo.geo.ancho;
    for (let f = 0; f < this.trisRecta.length; f++) {
      const d = ampliar(this.trisRecta[f].map(([x, y]) => [x * k, y * k] as P2), 0.6);
      const s = this.trisLienzo[f].map(([x, y]) => [x * sx, y * sx] as P2);
      const m = afin(s, this.trisRecta[f].map(([x, y]) => [x * k, y * k] as P2));
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(...d[0]);
      ctx.lineTo(...d[1]);
      ctx.lineTo(...d[2]);
      ctx.closePath();
      ctx.clip();
      ctx.setTransform(m);
      // Solo la parte de la tinta que cubre el triángulo (mucho más rápido que la imagen entera).
      const x0 = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0])) - 2);
      const y0 = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1])) - 2);
      const x1 = Math.min(tinta.width, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0])) + 2);
      const y1 = Math.min(tinta.height, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])) + 2);
      if (x1 > x0 && y1 > y0) ctx.drawImage(tinta, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
      ctx.restore();
    }
  }

  /** Punto del lienzo que corresponde a un punto del rectángulo (null fuera de la zona). */
  aLienzo(x: number, y: number): { x: number; y: number } | null {
    const f = this.triangulo(x, y);
    if (f === null) return null;
    const m = afin(this.trisRecta[f], this.trisLienzo[f]);
    return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
  }

  private triangulo(x: number, y: number): number | null {
    const lista = this.rejilla.get(`${Math.floor(x / CELDA)},${Math.floor(y / CELDA)}`);
    if (!lista) return null;
    for (const f of lista) {
      const [a, b, c] = this.trisRecta[f];
      const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(d) < 1e-9) continue;
      const l1 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d;
      const l2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d;
      if (l1 >= -1e-6 && l2 >= -1e-6 && l1 + l2 <= 1 + 1e-6) return f;
    }
    return null;
  }
}

const restar = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const sumar = (a: P3, b: P3): P3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const escalar = (a: P3, k: number): P3 => [a[0] * k, a[1] * k, a[2] * k];
const punto3 = (a: P3, b: P3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cruz = (a: P3, b: P3): P3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norma = (a: P3) => Math.hypot(a[0], a[1], a[2]);
const normalizar = (a: P3): P3 => escalar(a, 1 / (norma(a) || 1));

function ampliar(t: P2[], px: number): P2[] {
  const cx = (t[0][0] + t[1][0] + t[2][0]) / 3, cy = (t[0][1] + t[1][1] + t[2][1]) / 3;
  return t.map(([x, y]) => {
    const l = Math.hypot(x - cx, y - cy) || 1;
    return [x + ((x - cx) / l) * px, y + ((y - cy) / l) * px] as P2;
  });
}
