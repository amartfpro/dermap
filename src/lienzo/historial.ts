/**
 * Historial de deshacer/rehacer (RF-32): al menos 100 pasos, con un tope de memoria.
 *
 * Cada paso sabe deshacerse y, al hacerlo, devuelve el paso inverso (que sirve para rehacer).
 */
export interface Paso {
  readonly descripcion: string;
  /** Memoria aproximada que ocupa el paso, en bytes. */
  bytes(): number;
  deshacer(): Promise<Paso>;
}

export class Historial extends EventTarget {
  private hechos: Paso[] = [];
  private deshechos: Paso[] = [];
  private ocupado = false;

  /**
   * Se garantizan `minimoPasos`; si la memoria lo permite se guardan hasta `maximoPasos`.
   */
  constructor(
    private readonly minimoPasos = 100,
    private readonly maximoPasos = 300,
    private readonly limiteBytes = 768 * 1024 * 1024,
  ) {
    super();
  }

  get puedeDeshacer(): boolean {
    return this.hechos.length > 0 && !this.ocupado;
  }

  get puedeRehacer(): boolean {
    return this.deshechos.length > 0 && !this.ocupado;
  }

  registrar(paso: Paso): void {
    this.hechos.push(paso);
    this.deshechos = [];
    this.recortar();
    this.avisar();
  }

  async deshacer(): Promise<void> {
    const paso = this.puedeDeshacer ? this.hechos.pop() : undefined;
    if (!paso) return;
    this.ocupado = true;
    try {
      this.deshechos.push(await paso.deshacer());
    } finally {
      this.ocupado = false;
      this.avisar();
    }
  }

  async rehacer(): Promise<void> {
    const paso = this.puedeRehacer ? this.deshechos.pop() : undefined;
    if (!paso) return;
    this.ocupado = true;
    try {
      this.hechos.push(await paso.deshacer());
    } finally {
      this.ocupado = false;
      this.avisar();
    }
  }

  vaciar(): void {
    this.hechos = [];
    this.deshechos = [];
    this.avisar();
  }

  /** Por encima del límite de memoria se descartan los pasos más antiguos, nunca por debajo del mínimo. */
  private recortar(): void {
    while (this.hechos.length > this.maximoPasos) this.hechos.shift();
    let total = this.hechos.reduce((s, p) => s + p.bytes(), 0);
    while (total > this.limiteBytes && this.hechos.length > this.minimoPasos) {
      total -= this.hechos.shift()!.bytes();
    }
  }

  private avisar(): void {
    this.dispatchEvent(new Event("cambio"));
  }
}
