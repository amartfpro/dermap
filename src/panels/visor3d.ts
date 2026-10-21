import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { IContentRenderer } from "dockview-core";
import { aplanarEnSegundoPlano } from "../geometria/cliente";
import { medirDeformacion } from "../geometria/metricas";
import { longitud, seleccionarPorEje, submalla, suavizarSeleccion, type Seleccion } from "../geometria/seleccion";
import { cargarCuerpo, ejeDeLaPierna, ejeDelBrazo, type Cuerpo } from "../modelos/cuerpo";
import { activarZona, estado, ZonaActiva } from "../zona";

type P3 = [number, number, number];

/**
 * Visor 3D: el cuerpo base, la selección de zona a pincel (RF-20) y la zona aplanada
 * texturizada con el lienzo. Unidades de la escena: centímetros, pies en y = 0.
 *
 * Con «Seleccionar» activo: arrastrar con el botón izquierdo añade a la zona, con
 * Mayús pulsada la quita; el botón derecho gira la cámara y la rueda acerca.
 */
export class Visor3D implements IContentRenderer {
  readonly element: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private escena = new THREE.Scene();
  private camara = new THREE.PerspectiveCamera(35, 1, 1, 2000);
  private controles: OrbitControls;
  private observador: ResizeObserver;
  private estadoTexto: HTMLElement;
  private botonSeleccionar: HTMLButtonElement;
  private radioPincel = 2.5;
  private activo = true;

  private cuerpo: Cuerpo | null = null;
  private mallaCuerpo: THREE.Mesh | null = null;
  private normalesCuerpo: THREE.BufferAttribute | null = null;
  private centros = new Float32Array(0);
  private normalesCaras = new Float32Array(0);

  private seleccionados = new Set<number>();
  private resaltado = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      color: 0xd9774b,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    }),
  );
  private modoSeleccion = false;
  private pendiente: PointerEvent | null = null;
  private pintando: "añadir" | "quitar" | null = null;
  private raycaster = new THREE.Raycaster();

  private zona3d = new THREE.Group();
  private textura: THREE.CanvasTexture | null = null;
  private alCambiarZona = () => this.mostrarZona();
  private alCambiarTextura = () => {
    if (this.textura) this.textura.needsUpdate = true;
  };

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "panel";

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x22252a);
    this.element.appendChild(this.renderer.domElement);

    const barra = document.createElement("div");
    barra.className = "herramientas flotante";
    this.botonSeleccionar = boton("Seleccionar", () => this.alternarSeleccion());
    this.botonSeleccionar.title = "Pinta la zona sobre el cuerpo. Mayús + arrastrar para quitar.";
    const radio = document.createElement("input");
    radio.type = "range";
    radio.min = "1";
    radio.max = "6";
    radio.step = "0.5";
    radio.value = String(this.radioPincel);
    radio.title = "Radio del pincel de selección";
    radio.className = "deslizador";
    radio.addEventListener("input", () => (this.radioPincel = Number(radio.value)));
    this.estadoTexto = document.createElement("div");
    this.estadoTexto.className = "etiqueta-flotante";
    this.estadoTexto.textContent = "Cargando cuerpo…";
    barra.append(
      desplegable("Vista", VISTAS.map((v) => v.nombre), (i) => this.verVista(i)),
      desplegable("Zona rápida", ZONAS_RAPIDAS.map((z) => z.nombre), (i) => this.zonaRapida(i)),
      this.botonSeleccionar,
      radio,
      boton("Limpiar", () => this.fijarSeleccion([])),
      boton("Aplanar zona", () => void this.aplanar()),
    );
    this.element.append(barra, this.estadoTexto);

    this.controles = new OrbitControls(this.camara, this.renderer.domElement);
    this.controles.enableDamping = true;

    this.montarEscena();
    document.addEventListener("dermap:zona", this.alCambiarZona);
    document.addEventListener("dermap:textura", this.alCambiarTextura);

    const lienzo = this.renderer.domElement;
    lienzo.addEventListener("pointerdown", (e) => this.empezarPincel(e));
    lienzo.addEventListener("pointermove", (e) => this.moverPincel(e));
    lienzo.addEventListener("pointerup", () => this.terminarPincel());
    lienzo.addEventListener("contextmenu", (e) => e.preventDefault());

    this.observador = new ResizeObserver(() => this.ajustarTamano());
    this.observador.observe(this.element);

    this.renderer.setAnimationLoop(() => {
      if (!this.activo) return;
      this.controles.update();
      this.renderer.render(this.escena, this.camara);
    });

    void this.cargar();
  }

  init(): void {}

  onShow(): void {
    this.activo = true;
  }

  onHide(): void {
    this.activo = false;
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.observador.disconnect();
    this.controles.dispose();
    this.renderer.dispose();
    document.removeEventListener("dermap:zona", this.alCambiarZona);
    document.removeEventListener("dermap:textura", this.alCambiarTextura);
  }

  // ── Carga y escena ────────────────────────────────────────────────────────────

  private montarEscena(): void {
    this.escena.add(new THREE.HemisphereLight(0xffffff, 0x3a3530, 1.5));
    const luz = new THREE.DirectionalLight(0xffffff, 1.3);
    luz.position.set(60, 200, 150);
    this.escena.add(luz);
    const contraluz = new THREE.DirectionalLight(0xffffff, 0.5);
    contraluz.position.set(-80, 120, -150);
    this.escena.add(contraluz);
    this.escena.add(this.zona3d);
    // Su geometría cambia con cada pincelada: sin recorte por frustum para no recalcular límites.
    this.resaltado.frustumCulled = false;
    this.escena.add(this.resaltado);
  }

  private async cargar(): Promise<void> {
    try {
      this.cuerpo = await cargarCuerpo();
    } catch (error) {
      this.estadoTexto.textContent = `No se pudo cargar el cuerpo: ${String(error)}`;
      return;
    }
    const geometria = geometriaDe(this.cuerpo.vertices, this.cuerpo.caras);
    this.normalesCuerpo = geometria.getAttribute("normal") as THREE.BufferAttribute;
    this.mallaCuerpo = new THREE.Mesh(
      geometria,
      new THREE.MeshStandardMaterial({ color: 0xd8a98a, roughness: 0.75 }),
    );
    this.escena.add(this.mallaCuerpo);
    this.resaltado.geometry.setAttribute("position", geometria.getAttribute("position"));
    this.precalcularCaras();
    this.verVista(0);
    this.estadoTexto.textContent =
      "Elige una zona rápida o pinta una con «Seleccionar» · arrastra para girar, rueda para acercar";
  }

  private precalcularCaras(): void {
    const { vertices: v, caras: f } = this.cuerpo!;
    const n = f.length / 3;
    this.centros = new Float32Array(n * 3);
    this.normalesCaras = new Float32Array(n * 3);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let t = 0; t < n; t++) {
      a.fromArray(v, 3 * f[3 * t]);
      b.fromArray(v, 3 * f[3 * t + 1]);
      c.fromArray(v, 3 * f[3 * t + 2]);
      this.centros.set([(a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3], 3 * t);
      const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      this.normalesCaras.set([normal.x, normal.y, normal.z], 3 * t);
    }
  }

  // ── Vistas y zonas rápidas ────────────────────────────────────────────────────

  private verVista(indice: number): void {
    if (!this.cuerpo) return;
    const vista = VISTAS[indice];
    const { centro, radio, direccion } = vista.encuadre(this.cuerpo);
    this.controles.target.set(...centro);
    const dir = new THREE.Vector3(...direccion).normalize();
    this.camara.position.copy(this.controles.target).addScaledVector(dir, this.distanciaPara(radio));
    this.controles.update();
  }

  private zonaRapida(indice: number): void {
    if (!this.cuerpo) return;
    const zona = ZONAS_RAPIDAS[indice];
    const seleccion = zona.seleccionar(this.cuerpo);
    this.fijarSeleccion(seleccion.triangulos);
    this.verVista(VISTAS.findIndex((v) => v.nombre === zona.vista));
    this.estadoTexto.textContent = `${zona.nombre}: ${seleccion.triangulos.length} triángulos. Pulsa «Aplanar zona».`;
  }

  // ── Selección a pincel ────────────────────────────────────────────────────────

  private alternarSeleccion(): void {
    this.modoSeleccion = !this.modoSeleccion;
    this.botonSeleccionar.classList.toggle("activo", this.modoSeleccion);
    // En modo selección el botón izquierdo pinta; la cámara gira con el derecho.
    this.controles.mouseButtons.LEFT = this.modoSeleccion ? null : THREE.MOUSE.ROTATE;
    this.controles.mouseButtons.RIGHT = this.modoSeleccion ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
    this.renderer.domElement.style.cursor = this.modoSeleccion ? "crosshair" : "";
  }

  private empezarPincel(e: PointerEvent): void {
    if (!this.modoSeleccion || e.button !== 0 || !this.cuerpo) return;
    this.pintando = e.shiftKey ? "quitar" : "añadir";
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.pincel(e);
  }

  /** Al soltar, se suaviza el borde de la selección (quita picos de la malla base). */
  private terminarPincel(): void {
    if (!this.pintando || !this.cuerpo) return;
    this.pintando = null;
    this.fijarSeleccion(suavizarSeleccion(this.cuerpo, this.seleccionados));
  }

  private moverPincel(e: PointerEvent): void {
    if (!this.pintando) return;
    // Como mucho una pasada del pincel por fotograma.
    if (!this.pendiente) requestAnimationFrame(() => {
      if (this.pendiente && this.pintando) this.pincel(this.pendiente);
      this.pendiente = null;
    });
    this.pendiente = e;
  }

  private pincel(e: PointerEvent): void {
    const golpe = this.lanzarRayo(e);
    if (!golpe) return;
    const p = golpe.point;
    const n = golpe.normal;
    const r2 = this.radioPincel ** 2;
    let cambio = false;
    for (let t = 0; t < this.centros.length / 3; t++) {
      const dx = this.centros[3 * t] - p.x, dy = this.centros[3 * t + 1] - p.y, dz = this.centros[3 * t + 2] - p.z;
      if (dx * dx + dy * dy + dz * dz > r2) continue;
      // Solo caras orientadas como la del punto tocado: evita atravesar a la otra cara del brazo o al torso.
      const cos = this.normalesCaras[3 * t] * n.x + this.normalesCaras[3 * t + 1] * n.y + this.normalesCaras[3 * t + 2] * n.z;
      if (cos < 0.2) continue;
      if (this.pintando === "añadir" && !this.seleccionados.has(t)) {
        this.seleccionados.add(t);
        cambio = true;
      } else if (this.pintando === "quitar" && this.seleccionados.delete(t)) {
        cambio = true;
      }
    }
    if (cambio) this.actualizarResaltado();
  }

  private lanzarRayo(e: PointerEvent): { point: THREE.Vector3; normal: THREE.Vector3 } | null {
    if (!this.mallaCuerpo) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camara);
    const golpe = this.raycaster.intersectObject(this.mallaCuerpo, false)[0];
    if (!golpe || golpe.faceIndex == null) return null;
    const t = golpe.faceIndex;
    const normal = new THREE.Vector3().fromArray(this.normalesCaras, 3 * t);
    return { point: golpe.point, normal };
  }

  private fijarSeleccion(triangulos: Iterable<number>): void {
    this.seleccionados = new Set(triangulos);
    this.actualizarResaltado();
  }

  private actualizarResaltado(): void {
    if (!this.cuerpo) return;
    const indices = new Uint32Array(this.seleccionados.size * 3);
    let k = 0;
    for (const t of this.seleccionados) {
      indices[k++] = this.cuerpo.caras[3 * t];
      indices[k++] = this.cuerpo.caras[3 * t + 1];
      indices[k++] = this.cuerpo.caras[3 * t + 2];
    }
    this.resaltado.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.resaltado.visible = this.seleccionados.size > 0;
  }

  // ── Aplanado ──────────────────────────────────────────────────────────────────

  private async aplanar(): Promise<void> {
    if (!this.cuerpo) return;
    if (this.seleccionados.size < 8) {
      this.estadoTexto.textContent = "Selecciona primero una zona.";
      return;
    }
    const seleccion = submalla(this.cuerpo, this.seleccionados);
    this.estadoTexto.textContent = "Aplanando…";
    // El corte por defecto queda en la cara que no se ve (opuesta a la cámara), y el
    // lienzo se orienta como la vista actual: la derecha de la pantalla es la del lienzo.
    const haciaCamara = this.camara.position.clone().sub(this.controles.target).normalize();
    const derecha = new THREE.Vector3().setFromMatrixColumn(this.camara.matrixWorld, 0).normalize();
    try {
      const { aplanado, milisegundos } = await aplanarEnSegundoPlano(
        seleccion.malla,
        { direccionExterna: haciaCamara.toArray() as P3 },
        derecha.toArray() as P3,
      );
      const deformacion = medirDeformacion(seleccion.malla, aplanado);
      this.ultimaSeleccion = seleccion;
      activarZona(new ZonaActiva(seleccion.malla, aplanado, deformacion.porCara));
      this.fijarSeleccion([]);
      const tipo = aplanado.tipo === "manga" ? "Manga aplanada (con corte)" : "Parche aplanado";
      this.estadoTexto.textContent =
        `${tipo} en ${(milisegundos / 1000).toFixed(2)} s · ` +
        `${deformacion.areaDentroDel2.toFixed(0)} % del área con deformación ≤ 2 %`;
    } catch (error) {
      this.estadoTexto.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  private ultimaSeleccion: Seleccion | null = null;

  private mostrarZona(): void {
    for (const hijo of [...this.zona3d.children]) {
      this.zona3d.remove(hijo);
      if (hijo instanceof THREE.Mesh || hijo instanceof THREE.Line) hijo.geometry.dispose();
    }
    this.textura?.dispose();
    const zona = estado.zona;
    const seleccion = this.ultimaSeleccion;
    if (!zona || !seleccion || !this.normalesCuerpo) return;

    const { malla, aplanado } = zona;
    // Normales del cuerpo completo: la zona se sombrea igual que la piel que la rodea.
    const n = aplanado.origen.length;
    const posiciones = new Float32Array(n * 3);
    const normales = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const o = aplanado.origen[i];
      const b = seleccion.verticeBase[o];
      posiciones.set(malla.vertices.subarray(3 * o, 3 * o + 3), 3 * i);
      normales.set([this.normalesCuerpo.getX(b), this.normalesCuerpo.getY(b), this.normalesCuerpo.getZ(b)], 3 * i);
    }
    const geometria = new THREE.BufferGeometry();
    geometria.setAttribute("position", new THREE.BufferAttribute(posiciones, 3));
    geometria.setAttribute("normal", new THREE.BufferAttribute(normales, 3));
    geometria.setAttribute("uv", new THREE.BufferAttribute(zona.coordenadasDeTextura(), 2));
    geometria.setIndex(new THREE.BufferAttribute(new Uint32Array(aplanado.caras), 1));

    this.textura = new THREE.CanvasTexture(zona.textura);
    this.textura.colorSpace = THREE.SRGBColorSpace;
    this.textura.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const material = new THREE.MeshStandardMaterial({
      map: this.textura,
      roughness: 0.75,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.zona3d.add(new THREE.Mesh(geometria, material));

    if (aplanado.corte.length) {
      // Línea de corte, separada 1 mm de la piel en la dirección de la normal.
      const puntos = Array.from(aplanado.corte, (v) => {
        const b = seleccion.verticeBase[v];
        const p = new THREE.Vector3().fromArray(malla.vertices, 3 * v);
        const normal = new THREE.Vector3(this.normalesCuerpo!.getX(b), this.normalesCuerpo!.getY(b), this.normalesCuerpo!.getZ(b));
        return p.addScaledVector(normal, 0.1);
      });
      this.zona3d.add(
        new THREE.Line(new THREE.BufferGeometry().setFromPoints(puntos), new THREE.LineBasicMaterial({ color: 0xe0483e })),
      );
    }
  }

  // ── Cámara ────────────────────────────────────────────────────────────────────

  private ajustarTamano(): void {
    const { clientWidth: ancho, clientHeight: alto } = this.element;
    if (ancho === 0 || alto === 0) return;
    this.renderer.setSize(ancho, alto, false);
    this.camara.aspect = ancho / alto;
    this.camara.updateProjectionMatrix();
  }

  /** Distancia de cámara para que quepa una esfera del radio indicado (cm). */
  private distanciaPara(radio: number): number {
    const vertical = THREE.MathUtils.degToRad(this.camara.fov);
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * this.camara.aspect);
    return (radio / Math.sin(Math.min(vertical, horizontal) / 2)) * 1.05;
  }
}

// ── Vistas predefinidas (RF-11) y zonas rápidas ──────────────────────────────────

interface Vista {
  nombre: string;
  encuadre(c: Cuerpo): { centro: P3; radio: number; direccion: P3 };
}

const medio = (eje: P3[]): P3 => {
  const a = eje[0], b = eje[eje.length - 1];
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
};

const VISTAS: Vista[] = [
  { nombre: "Cuerpo", encuadre: (c) => ({ centro: [0, c.altura / 2, 0], radio: c.altura / 2, direccion: [0, 0.1, 1] }) },
  { nombre: "Brazo izquierdo", encuadre: (c) => ({ centro: medio(ejeDelBrazo(c, "l")), radio: 28, direccion: [0.6, 0.5, 0.65] }) },
  { nombre: "Brazo derecho", encuadre: (c) => ({ centro: medio(ejeDelBrazo(c, "r")), radio: 28, direccion: [-0.6, 0.5, 0.65] }) },
  { nombre: "Brazo izquierdo · cara interna", encuadre: (c) => ({ centro: medio(ejeDelBrazo(c, "l")), radio: 26, direccion: [0.3, -0.9, 0.3] }) },
  { nombre: "Brazo derecho · cara interna", encuadre: (c) => ({ centro: medio(ejeDelBrazo(c, "r")), radio: 26, direccion: [-0.3, -0.9, 0.3] }) },
  { nombre: "Pierna izquierda", encuadre: (c) => ({ centro: medio(ejeDeLaPierna(c, "l")), radio: 48, direccion: [0.55, 0.1, 0.85] }) },
  { nombre: "Pierna derecha", encuadre: (c) => ({ centro: medio(ejeDeLaPierna(c, "r")), radio: 48, direccion: [-0.55, 0.1, 0.85] }) },
  { nombre: "Torso", encuadre: (c) => ({ centro: [0, c.altura * 0.7, 0], radio: 38, direccion: [0, 0.05, 1] }) },
  { nombre: "Espalda", encuadre: (c) => ({ centro: [0, c.altura * 0.7, 0], radio: 38, direccion: [0, 0.05, -1] }) },
];

interface ZonaRapida {
  nombre: string;
  vista: string;
  seleccionar(c: Cuerpo): Seleccion;
}

const manga = (lado: "l" | "r") => (c: Cuerpo) => {
  const eje = ejeDelBrazo(c, lado);
  return seleccionarPorEje(c, eje, 4, longitud(eje) - 2, 8);
};
const antebrazo = (lado: "l" | "r") => (c: Cuerpo) => {
  const eje = ejeDelBrazo(c, lado);
  return seleccionarPorEje(c, eje, longitud(eje.slice(0, 2)) + 3, longitud(eje) - 2, 7);
};
const pierna = (lado: "l" | "r") => (c: Cuerpo) => {
  const eje = ejeDeLaPierna(c, lado);
  return seleccionarPorEje(c, eje, 12, longitud(eje) - 4, 11);
};

const ZONAS_RAPIDAS: ZonaRapida[] = [
  { nombre: "Manga brazo izquierdo", vista: "Brazo izquierdo", seleccionar: manga("l") },
  { nombre: "Manga brazo derecho", vista: "Brazo derecho", seleccionar: manga("r") },
  { nombre: "Antebrazo izquierdo", vista: "Brazo izquierdo", seleccionar: antebrazo("l") },
  { nombre: "Antebrazo derecho", vista: "Brazo derecho", seleccionar: antebrazo("r") },
  { nombre: "Pierna izquierda", vista: "Pierna izquierda", seleccionar: pierna("l") },
  { nombre: "Pierna derecha", vista: "Pierna derecha", seleccionar: pierna("r") },
];

// ── Utilidades de interfaz ───────────────────────────────────────────────────────

function geometriaDe(vertices: Float64Array, caras: Int32Array): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(vertices), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(caras), 1));
  g.computeVertexNormals();
  return g;
}

function boton(texto: string, alPulsar: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "boton-texto";
  b.textContent = texto;
  b.addEventListener("click", alPulsar);
  return b;
}

/** Desplegable con un primer elemento que hace de título y vuelve a él tras elegir. */
function desplegable(titulo: string, opciones: string[], alElegir: (indice: number) => void): HTMLSelectElement {
  const s = document.createElement("select");
  s.className = "desplegable";
  s.append(new Option(titulo, ""), ...opciones.map((o, i) => new Option(o, String(i))));
  s.addEventListener("change", () => {
    if (s.value !== "") alElegir(Number(s.value));
    s.value = "";
  });
  return s;
}
