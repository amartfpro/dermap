import type { Capa } from "./capa";
import {
  claveTesela,
  contexto,
  crearLamina,
  rectDePunto,
  rectVacio,
  teselasEn,
  TESELA,
  unir,
  type Lamina,
  type Rect,
} from "./teselas";

export type Herramienta = "pincel" | "goma";

/** Forma de la estampa: círculo continuo o nube de puntos (puntillismo, RF-34). */
export type FormaPunta = "redonda" | "puntos";

/** Ajustes del pincel (RF-30). Los tamaños se expresan en milímetros reales sobre la piel. */
export interface AjustesPincel {
  herramienta: Herramienta;
  color: string;
  /** Diámetro máximo en mm (con presión máxima). */
  tamano: number;
  /** Opacidad de todo el trazo, 0–1. */
  opacidad: number;
  /** 1 = borde duro (línea), 0 = muy difuminado (sombreado). */
  dureza: number;
  /** La presión del lápiz cambia el grosor. */
  presionTamano: boolean;
  /** La presión del lápiz cambia la intensidad (acumulación, como un aerógrafo). */
  presionOpacidad: boolean;
  /** Estampa continua o puntillismo. */
  forma: FormaPunta;
}

export const AJUSTES_INICIALES: AjustesPincel = {
  herramienta: "pincel",
  color: "#1d1b1a",
  tamano: 1.5,
  opacidad: 1,
  dureza: 0.9,
  presionTamano: true,
  presionOpacidad: false,
  forma: "redonda",
};

/** Pinceles predefinidos para tatuaje (RF-34). Solo cambian los ajustes del pincel. */
export const PRESETS: { nombre: string; ajustes: Partial<AjustesPincel> }[] = [
  { nombre: "Línea fina", ajustes: { herramienta: "pincel", tamano: 0.6, opacidad: 1, dureza: 0.95, presionTamano: true, presionOpacidad: false, forma: "redonda" } },
  { nombre: "Línea", ajustes: { herramienta: "pincel", tamano: 1.5, opacidad: 1, dureza: 0.9, presionTamano: true, presionOpacidad: false, forma: "redonda" } },
  { nombre: "Línea gruesa", ajustes: { herramienta: "pincel", tamano: 3, opacidad: 1, dureza: 0.9, presionTamano: true, presionOpacidad: false, forma: "redonda" } },
  { nombre: "Relleno", ajustes: { herramienta: "pincel", tamano: 8, opacidad: 1, dureza: 0.8, presionTamano: false, presionOpacidad: false, forma: "redonda" } },
  { nombre: "Sombreado suave", ajustes: { herramienta: "pincel", tamano: 10, opacidad: 0.5, dureza: 0.05, presionTamano: false, presionOpacidad: true, forma: "redonda" } },
  { nombre: "Puntillismo", ajustes: { herramienta: "pincel", tamano: 6, opacidad: 1, dureza: 1, presionTamano: false, presionOpacidad: true, forma: "puntos" } },
];

/** Diámetro de cada punto del puntillismo, en mm (una aguja de liner). */
const PUNTO_MM = 0.35;

/** Distancia entre estampas, como fracción del diámetro. */
const ESPACIADO = 0.12;

/**
 * Punta del pincel: un círculo con borde según la dureza, en el color del trazo.
 * Se dibuja una vez a 256 px y se escala en cada estampa.
 */
class Punta {
  private static cache = new Map<string, Lamina>();

  static obtener(color: string, dureza: number): Lamina {
    const clave = `${color}|${dureza.toFixed(2)}`;
    let punta = Punta.cache.get(clave);
    if (punta) return punta;
    const T = 256;
    punta = crearLamina(T, T);
    const ctx = contexto(punta);
    const g = ctx.createRadialGradient(T / 2, T / 2, 0, T / 2, T / 2, T / 2);
    const inicioDifuminado = Math.min(0.98, Math.max(0, dureza));
    g.addColorStop(0, color);
    g.addColorStop(inicioDifuminado, color);
    g.addColorStop(1, transparente(color));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(T / 2, T / 2, T / 2, 0, Math.PI * 2);
    ctx.fill();
    if (Punta.cache.size > 64) Punta.cache.clear();
    Punta.cache.set(clave, punta);
    return punta;
  }
}

function transparente(color: string): string {
  const hex = color.replace("#", "");
  const n = parseInt(hex.length === 3 ? hex.replace(/./g, "$&$&") : hex, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 0)`;
}

/**
 * Trazo en curso. Las estampas se acumulan en un búfer de teselas aparte y se funden con la
 * capa al terminar: así la opacidad del trazo no se acumula donde el trazo se solapa consigo
 * mismo, y la goma puede mostrarse en vivo sin tocar todavía la capa.
 */
export class Trazo {
  readonly buffer = new Map<string, Lamina>();
  /** Zona del documento afectada por el trazo hasta ahora. */
  rect: Rect = rectVacio();
  private ultimo: { x: number; y: number; presion: number } | null = null;
  private resto = 0;
  private readonly punta: Lamina;

  constructor(
    readonly capa: Capa,
    readonly ajustes: AjustesPincel,
    private readonly pxPorMm: number,
    private readonly ancho: number,
    private readonly alto: number,
  ) {
    // La goma usa una punta negra: solo importa su alfa.
    const color = ajustes.herramienta === "goma" ? "#000000" : ajustes.color;
    this.punta = Punta.obtener(color, ajustes.forma === "puntos" ? 0.85 : ajustes.dureza);
  }

  /**
   * Añade un punto del lápiz. `transformaciones(a, b, ancho)` devuelve las matrices extra
   * para repetir el segmento al otro lado de una costura (RF-36). Devuelve las zonas
   * modificadas: una por copia, porque la copia al otro lado de la costura queda lejos.
   */
  añadir(
    x: number,
    y: number,
    presion: number,
    transformaciones: (a: [number, number], b: [number, number], ancho: number) => DOMMatrix[] = () => [],
  ): Rect[] {
    if (!this.ultimo) {
      this.ultimo = { x, y, presion };
      const puntos = this.puntosDeEstampa(presion);
      const zonas = [new DOMMatrix(), ...transformaciones([x, y], [x, y], this.diametro(presion))].map((m) =>
        this.estampar(x, y, presion, m, puntos),
      );
      for (const z of zonas) this.rect = unir(this.rect, z);
      return zonas;
    }
    const a = this.ultimo;
    const distancia = Math.hypot(x - a.x, y - a.y);
    const extras = transformaciones([a.x, a.y], [x, y], this.diametro(Math.max(a.presion, presion)));
    const matrices = [new DOMMatrix(), ...extras];
    const sucio = matrices.map(() => rectVacio());
    // Estampas espaciadas a lo largo del segmento, interpolando la presión.
    let recorrido = this.resto;
    while (true) {
      const t = distancia > 0 ? recorrido / distancia : 1;
      if (t > 1) break;
      const p = a.presion + (presion - a.presion) * t;
      const px = a.x + (x - a.x) * t;
      const py = a.y + (y - a.y) * t;
      // Los puntos se sortean una vez por estampa, para que la copia al otro lado de la costura coincida.
      const puntos = this.puntosDeEstampa(p);
      matrices.forEach((m, k) => (sucio[k] = unir(sucio[k], this.estampar(px, py, p, m, puntos))));
      const espaciado = this.ajustes.forma === "puntos" ? 0.35 : ESPACIADO;
      const paso = Math.max(0.5, espaciado * this.diametro(p));
      recorrido += paso;
      if (distancia === 0) break;
    }
    this.resto = recorrido - distancia;
    this.ultimo = { x, y, presion };
    for (const z of sucio) this.rect = unir(this.rect, z);
    return sucio;
  }

  private diametro(presion: number): number {
    const factor = this.ajustes.presionTamano ? 0.15 + 0.85 * presion : 1;
    return Math.max(1, this.ajustes.tamano * this.pxPorMm * factor);
  }

  /**
   * Puntillismo: desplazamientos (en fracciones del radio) de los puntos de una estampa.
   * La presión, si controla la intensidad, cambia la cantidad de puntos, no su opacidad.
   */
  private puntosDeEstampa(presion: number): Float32Array | null {
    if (this.ajustes.forma !== "puntos") return null;
    const d = this.diametro(presion);
    const punto = PUNTO_MM * this.pxPorMm;
    const densidad = this.ajustes.presionOpacidad ? presion ** 1.5 : 0.6;
    const media = Math.max(0.3, ((d / punto) ** 2) * 0.06 * densidad);
    let n = Math.floor(media);
    if (Math.random() < media - n) n++;
    const puntos = new Float32Array(2 * n);
    for (let i = 0; i < n; i++) {
      // Uniforme en el disco.
      const r = Math.sqrt(Math.random());
      const a = Math.random() * Math.PI * 2;
      puntos[2 * i] = r * Math.cos(a);
      puntos[2 * i + 1] = r * Math.sin(a);
    }
    return puntos;
  }

  private estampar(x: number, y: number, presion: number, m: DOMMatrix, puntos: Float32Array | null = null): Rect {
    const escala = Math.hypot(m.a, m.b);
    const p = m.transformPoint({ x, y });
    const d = this.diametro(presion) * escala;
    const r = d / 2;
    if (puntos) return this.estamparPuntos(p, r, escala, m, puntos);
    const alfa = this.ajustes.presionOpacidad ? Math.max(0.03, presion ** 1.5) * 0.4 : 1;
    const zona = rectDePunto(p.x, p.y, r + 1);
    for (const [tx, ty] of teselasEn(zona, this.ancho, this.alto)) {
      const clave = claveTesela(tx, ty);
      let t = this.buffer.get(clave);
      if (!t) {
        t = crearLamina(TESELA, TESELA);
        this.buffer.set(clave, t);
      }
      const ctx = contexto(t);
      ctx.globalAlpha = alfa;
      ctx.drawImage(this.punta, p.x - r - tx * TESELA, p.y - r - ty * TESELA, d, d);
    }
    return zona;
  }

  private estamparPuntos(c: { x: number; y: number }, r: number, escala: number, m: DOMMatrix, puntos: Float32Array): Rect {
    const dp = Math.max(1.5, PUNTO_MM * this.pxPorMm * escala);
    let zona = rectVacio();
    for (let i = 0; i < puntos.length; i += 2) {
      // El desplazamiento se gira con la matriz de la costura (sin la traslación).
      const ox = puntos[i] * r, oy = puntos[i + 1] * r;
      const px = c.x + (m.a * ox + m.c * oy) / escala;
      const py = c.y + (m.b * ox + m.d * oy) / escala;
      const z = rectDePunto(px, py, dp / 2 + 1);
      zona = unir(zona, z);
      for (const [tx, ty] of teselasEn(z, this.ancho, this.alto)) {
        const clave = claveTesela(tx, ty);
        let t = this.buffer.get(clave);
        if (!t) {
          t = crearLamina(TESELA, TESELA);
          this.buffer.set(clave, t);
        }
        const ctx = contexto(t);
        ctx.globalAlpha = 1;
        ctx.drawImage(this.punta, px - dp / 2 - tx * TESELA, py - dp / 2 - ty * TESELA, dp, dp);
      }
    }
    return zona.x1 > zona.x0 ? zona : rectDePunto(c.x, c.y, 0);
  }
}
