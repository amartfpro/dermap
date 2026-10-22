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
}

export const AJUSTES_INICIALES: AjustesPincel = {
  herramienta: "pincel",
  color: "#1d1b1a",
  tamano: 1.5,
  opacidad: 1,
  dureza: 0.9,
  presionTamano: true,
  presionOpacidad: false,
};

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
    this.punta = Punta.obtener(ajustes.herramienta === "goma" ? "#000000" : ajustes.color, ajustes.dureza);
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
      const zonas = [new DOMMatrix(), ...transformaciones([x, y], [x, y], this.diametro(presion))].map((m) =>
        this.estampar(x, y, presion, m),
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
      matrices.forEach((m, k) => (sucio[k] = unir(sucio[k], this.estampar(px, py, p, m))));
      const paso = Math.max(0.5, ESPACIADO * this.diametro(p));
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

  private estampar(x: number, y: number, presion: number, m: DOMMatrix): Rect {
    const escala = Math.hypot(m.a, m.b);
    const p = m.transformPoint({ x, y });
    const d = this.diametro(presion) * escala;
    const r = d / 2;
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
}
