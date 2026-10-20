import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { IContentRenderer } from "dockview-core";

/**
 * Visor 3D provisional.
 * Muestra un brazo aproximado (geometría de revolución) hasta integrar el modelo de MakeHuman.
 * Las unidades de la escena son centímetros, igual que el modelo real.
 */
export class Visor3D implements IContentRenderer {
  readonly element: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private escena = new THREE.Scene();
  private camara = new THREE.PerspectiveCamera(35, 1, 1, 1000);
  private controles: OrbitControls;
  private observador: ResizeObserver;
  private activo = true;
  private encuadrado = false;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "panel";

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x22252a);
    this.element.appendChild(this.renderer.domElement);

    const etiqueta = document.createElement("div");
    etiqueta.className = "etiqueta-flotante";
    etiqueta.textContent = "Modelo provisional · arrastra para girar, rueda para acercar";
    this.element.appendChild(etiqueta);

    this.camara.position.set(0, 10, 110);
    this.controles = new OrbitControls(this.camara, this.renderer.domElement);
    this.controles.target.set(0, 0, 0);
    this.controles.enableDamping = true;

    this.montarEscena();

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
  }

  private montarEscena(): void {
    this.escena.add(new THREE.HemisphereLight(0xffffff, 0x3a3530, 1.6));
    const luz = new THREE.DirectionalLight(0xffffff, 1.4);
    luz.position.set(40, 60, 80);
    this.escena.add(luz);

    const piel = new THREE.MeshStandardMaterial({ color: 0xd8a98a, roughness: 0.75 });
    const brazo = new THREE.Mesh(crearBrazoProvisional(), piel);
    brazo.rotation.z = Math.PI / 2; // brazo extendido en horizontal (pose de referencia)
    this.escena.add(brazo);
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

/**
 * Perfil aproximado de un brazo adulto, de muñeca a hombro (radio y altura en cm).
 * Solo sirve para probar el visor; se sustituirá por la malla de MakeHuman.
 */
function crearBrazoProvisional(): THREE.BufferGeometry {
  const perfil: [number, number][] = [
    [0, -36],
    [2.6, -35],
    [2.9, -32], // muñeca
    [3.6, -24],
    [4.3, -14], // antebrazo
    [4.0, -6],
    [3.8, -2], // codo
    [4.3, 4],
    [4.9, 16], // bíceps
    [5.6, 28],
    [6.2, 34], // hombro
    [4.0, 38],
    [0, 39],
  ];
  const puntos = perfil.map(([r, y]) => new THREE.Vector2(r, y));
  const geometria = new THREE.LatheGeometry(puntos, 64);
  geometria.computeVertexNormals();
  return geometria;
}
