import type { Lienzo } from "./lienzo";
import { contexto, teselasEn, TESELA, transformarRect, type Rect } from "./teselas";

/**
 * Imagen importada (PNG o JPG) que se coloca sobre el lienzo antes de fijarla en una capa
 * nueva: se puede mover, escalar y girar (RF-33).
 */
export class ImagenFlotante {
  /** Lleva píxeles de la imagen a píxeles del documento. */
  matriz: DOMMatrix;

  constructor(
    readonly imagen: ImageBitmap,
    readonly nombre: string,
    lienzo: Lienzo,
    matriz?: DOMMatrix,
  ) {
    if (matriz) {
      this.matriz = matriz;
      return;
    }
    // Centrada y ocupando el 60 % del ancho de la zona (o del alto, si es más estrecha).
    const { ancho, alto } = lienzo.geo;
    const escala = Math.min((ancho * 0.6) / imagen.width, (alto * 0.6) / imagen.height);
    this.matriz = new DOMMatrix()
      .translate(ancho / 2, alto / 2)
      .scale(escala)
      .translate(-imagen.width / 2, -imagen.height / 2);
  }

  /** Esquinas en coordenadas del documento: sup-izq, sup-der, inf-der, inf-izq. */
  esquinas(): DOMPoint[] {
    const { width: w, height: h } = this.imagen;
    return [
      this.matriz.transformPoint({ x: 0, y: 0 }),
      this.matriz.transformPoint({ x: w, y: 0 }),
      this.matriz.transformPoint({ x: w, y: h }),
      this.matriz.transformPoint({ x: 0, y: h }),
    ];
  }

  centro(): DOMPoint {
    return this.matriz.transformPoint({ x: this.imagen.width / 2, y: this.imagen.height / 2 });
  }

  /** ¿Está el punto del documento dentro de la imagen? */
  contiene(x: number, y: number): boolean {
    const p = this.matriz.inverse().transformPoint({ x, y });
    return p.x >= 0 && p.y >= 0 && p.x <= this.imagen.width && p.y <= this.imagen.height;
  }

  mover(dx: number, dy: number): void {
    this.matriz = new DOMMatrix().translate(dx, dy).multiply(this.matriz);
  }

  /** Escala uniforme alrededor del centro. */
  escalar(factor: number): void {
    const c = this.centro();
    this.matriz = new DOMMatrix().translate(c.x, c.y).scale(factor).translate(-c.x, -c.y).multiply(this.matriz);
  }

  /** Giro alrededor del centro, en grados. */
  girar(grados: number): void {
    const c = this.centro();
    this.matriz = new DOMMatrix().translate(c.x, c.y).rotate(grados).translate(-c.x, -c.y).multiply(this.matriz);
  }

  rect(): Rect {
    return transformarRect({ x0: 0, y0: 0, x1: this.imagen.width, y1: this.imagen.height }, this.matriz);
  }

  /** Fija la imagen en una capa nueva encima de la activa; se puede deshacer. */
  fijar(lienzo: Lienzo): void {
    const doc = lienzo.doc;
    lienzo.historial.registrar(doc.instantaneaCapas(`Importar ${this.nombre}`));
    const capa = doc.añadirCapa(this.nombre.replace(/\.[^.]+$/, ""));
    const rect = this.rect();
    for (const [tx, ty] of teselasEn(rect, doc.ancho, doc.alto)) {
      const t = capa.obtenerOCrear(tx, ty);
      const ctx = contexto(t);
      ctx.setTransform(new DOMMatrix().translate(-tx * TESELA, -ty * TESELA).multiply(this.matriz));
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(this.imagen, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      capa.sucias.add(`${tx},${ty}`);
    }
    doc.avisar(rect);
    lienzo.actualizarFantasma();
  }
}
