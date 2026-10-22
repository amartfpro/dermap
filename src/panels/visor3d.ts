import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { IContentRenderer } from "dockview-core";
import { aplanarEnSegundoPlano } from "../geometria/cliente";
import { corteExtraHasta, corteSugerido, verticeMasCercano } from "../geometria/corte";
import { medirDeformacion } from "../geometria/metricas";
import { longitud, seleccionarPorEje, submalla, suavizarSeleccion, type Seleccion } from "../geometria/seleccion";
import { cargarCuerpo, ejeDeLaPierna, ejeDelBrazo, type Cuerpo } from "../modelos/cuerpo";
import { aplicarComplexion, cargarFormas, COMPLEXION_INICIAL, type Complexion, type Formas } from "../modelos/formas";
import type { ProyectoAbierto } from "../proyectos/proyecto";
import { PanelCuerpo } from "./cuerpo";
import { app } from "../estado";
import { añadirLienzo } from "../proyectos/gestor";
import { guardarExportacion } from "../exportar/guardar";
import { nuevoId } from "../lienzo/capa";
import { Lienzo } from "../lienzo/lienzo";
import { contexto, crearLamina, RegionSucia, type Rect } from "../lienzo/teselas";

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

  /** Malla base de MakeHuman sin deformar y sus formas (complexión, RF-12). */
  private base: Cuerpo | null = null;
  private formas: Formas | null = null;
  /** Cuerpo con la complexión del proyecto: el que se ve y sobre el que se selecciona. */
  private cuerpo: Cuerpo | null = null;
  private proyectoSuscrito: ProyectoAbierto | null = null;
  private cuerpoPendiente = false;
  private panelCuerpo!: PanelCuerpo;
  private alCambiarProyecto = () => this.suscribirProyecto();
  private barraPresentacion: HTMLElement;
  private presentando = false;
  private botonGirar!: HTMLButtonElement;
  private visiblesAntes: { objeto: THREE.Object3D; visible: boolean }[] = [];
  private alTeclaPresentacion = (e: KeyboardEvent) => {
    if (e.key === "Escape") this.presentar(false);
  };
  private alCambiarModelo = () => this.programarCuerpo();
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
  /** Submalla de la selección actual (se invalida al cambiar la selección). */
  private seleccionCacheada: Seleccion | null = null;
  /** Corte que se usará al aplanar una manga, visible antes de aplanar (RF-23). */
  /** Tubo rojo visible y, encima, el mismo semitransparente que se ve a través del cuerpo. */
  private previaCorte = new THREE.Group();
  private corteProgramado = false;
  /** Cortes extra (RF-25) sobre la selección actual, en vértices de su submalla. */
  private cortesExtra: number[][] = [];
  private modoCorte = false;
  private botonCorte!: HTMLButtonElement;
  private grupoCortesExtra = new THREE.Group();
  private pintando: "añadir" | "quitar" | null = null;
  private raycaster = new THREE.Raycaster();

  private zonas3d = new THREE.Group();
  private mallas = new Map<Lienzo, MallaLienzo>();
  private alCambiarLienzos = () => this.reconstruirLienzos();
  private alCambiarActivo = () => this.resaltarActivo();

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
      (this.botonCorte = titulo(
        boton("Corte extra", () => this.alternarModoCorte()),
        "Haz clic en la zona para abrir un corte desde el borde hasta ese punto (como una pinza): reduce la deformación en zonas muy curvas",
      )),
      titulo(boton("Quitar cortes", () => this.quitarCortesExtra()), "Quitar los cortes extra"),
      boton("Aplanar zona", () => void this.aplanar()),
      titulo(boton("Imagen 3D…", () => void this.exportarImagen()), "Guardar la vista actual en PNG para enseñarla al cliente"),
      titulo(boton("Cuerpo…", () => this.panelCuerpo.alternar()), "Altura, complexión y tono de piel del cliente"),
    );
    this.panelCuerpo = new PanelCuerpo();
    this.barraPresentacion = this.montarBarraPresentacion();
    this.element.append(barra, this.estadoTexto, this.panelCuerpo.element, this.barraPresentacion);

    this.controles = new OrbitControls(this.camara, this.renderer.domElement);
    this.controles.enableDamping = true;
    // El corte por defecto va por la cara que no se ve: al girar la vista, se recalcula.
    this.controles.addEventListener("change", () => this.programarCorte());
    // Si el tatuador mueve la cámara durante la presentación, se para el giro automático.
    this.controles.addEventListener("start", () => {
      if (this.controles.autoRotate) this.alternarGiro(false);
    });

    this.montarEscena();
    app.addEventListener("lienzos", this.alCambiarLienzos);
    app.addEventListener("activo", this.alCambiarActivo);
    app.addEventListener("proyecto", this.alCambiarProyecto);

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
      this.subirTexturas();
      this.renderer.render(this.escena, this.camara);
    });

    visores.push(this);
    void this.cargar();
  }

  init(): void {}

  onShow(): void {
    this.activo = true;
  }

  onHide(): void {
    if (this.presentando) return;
    this.activo = false;
  }

  // ── Modo presentación (RF-46) ───────────────────────────────────────────────

  private montarBarraPresentacion(): HTMLElement {
    const barra = document.createElement("div");
    barra.className = "barra-presentacion";
    const vista = (nombre: string, direccion: P3) =>
      boton(nombre, () => {
        if (!this.cuerpo) return;
        this.alternarGiro(false);
        this.encuadrar([0, this.cuerpo.altura / 2, 0], this.cuerpo.altura / 2, direccion);
      });
    this.botonGirar = boton("Girar", () => this.alternarGiro(!this.controles.autoRotate));
    barra.append(
      vista("Frente", [0, 0.1, 1]),
      vista("Espalda", [0, 0.1, -1]),
      vista("Izquierda", [1, 0.1, 0.05]),
      vista("Derecha", [-1, 0.1, 0.05]),
      this.botonGirar,
      titulo(boton("Imagen…", () => void this.exportarImagen()), "Guardar esta vista en PNG"),
      titulo(boton("Salir", () => this.presentar(false)), "Salir de la presentación (Esc)"),
    );
    return barra;
  }

  private alternarGiro(activo: boolean): void {
    this.controles.autoRotate = activo;
    this.controles.autoRotateSpeed = 1.2;
    this.botonGirar.classList.toggle("activo", activo);
  }

  /**
   * Presentación para el cliente: el cuerpo con todos los lienzos visibles a pantalla
   * completa, sin herramientas ni marcas de edición, girando despacio.
   */
  presentar(activar = !this.presentando): void {
    if (activar === this.presentando) return;
    this.presentando = activar;
    this.element.classList.toggle("presentando", activar);
    if (activar) {
      const ocultar = [this.resaltado, this.previaCorte, this.grupoCortesExtra, ...[...this.mallas.values()].map((m) => m.resalte)];
      this.visiblesAntes = ocultar.map((objeto) => ({ objeto, visible: objeto.visible }));
      for (const o of ocultar) o.visible = false;
      if (this.modoSeleccion) this.alternarSeleccion();
      if (this.modoCorte) this.alternarModoCorte();
      this.activo = true;
      if (this.cuerpo) this.encuadrar([0, this.cuerpo.altura / 2, 0], this.cuerpo.altura / 2, [0, 0.1, 1]);
      this.alternarGiro(true);
      window.addEventListener("keydown", this.alTeclaPresentacion);
      void document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      for (const { objeto, visible } of this.visiblesAntes) objeto.visible = visible;
      this.resaltarActivo();
      this.alternarGiro(false);
      window.removeEventListener("keydown", this.alTeclaPresentacion);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    }
    this.ajustarTamano();
  }

  private encuadrar(centro: P3, radio: number, direccion: P3): void {
    this.controles.target.set(...centro);
    const dir = new THREE.Vector3(...direccion).normalize();
    this.camara.position.copy(this.controles.target).addScaledVector(dir, this.distanciaPara(radio));
    this.controles.update();
  }

  dispose(): void {
    if (this.presentando) this.presentar(false);
    visores.splice(visores.indexOf(this), 1);
    this.renderer.setAnimationLoop(null);
    this.observador.disconnect();
    this.controles.dispose();
    this.renderer.dispose();
    app.removeEventListener("lienzos", this.alCambiarLienzos);
    app.removeEventListener("activo", this.alCambiarActivo);
    app.removeEventListener("proyecto", this.alCambiarProyecto);
    this.proyectoSuscrito?.removeEventListener("modelo", this.alCambiarModelo);
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
    this.escena.add(this.zonas3d);
    // Su geometría cambia con cada pincelada: sin recorte por frustum para no recalcular límites.
    this.resaltado.frustumCulled = false;
    this.resaltado.visible = false;
    this.escena.add(this.resaltado);
    const solido = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xe0483e }));
    const traslucido = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: 0xe0483e, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false }),
    );
    traslucido.renderOrder = 10;
    this.previaCorte.add(solido, traslucido);
    this.previaCorte.visible = false;
    this.escena.add(this.previaCorte);
    this.escena.add(this.grupoCortesExtra);
  }

  private async cargar(): Promise<void> {
    try {
      this.base = await cargarCuerpo();
    } catch (error) {
      this.estadoTexto.textContent = `No se pudo cargar el cuerpo: ${String(error)}`;
      return;
    }
    try {
      this.formas = await cargarFormas();
    } catch (error) {
      console.error("No se pudieron cargar las formas del cuerpo", error);
    }
    this.cuerpo = this.cuerpoDelProyecto();
    const geometria = geometriaDe(this.cuerpo.vertices, this.cuerpo.caras);
    this.normalesCuerpo = geometria.getAttribute("normal") as THREE.BufferAttribute;
    this.mallaCuerpo = new THREE.Mesh(
      geometria,
      new THREE.MeshStandardMaterial({ color: app.proyecto?.datos.modelo.tonoPiel ?? 0xd8a98a, roughness: 0.75 }),
    );
    this.escena.add(this.mallaCuerpo);
    this.resaltado.geometry.setAttribute("position", geometria.getAttribute("position"));
    // Sin índices dibujaría todos los vértices del cuerpo como triángulos sueltos.
    this.resaltado.geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(0), 1));
    this.resaltado.visible = false;
    this.precalcularCaras();
    this.verVista(0);
    app.fijarCuerpo(this.cuerpo);
    this.suscribirProyecto();
    this.reconstruirLienzos();
    this.estadoTexto.textContent =
      "Elige una zona rápida o pinta una con «Seleccionar» · arrastra para girar, rueda para acercar";
  }

  /** Complexión guardada en el proyecto abierto (o la inicial si no hay proyecto). */
  private complexionDelProyecto(): Complexion {
    const m = app.proyecto?.datos.modelo;
    if (!m) return { ...COMPLEXION_INICIAL };
    return {
      sexo: m.sexo ?? COMPLEXION_INICIAL.sexo,
      musculatura: m.musculatura ?? COMPLEXION_INICIAL.musculatura,
      peso: m.complexion ?? COMPLEXION_INICIAL.peso,
      altura: m.altura || COMPLEXION_INICIAL.altura,
    };
  }

  private cuerpoDelProyecto(): Cuerpo {
    return this.formas ? aplicarComplexion(this.base!, this.formas, this.complexionDelProyecto()) : this.base!;
  }

  private suscribirProyecto(): void {
    this.panelCuerpo.sincronizar();
    if (this.proyectoSuscrito === app.proyecto) return;
    this.proyectoSuscrito?.removeEventListener("modelo", this.alCambiarModelo);
    this.proyectoSuscrito = app.proyecto;
    this.proyectoSuscrito?.addEventListener("modelo", this.alCambiarModelo);
    this.programarCuerpo();
  }

  /** Aplica el cuerpo del proyecto como mucho una vez por fotograma (los deslizadores lo cambian en vivo). */
  private programarCuerpo(): void {
    if (this.cuerpoPendiente || !this.base) return;
    this.cuerpoPendiente = true;
    requestAnimationFrame(() => {
      this.cuerpoPendiente = false;
      this.actualizarCuerpo();
    });
  }

  /**
   * Cambia la forma del cuerpo sin cambiar su topología: la selección (triángulos) se
   * conserva y los lienzos se recolocan sobre la nueva forma.
   */
  private actualizarCuerpo(): void {
    if (!this.base || !this.mallaCuerpo) return;
    const material = this.mallaCuerpo.material as THREE.MeshStandardMaterial;
    material.color.set(app.proyecto?.datos.modelo.tonoPiel ?? 0xd8a98a);
    this.cuerpo = this.cuerpoDelProyecto();
    const geometria = this.mallaCuerpo.geometry;
    const posicion = geometria.getAttribute("position") as THREE.BufferAttribute;
    (posicion.array as Float32Array).set(this.cuerpo.vertices);
    posicion.needsUpdate = true;
    geometria.computeVertexNormals();
    geometria.computeBoundingSphere();
    geometria.computeBoundingBox();
    this.normalesCuerpo = geometria.getAttribute("normal") as THREE.BufferAttribute;
    this.precalcularCaras();
    this.actualizarResaltado();
    for (const [lienzo, m] of this.mallas) this.recolocarLienzo(lienzo, m);
    app.fijarCuerpo(this.cuerpo);
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
    this.encuadrar(centro, radio, direccion);
  }

  private zonaRapida(indice: number): void {
    if (!this.cuerpo) return;
    const zona = ZONAS_RAPIDAS[indice];
    const seleccion = zona.seleccionar(this.cuerpo);
    this.fijarSeleccion(seleccion.triangulos);
    this.verVista(VISTAS.findIndex((v) => v.nombre === zona.vista));
    this.estadoTexto.textContent =
      `${zona.nombre}: ${seleccion.triangulos.length} triángulos. La línea roja es el corte: gira la vista para moverlo. Pulsa «Aplanar zona».`;
  }

  // ── Selección a pincel ────────────────────────────────────────────────────────

  private alternarModoCorte(): void {
    this.modoCorte = !this.modoCorte;
    if (this.modoCorte && this.modoSeleccion) this.alternarSeleccion();
    this.botonCorte.classList.toggle("activo", this.modoCorte);
    this.renderer.domElement.style.cursor = this.modoCorte ? "crosshair" : "";
    if (this.modoCorte) this.estadoTexto.textContent = "Haz clic en la zona seleccionada donde debe terminar el corte extra.";
  }

  private añadirCorteExtra(e: PointerEvent): void {
    const seleccion = this.seleccionActual();
    const golpe = this.lanzarRayo(e);
    if (!seleccion || !golpe) return;
    const objetivo = verticeMasCercano(seleccion.malla, golpe.point.toArray() as P3);
    const camino = corteExtraHasta(seleccion.malla, objetivo);
    if (camino.length < 2) {
      this.estadoTexto.textContent = "Ese punto está en el borde: elige uno dentro de la zona.";
      return;
    }
    this.cortesExtra.push(camino);
    this.pintarCortesExtra();
    this.estadoTexto.textContent = `${this.cortesExtra.length} ${this.cortesExtra.length === 1 ? "corte extra" : "cortes extra"}. Pulsa «Aplanar zona» o añade más.`;
  }

  private quitarCortesExtra(): void {
    this.cortesExtra = [];
    this.pintarCortesExtra();
  }

  private pintarCortesExtra(): void {
    for (const hijo of [...this.grupoCortesExtra.children] as THREE.Mesh[]) {
      this.grupoCortesExtra.remove(hijo);
      hijo.geometry.dispose();
    }
    const seleccion = this.seleccionActual();
    if (!seleccion || !this.normalesCuerpo) return;
    const n = this.normalesCuerpo;
    for (const camino of this.cortesExtra) {
      const puntos = camino.map((i) => {
        const b = seleccion.verticeBase[i];
        return new THREE.Vector3().fromArray(seleccion.malla.vertices, 3 * i).add(new THREE.Vector3(n.getX(b), n.getY(b), n.getZ(b)).multiplyScalar(0.15));
      });
      const geometria = tubo(puntos, 0.15);
      this.grupoCortesExtra.add(
        new THREE.Mesh(geometria, new THREE.MeshBasicMaterial({ color: 0xf0a020 })),
        Object.assign(new THREE.Mesh(geometria, new THREE.MeshBasicMaterial({ color: 0xf0a020, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false })), { renderOrder: 10 }),
      );
    }
  }

  private alternarSeleccion(): void {
    if (!this.modoSeleccion && this.modoCorte) this.alternarModoCorte();
    this.modoSeleccion = !this.modoSeleccion;
    this.botonSeleccionar.classList.toggle("activo", this.modoSeleccion);
    // En modo selección el botón izquierdo pinta; la cámara gira con el derecho.
    this.controles.mouseButtons.LEFT = this.modoSeleccion ? null : THREE.MOUSE.ROTATE;
    this.controles.mouseButtons.RIGHT = this.modoSeleccion ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
    this.renderer.domElement.style.cursor = this.modoSeleccion ? "crosshair" : "";
  }

  private empezarPincel(e: PointerEvent): void {
    if (this.modoCorte && e.button === 0) {
      this.añadirCorteExtra(e);
      return;
    }
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

  private seleccionActual(): Seleccion | null {
    if (!this.cuerpo || this.seleccionados.size < 8) return null;
    this.seleccionCacheada ??= submalla(this.cuerpo, this.seleccionados);
    return this.seleccionCacheada;
  }

  private haciaCamara(): P3 {
    return this.camara.position.clone().sub(this.controles.target).normalize().toArray() as P3;
  }

  /** Recalcula la vista previa del corte como mucho cada 150 ms. */
  private programarCorte(): void {
    if (this.corteProgramado) return;
    this.corteProgramado = true;
    setTimeout(() => {
      this.corteProgramado = false;
      this.actualizarCorte();
    }, 150);
  }

  private actualizarCorte(): void {
    const seleccion = this.pintando ? null : this.seleccionActual();
    const corte = seleccion && corteSugerido(seleccion.malla, this.haciaCamara());
    this.previaCorte.visible = !!corte;
    if (!seleccion || !corte || !this.normalesCuerpo) return;
    const n = this.normalesCuerpo;
    const puntos = corte.camino.map((i) => {
      const b = seleccion.verticeBase[i];
      return new THREE.Vector3()
        .fromArray(seleccion.malla.vertices, 3 * i)
        .add(new THREE.Vector3(n.getX(b), n.getY(b), n.getZ(b)).multiplyScalar(0.15));
    });
    const geometria = tubo(puntos, 0.15);
    for (const m of this.previaCorte.children as THREE.Mesh[]) {
      if (m.geometry !== geometria) m.geometry.dispose();
      m.geometry = geometria;
    }
  }

  private actualizarResaltado(): void {
    if (!this.cuerpo) return;
    this.seleccionCacheada = null;
    if (this.cortesExtra.length) this.quitarCortesExtra();
    this.programarCorte();
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

  // ── Aplanado: cada zona aplanada es un lienzo nuevo (RF-29) ─────────────────

  private async aplanar(): Promise<void> {
    if (!this.cuerpo) return;
    if (this.seleccionados.size < 8) {
      this.estadoTexto.textContent = "Selecciona primero una zona.";
      return;
    }
    const seleccion = this.seleccionActual()!;
    this.estadoTexto.textContent = "Aplanando…";
    // El corte por defecto queda en la cara que no se ve (opuesta a la cámara), y el
    // lienzo se orienta como la vista actual: la derecha de la pantalla es la del lienzo.
    const haciaCamara = this.camara.position.clone().sub(this.controles.target).normalize();
    const derecha = new THREE.Vector3().setFromMatrixColumn(this.camara.matrixWorld, 0).normalize();
    try {
      // Se aplana con el mismo corte que se está mostrando.
      const corte = corteSugerido(seleccion.malla, haciaCamara.toArray() as P3);
      const { aplanado, milisegundos } = await aplanarEnSegundoPlano(
        seleccion.malla,
        { direccionExterna: haciaCamara.toArray() as P3, extremos: corte?.extremos, cortesExtra: this.cortesExtra },
        derecha.toArray() as P3,
        haciaCamara.toArray() as P3,
      );
      const deformacion = medirDeformacion(seleccion.malla, aplanado);
      const lienzo = new Lienzo(nuevoId(), nombreLibre(), {
        malla: seleccion.malla,
        aplanado,
        errorPorCara: deformacion.porCara,
        triangulos: seleccion.triangulos,
        verticeBase: seleccion.verticeBase,
      });
      if (app.proyecto) lienzo.tonoPiel = app.proyecto.datos.modelo.tonoPiel;
      this.fijarSeleccion([]);
      await añadirLienzo(lienzo);
      const tipo = aplanado.tipo === "manga" ? "Manga aplanada (con corte)" : "Parche aplanado";
      const [w, h] = lienzo.geo.tamanoCm;
      this.estadoTexto.textContent =
        `${tipo} en ${(milisegundos / 1000).toFixed(2)} s · ${w.toFixed(1)} × ${h.toFixed(1)} cm · ` +
        `${deformacion.areaDentroDel2.toFixed(0)} % del área con deformación ≤ 2 %`;
    } catch (error) {
      this.estadoTexto.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  // ── Lienzos en el 3D (RF-43): todos los visibles, el activo resaltado ─────────

  private reconstruirLienzos(): void {
    for (const [lienzo, m] of this.mallas) {
      if (!app.lienzos.includes(lienzo) || !lienzo.visible) {
        m.desconectar();
        this.zonas3d.remove(m.grupo);
        m.grupo.traverse((o) => {
          if (o instanceof THREE.Mesh || o instanceof THREE.Line) o.geometry.dispose();
        });
        m.textura.dispose();
        this.mallas.delete(lienzo);
      }
    }
    if (!this.normalesCuerpo) return;
    app.lienzos.forEach((lienzo, orden) => {
      if (!lienzo.visible) return;
      let m = this.mallas.get(lienzo);
      if (!m) {
        m = this.crearMallaLienzo(lienzo);
        this.mallas.set(lienzo, m);
        this.zonas3d.add(m.grupo);
      }
      // Los lienzos posteriores en el árbol se dibujan encima (RF-06).
      const malla = m.grupo.children[0] as THREE.Mesh;
      const material = malla.material as THREE.MeshStandardMaterial;
      material.polygonOffsetFactor = -2 - orden;
      material.polygonOffsetUnits = -2 - orden;
      malla.renderOrder = orden;
    });
    this.resaltarActivo();
  }

  /**
   * Posiciones y normales de la zona de un lienzo sobre el cuerpo actual: se toman del
   * vértice del cuerpo (verticeBase), así el lienzo sigue al cuerpo al cambiar la complexión.
   */
  private posicionesLienzo(lienzo: Lienzo): { posiciones: Float32Array; normales: Float32Array } {
    const { aplanado, verticeBase } = lienzo.zona;
    const cuerpo = this.cuerpo!.vertices;
    const normalesCuerpo = this.normalesCuerpo!;
    const n = aplanado.origen.length;
    const posiciones = new Float32Array(n * 3);
    const normales = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const b = verticeBase[aplanado.origen[i]];
      posiciones.set([cuerpo[3 * b], cuerpo[3 * b + 1], cuerpo[3 * b + 2]], 3 * i);
      // Normales del cuerpo completo: la zona se sombrea igual que la piel que la rodea.
      normales.set([normalesCuerpo.getX(b), normalesCuerpo.getY(b), normalesCuerpo.getZ(b)], 3 * i);
    }
    return { posiciones, normales };
  }

  private recolocarLienzo(lienzo: Lienzo, m: MallaLienzo): void {
    const geometria = (m.grupo.children[0] as THREE.Mesh).geometry;
    const { posiciones, normales } = this.posicionesLienzo(lienzo);
    geometria.setAttribute("position", new THREE.BufferAttribute(posiciones, 3));
    geometria.setAttribute("normal", new THREE.BufferAttribute(normales, 3));
    geometria.computeBoundingSphere();
    for (const hijo of [...m.resalte.children]) {
      m.resalte.remove(hijo);
      if (hijo instanceof THREE.Mesh || hijo instanceof THREE.Line) hijo.geometry.dispose();
    }
    this.construirResalte(lienzo, m.resalte);
  }

  /** Borde de la zona (naranja) y cortes (rojo), visibles solo en el lienzo activo. */
  private construirResalte(lienzo: Lienzo, resalte: THREE.Group): void {
    const { aplanado, verticeBase } = lienzo.zona;
    const cuerpo = this.cuerpo!.vertices;
    const normalesCuerpo = this.normalesCuerpo!;
    const punto = (i: number, separacion: number) => {
      const b = verticeBase[aplanado.origen[i]];
      const p = new THREE.Vector3().fromArray(cuerpo, 3 * b);
      return p.addScaledVector(new THREE.Vector3(normalesCuerpo.getX(b), normalesCuerpo.getY(b), normalesCuerpo.getZ(b)), separacion);
    };
    for (const borde of lienzo.geo.bordesIndices) {
      const linea = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(borde.map((i) => punto(i, 0.08))),
        new THREE.LineBasicMaterial({ color: 0xd9774b }),
      );
      resalte.add(linea);
    }
    if (aplanado.corte.length) {
      // Los cortes se dan en vértices de la malla de la zona (separados por -1); se busca un
      // vértice cortado de cada uno.
      const cortado = new Map<number, number>();
      aplanado.origen.forEach((o, i) => cortado.set(o, i));
      let tramo: THREE.Vector3[] = [];
      const cerrarTramo = () => {
        if (tramo.length > 1) resalte.add(new THREE.Mesh(tubo(tramo, 0.12), new THREE.MeshBasicMaterial({ color: 0xe0483e })));
        tramo = [];
      };
      for (const v of aplanado.corte) {
        if (v < 0) cerrarTramo();
        else tramo.push(punto(cortado.get(v)!, 0.12));
      }
      cerrarTramo();
    }
  }

  private crearMallaLienzo(lienzo: Lienzo): MallaLienzo {
    const { posiciones, normales } = this.posicionesLienzo(lienzo);
    const { aplanado } = lienzo.zona;
    const geometria = new THREE.BufferGeometry();
    geometria.setAttribute("position", new THREE.BufferAttribute(posiciones, 3));
    geometria.setAttribute("normal", new THREE.BufferAttribute(normales, 3));
    geometria.setAttribute("uv", new THREE.BufferAttribute(lienzo.geo.coordenadasDeTextura(), 2));
    geometria.setIndex(new THREE.BufferAttribute(new Uint32Array(aplanado.caras), 1));

    // flipY = false: las filas del lienzo y de la textura coinciden, lo que permite subir
    // solo la región que cambia en cada trazo (copyTextureToTexture) en vez de la textura entera.
    const textura = new THREE.Texture(lienzo.textura as unknown as HTMLCanvasElement);
    textura.flipY = false;
    textura.colorSpace = THREE.SRGBColorSpace;
    textura.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    textura.needsUpdate = true;
    this.renderer.initTexture(textura);

    const material = new THREE.MeshStandardMaterial({ map: textura, roughness: 0.75, polygonOffset: true });
    const grupo = new THREE.Group();
    grupo.add(new THREE.Mesh(geometria, material));
    const resalte = new THREE.Group();
    this.construirResalte(lienzo, resalte);
    grupo.add(resalte);

    const m: MallaLienzo = { grupo, textura, resalte, pendiente: new RegionSucia(), desconectar: () => {} };
    const alPrevia = (e: Event) => m.pendiente.añadir((e as CustomEvent<Rect>).detail);
    const alPropiedades = () => this.reconstruirLienzos();
    lienzo.addEventListener("previa", alPrevia);
    lienzo.addEventListener("propiedades", alPropiedades);
    m.desconectar = () => {
      lienzo.removeEventListener("previa", alPrevia);
      lienzo.removeEventListener("propiedades", alPropiedades);
    };
    return m;
  }

  private resaltarActivo(): void {
    for (const [lienzo, m] of this.mallas) m.resalte.visible = lienzo === app.activo && !this.presentando;
  }

  /** Sube a la GPU solo las regiones de textura que han cambiado (P3). */
  private subirTexturas(): void {
    for (const [lienzo, m] of this.mallas) {
      if (m.pendiente.vacia) continue;
      for (const r of m.pendiente.vaciar()) this.subirRegion(lienzo, m, r);
    }
  }

  private subirRegion(lienzo: Lienzo, m: MallaLienzo, r: Rect): void {
    {
      const ancho = r.x1 - r.x0;
      const alto = r.y1 - r.y0;
      if (ancho <= 0 || alto <= 0) return;
      if (ancho * alto > 0.5 * lienzo.geo.anchoPrevia * lienzo.geo.altoPrevia) {
        m.textura.needsUpdate = true; // más de media textura: se sube entera
        return;
      }
      const trozo = crearLamina(ancho, alto);
      contexto(trozo).drawImage(lienzo.textura, r.x0, r.y0, ancho, alto, 0, 0, ancho, alto);
      const fuente = new THREE.Texture(trozo as unknown as HTMLCanvasElement);
      try {
        this.renderer.copyTextureToTexture(fuente, m.textura, null, new THREE.Vector2(r.x0, r.y0));
      } catch {
        m.textura.needsUpdate = true;
      }
    }
  }

  // ── Imagen para el cliente (RF-52) ──────────────────────────────────────────

  /** Guarda la vista actual a doble resolución, sin selección ni bordes de edición. */
  private async exportarImagen(): Promise<void> {
    const resaltes = [...this.mallas.values()].map((m) => m.resalte.visible);
    const resaltado = this.resaltado.visible;
    for (const m of this.mallas.values()) m.resalte.visible = false;
    this.resaltado.visible = false;
    const proporcion = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(Math.max(2, proporcion * 2));
    const { clientWidth: ancho, clientHeight: alto } = this.element;
    this.renderer.setSize(ancho, alto, false);
    this.renderer.render(this.escena, this.camara);
    // Hay que leer el canvas en el mismo instante del render (el búfer no se conserva).
    const url = this.renderer.domElement.toDataURL("image/png");
    this.renderer.setPixelRatio(proporcion);
    this.renderer.setSize(ancho, alto, false);
    [...this.mallas.values()].forEach((m, i) => (m.resalte.visible = resaltes[i]));
    this.resaltado.visible = resaltado;
    const bytes = Uint8Array.from(atob(url.split(",")[1]), (c) => c.charCodeAt(0));
    const nombre = `${app.proyecto?.nombre ?? "Dermap"} - vista 3D`;
    const ruta = await guardarExportacion(bytes, nombre, { descripcion: "Imagen PNG", extension: "png", mime: "image/png" });
    if (ruta) this.estadoTexto.textContent = `Imagen guardada: ${ruta}`;
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

const visores: Visor3D[] = [];

/** Visor 3D abierto (para el botón «Presentar» de la barra superior). */
export function visorActual(): Visor3D | null {
  return visores[visores.length - 1] ?? null;
}

interface MallaLienzo {
  grupo: THREE.Group;
  textura: THREE.Texture;
  resalte: THREE.Group;
  /** Regiones de la textura (px de la vista previa) pendientes de subir a la GPU. */
  pendiente: RegionSucia;
  desconectar: () => void;
}

function nombreLibre(): string {
  let n = app.lienzos.length + 1;
  while (app.lienzos.some((l) => l.nombre === `Lienzo ${n}`)) n++;
  return `Lienzo ${n}`;
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

/** Los radios de las zonas rápidas crecen con la complexión (un brazo robusto es más grueso). */
const grosor = (c: Cuerpo) => {
  const x = c.complexion ?? COMPLEXION_INICIAL;
  return (c.altura / 170) * (1 + 0.5 * (x.peso - 0.5) + 0.25 * (x.musculatura - 0.5));
};
const manga = (lado: "l" | "r") => (c: Cuerpo) => {
  const eje = ejeDelBrazo(c, lado);
  return seleccionarPorEje(c, eje, 4, longitud(eje) - 2, 8 * grosor(c));
};
const antebrazo = (lado: "l" | "r") => (c: Cuerpo) => {
  const eje = ejeDelBrazo(c, lado);
  return seleccionarPorEje(c, eje, longitud(eje.slice(0, 2)) + 3, longitud(eje) - 2, 7 * grosor(c));
};
const pierna = (lado: "l" | "r") => (c: Cuerpo) => {
  const eje = ejeDeLaPierna(c, lado);
  return seleccionarPorEje(c, eje, 12, longitud(eje) - 4, 11 * grosor(c));
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

/** Tubo fino a lo largo de unos puntos: las líneas de WebGL siempre miden 1 px y apenas se ven. */
function tubo(puntos: THREE.Vector3[], radio: number): THREE.BufferGeometry {
  if (puntos.length < 2) return new THREE.BufferGeometry();
  const curva = new THREE.CatmullRomCurve3(puntos, false, "centripetal");
  return new THREE.TubeGeometry(curva, Math.max(8, puntos.length * 4), radio, 6, false);
}

function titulo<T extends HTMLElement>(el: T, texto: string): T {
  el.title = texto;
  return el;
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
