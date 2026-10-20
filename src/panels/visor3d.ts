import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { IContentRenderer } from "dockview-core";
import type { Malla } from "../geometria/aplanador";
import { brazoCompleto, mangaDePrueba, parcheDePrueba } from "../geometria/brazo-prueba";
import { aplanarEnSegundoPlano } from "../geometria/cliente";
import { medirDeformacion } from "../geometria/metricas";
import { activarZona, estado, ZonaActiva } from "../zona";

/**
 * Visor 3D del prototipo. Muestra un brazo de prueba en pose de referencia y, cuando
 * hay una zona aplanada, la cubre con la textura del lienzo y marca el corte en rojo.
 * Unidades de la escena: centímetros.
 */
export class Visor3D implements IContentRenderer {
  readonly element: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private escena = new THREE.Scene();
  private camara = new THREE.PerspectiveCamera(35, 1, 1, 1000);
  private controles: OrbitControls;
  private observador: ResizeObserver;
  private brazo = new THREE.Group();
  private zona3d = new THREE.Group();
  private textura: THREE.CanvasTexture | null = null;
  private estadoTexto: HTMLElement;
  private activo = true;
  private encuadrado = false;
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
    const manga = boton("Aplanar manga de prueba", () => this.aplanar("Manga aplanada", mangaDePrueba(-33, 32, 48, 36)));
    const parche = boton("Aplanar parche de prueba", () => this.aplanar("Parche aplanado", parcheDePrueba(64, 48)));
    this.estadoTexto = document.createElement("span");
    this.estadoTexto.className = "estado";
    barra.append(manga, parche, this.estadoTexto);
    this.element.appendChild(barra);

    const etiqueta = document.createElement("div");
    etiqueta.className = "etiqueta-flotante";
    etiqueta.textContent = "Brazo de prueba · arrastra para girar, rueda para acercar";
    this.element.appendChild(etiqueta);

    this.camara.position.set(0, 10, 110);
    this.controles = new OrbitControls(this.camara, this.renderer.domElement);
    this.controles.enableDamping = true;

    this.montarEscena();
    document.addEventListener("dermap:zona", this.alCambiarZona);
    document.addEventListener("dermap:textura", this.alCambiarTextura);

    this.observador = new ResizeObserver(() => this.ajustarTamano());
    this.observador.observe(this.element);

    this.renderer.setAnimationLoop(() => {
      if (!this.activo) return;
      this.controles.update();
      this.renderer.render(this.escena, this.camara);
    });
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

  private async aplanar(rotulo: string, malla: Malla): Promise<void> {
    this.estadoTexto.textContent = "Aplanando…";
    try {
      // El brazo se muestra girado 90°: la dirección 3D que queda a la derecha en pantalla es −y.
      const { aplanado, milisegundos } = await aplanarEnSegundoPlano(malla, {}, [0, -1, 0]);
      const deformacion = medirDeformacion(malla, aplanado);
      activarZona(new ZonaActiva(malla, aplanado, deformacion.porCara));
      this.estadoTexto.textContent =
        `${rotulo} en ${(milisegundos / 1000).toFixed(2)} s · ` +
        `${deformacion.areaDentroDel2.toFixed(0)} % del área con deformación ≤ 2 %`;
    } catch (error) {
      this.estadoTexto.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  private montarEscena(): void {
    this.escena.add(new THREE.HemisphereLight(0xffffff, 0x3a3530, 1.6));
    const luz = new THREE.DirectionalLight(0xffffff, 1.4);
    luz.position.set(40, 60, 80);
    this.escena.add(luz);

    const piel = new THREE.MeshStandardMaterial({ color: 0xd8a98a, roughness: 0.75 });
    this.brazo.add(new THREE.Mesh(geometriaDe(brazoCompleto()), piel));
    this.brazo.add(this.zona3d);
    this.brazo.rotation.z = Math.PI / 2; // brazo extendido en horizontal (pose de referencia)
    this.escena.add(this.brazo);
  }

  private mostrarZona(): void {
    for (const hijo of [...this.zona3d.children]) {
      this.zona3d.remove(hijo);
      if (hijo instanceof THREE.Mesh || hijo instanceof THREE.Line) hijo.geometry.dispose();
    }
    this.textura?.dispose();
    const zona = estado.zona;
    if (!zona) return;

    const { malla, aplanado } = zona;
    // Normales calculadas en la malla sin cortar, para que la costura no se vea sombreada.
    const original = geometriaDe(malla);
    const normalesOriginales = original.getAttribute("normal");
    const n = aplanado.origen.length;
    const posiciones = new Float32Array(n * 3);
    const normales = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const o = aplanado.origen[i];
      posiciones.set([malla.vertices[3 * o], malla.vertices[3 * o + 1], malla.vertices[3 * o + 2]], 3 * i);
      normales.set([normalesOriginales.getX(o), normalesOriginales.getY(o), normalesOriginales.getZ(o)], 3 * i);
    }
    original.dispose();
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
      // Se dibuja por encima del brazo base, que ocupa la misma superficie.
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.zona3d.add(new THREE.Mesh(geometria, material));

    if (aplanado.corte.length) {
      // Línea de corte, ligeramente separada de la piel para que se vea.
      const puntos = Array.from(aplanado.corte, (v) => {
        const p = new THREE.Vector3(malla.vertices[3 * v], malla.vertices[3 * v + 1], malla.vertices[3 * v + 2]);
        const radial = new THREE.Vector3(p.x, 0, p.z).normalize().multiplyScalar(0.08);
        return p.add(radial);
      });
      const linea = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(puntos),
        new THREE.LineBasicMaterial({ color: 0xe0483e }),
      );
      this.zona3d.add(linea);
    }
  }

  private ajustarTamano(): void {
    const { clientWidth: ancho, clientHeight: alto } = this.element;
    if (ancho === 0 || alto === 0) return;
    this.renderer.setSize(ancho, alto, false);
    this.camara.aspect = ancho / alto;
    this.camara.updateProjectionMatrix();
    if (!this.encuadrado) {
      this.encuadrar(40);
      this.encuadrado = true;
    }
  }

  /** Aleja la cámara lo justo para que quepa una esfera del radio indicado (cm). */
  private encuadrar(radio: number): void {
    const vertical = THREE.MathUtils.degToRad(this.camara.fov);
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * this.camara.aspect);
    const distancia = (radio / Math.sin(Math.min(vertical, horizontal) / 2)) * 1.05;
    const direccion = this.camara.position.clone().sub(this.controles.target).normalize();
    this.camara.position.copy(this.controles.target).addScaledVector(direccion, distancia);
  }
}

function geometriaDe(malla: Malla): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(malla.vertices), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(malla.caras), 1));
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
