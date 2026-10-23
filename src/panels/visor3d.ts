import { plural, t, traducible } from "../i18n";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { IContentRenderer } from "dockview-core";
import { aplanarEnSegundoPlano } from "../geometria/cliente";
import { corteExtraHasta, corteManual, corteSugerido, verticeMasCercano } from "../geometria/corte";
import { medirDeformacion } from "../geometria/metricas";
import { longitud, seleccionarPorEje, submalla, suavizarSeleccion, type Seleccion } from "../geometria/seleccion";
import { prepararSimetria } from "../geometria/simetria";
import { crearPlanTeselado, evaluarTeselado, type PlanTeselado } from "../geometria/teselado";
import { botonIcono } from "../ui/iconos";
import { botonMenu } from "../ui/menu";
import { cargarCuerpo, ejeDeLaPierna, ejeDelBrazo, type Cuerpo } from "../modelos/cuerpo";
import { aplicarComplexion, cargarFormas, COMPLEXION_INICIAL, type Complexion, type Formas } from "../modelos/formas";
import type { ProyectoAbierto } from "../proyectos/proyecto";
import { enTauri } from "../proyectos/sistema-archivos";
import { PanelCuerpo } from "./cuerpo";
import { aplicarPose, esRecta, POSE_RECTA, type Pose } from "../modelos/pose";
import { aplicarMedidas, medirContornos, type Medidas } from "../modelos/medidas";
import { app } from "../estado";
import { añadirLienzo } from "../proyectos/gestor";
import { guardarExportacion } from "../exportar/guardar";
import { nuevoId } from "../lienzo/capa";
import { Lienzo } from "../lienzo/lienzo";
import { contexto, crearLamina, RegionSucia, type Rect } from "../lienzo/teselas";

type P3 = [number, number, number];

/** Píxeles del lienzo por centímetro (300 ppp). */
const PX_POR_CM_3D = 300 / 2.54;

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
  private botonSeleccionar!: HTMLButtonElement;
  private area!: HTMLElement;
  private controlSeleccion!: HTMLElement;
  private ayudaControl!: HTMLElement;
  private radioPincel = 2.5;
  private activo = true;

  /** Malla base de MakeHuman sin deformar y sus formas (complexión, RF-12). */
  private base: Cuerpo | null = null;
  private formas: Formas | null = null;
  /** Cuerpo con la complexión del proyecto: el que se ve y sobre el que se selecciona. */
  private cuerpo: Cuerpo | null = null;
  private proyectoSuscrito: ProyectoAbierto | null = null;
  private cuerpoPendiente = false;
  /** Postura solo para ver (RF-13); con el cuerpo doblado no se seleccionan zonas. */
  private pose: Pose = { ...POSE_RECTA };
  private panelCuerpo!: PanelCuerpo;
  private alCambiarProyecto = () => this.suscribirProyecto();
  private barraPresentacion: HTMLElement;
  private presentando = false;
  private botonGirar!: HTMLButtonElement;
  private versiones!: HTMLElement;
  private visiblesAntes: { objeto: THREE.Object3D; visible: boolean }[] = [];
  private alTeclaPresentacion = (e: KeyboardEvent) => {
    if (e.key === "Escape") this.presentar(false);
  };
  private alCambiarModelo = () => this.programarCuerpo();
  /** Malla original del cuerpo: invisible, para el ratón (selección, cortes, pintar). */
  private mallaCuerpo: THREE.Mesh | null = null;
  /** Lo que se ve: la misma malla redondeada con teselado de Phong. */
  private vistaCuerpo: THREE.Mesh | null = null;
  private planCuerpo: PlanTeselado | null = null;
  private normalesCuerpo: THREE.BufferAttribute | null = null;
  private centros = new Float32Array(0);
  private normalesCaras = new Float32Array(0);

  private seleccionados = new Set<number>();
  private resaltado = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      color: 0xff4600,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    }),
  );
  private modoSeleccion = false;
  /** Lazo libre (RF-20): se dibuja un contorno en pantalla y se añaden los triángulos visibles dentro. */
  private modoLazo = false;
  /** Pintar directamente sobre el modelo, en el lienzo activo (RF-39). */
  private modoPintar = false;
  private botonPintar!: HTMLButtonElement;
  private pintando3d = false;
  private trazo3d: { lienzo: Lienzo; doc: { x: number; y: number }; p3: THREE.Vector3 } | null = null;
  private botonLazo!: HTMLButtonElement;
  private lazo: { puntos: [number, number][]; quitar: boolean } | null = null;
  private capaLazo: HTMLCanvasElement;
  private pendiente: PointerEvent | null = null;
  /** Submalla de la selección actual (se invalida al cambiar la selección). */
  private seleccionCacheada: Seleccion | null = null;
  /** Corte que se usará al aplanar una manga, visible antes de aplanar (RF-23). */
  /** Tubo azul visible y, encima, el mismo semitransparente que se ve a través del cuerpo. */
  private previaCorte = new THREE.Group();
  private corteProgramado = false;
  /** Cortes extra (RF-25) sobre la selección actual, en vértices de su submalla. */
  private cortesExtra: number[][] = [];
  /** Puntos del corte manual (RF-22), en vértices de la submalla de la selección. */
  private puntosCorte: number[] = [];
  private modoCorteManual = false;
  private botonCorteManual!: HTMLButtonElement;
  private modoCorte = false;
  private botonCorte!: HTMLButtonElement;
  private grupoCortesExtra = new THREE.Group();
  private pintando: "añadir" | "quitar" | null = null;
  private raycaster = new THREE.Raycaster();

  private zonas3d = new THREE.Group();
  /** Fotogramas que aún hay que dibujar tras un cambio (dibujado bajo demanda). */
  private framesPendientes = 2;
  private ultimoRender = 0;
  private redibujar = () => {
    this.framesPendientes = 3;
  };
  private mallas = new Map<Lienzo, MallaLienzo>();
  private alCambiarLienzos = () => {
    this.redibujar();
    this.reconstruirLienzos();
    if (this.presentando) this.pintarVersiones();
  };
  private alCambiarActivo = () => {
    this.redibujar();
    this.resaltarActivo();
    // RF-41: al cambiar de lienzo, la cámara va a su zona.
    if (app.activo && app.activo !== this.ultimoActivo && !this.presentando) this.encuadrarZona(app.activo);
    this.ultimoActivo = app.activo;
  };
  private ultimoActivo: Lienzo | null = null;
  /** Atajos del visor (con el ratón encima): 1–9 vistas, F zona activa, S seleccionar, L lazo. */
  private alTecla = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey || !this.element.matches(":hover") || this.presentando) return;
    const n = Number(e.key);
    if (n >= 1 && n <= VISTAS.length) this.verVista(n - 1);
    else if (e.key.toLowerCase() === "f" && app.activo) this.encuadrarZona(app.activo);
    else if (e.key.toLowerCase() === "s") this.alternarSeleccion();
    else if (e.key.toLowerCase() === "l") this.alternarLazo();
    else if (e.key === "Enter") void this.aplanar();
    else return;
    e.preventDefault();
  };

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "panel panel-visor";

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x000000, 0);
    // Zona del 3D (a la derecha del riel de herramientas).
    this.area = document.createElement("div");
    this.area.className = "area-visor";
    this.area.appendChild(this.renderer.domElement);

    this.estadoTexto = document.createElement("div");
    this.estadoTexto.className = "etiqueta-flotante";
    this.estadoTexto.textContent = t("Cargando cuerpo…");

    // ── Riel de herramientas (como en Illustrator): solo iconos, con tooltip y atajo ──
    this.botonSeleccionar = botonIcono("seleccionar", t("Pincel de selección: pinta la zona sobre el cuerpo; Mayús quita (S)"), () => this.alternarSeleccion());
    this.botonLazo = botonIcono("lazo", t("Lazo: rodea la zona; se añade lo que se ve dentro; Mayús quita (L)"), () => this.alternarLazo());
    const zonaRapida = botonMenu("zonaRapida", t("Zona rápida: manga, antebrazo o pierna de una vez"), () =>
      ZONAS_RAPIDAS.map((z, i) => ({ texto: t(z.nombre), accion: () => this.zonaRapida(i) })),
      { lado: "derecha" },
    );
    this.botonCorteManual = botonIcono(
      "corte",
      t("Corte manual: marca con clics por dónde va el corte de la manga"),
      () => this.alternarCorteManual(),
    );
    this.botonCorte = botonIcono("curva", t("Corte extra: clic en la zona para abrir una pinza desde el borde (menos deformación)"), () =>
      this.alternarModoCorte(),
    );
    this.botonPintar = botonIcono("pintar3d", t("Pintar en 3D sobre el modelo, en el lienzo activo; gira con el botón derecho"), () => this.alternarPintar());
    const vistas = botonMenu("vistas", t("Vistas de cámara (teclas 1 a 9)"), () => VISTAS.map((v, i) => ({ texto: t(v.nombre), atajo: String(i + 1), accion: () => this.verVista(i) })), {
      lado: "derecha",
    });
    const separador = () => Object.assign(document.createElement("span"), { className: "separador-riel" });
    const hueco = Object.assign(document.createElement("span"), { className: "hueco" });
    const riel = document.createElement("div");
    riel.className = "riel";
    riel.append(
      this.botonSeleccionar,
      this.botonLazo,
      zonaRapida,
      botonIcono("borrar", t("Vaciar la selección"), () => this.fijarSeleccion([])),
      separador(),
      this.botonCorteManual,
      this.botonCorte,
      botonIcono("cerrar", t("Quitar los cortes"), () => this.quitarCortesExtra()),
      separador(),
      botonIcono("aplanar", t("Aplanar la zona seleccionada en un lienzo nuevo (Intro)"), () => void this.aplanar(), { clase: "acento" }),
      separador(),
      this.botonPintar,
      hueco,
      vistas,
      botonIcono("encuadrar", t("Encuadrar la zona del lienzo activo (F)"), () => app.activo && this.encuadrarZona(app.activo)),
      botonIcono("camara", t("Guardar la vista en PNG para enseñarla al cliente"), () => void this.exportarImagen()),
      botonIcono("cuerpo", t("Cuerpo del cliente: complexión, medidas, postura y tono de piel"), () => this.panelCuerpo.alternar()),
    );

    // ── Barra de control (arriba): opciones de la herramienta activa ──
    const radio = document.createElement("input");
    radio.type = "range";
    radio.min = "1";
    radio.max = "6";
    radio.step = "0.5";
    radio.value = String(this.radioPincel);
    radio.className = "deslizador";
    const valorRadio = Object.assign(document.createElement("span"), { className: "valor" });
    const mostrarRadio = () => (valorRadio.textContent = `${this.radioPincel.toFixed(1)} cm`);
    radio.addEventListener("input", () => {
      this.radioPincel = Number(radio.value);
      mostrarRadio();
    });
    mostrarRadio();
    const etiquetaRadio = document.createElement("label");
    etiquetaRadio.className = "control-etiquetado";
    etiquetaRadio.title = t("Radio del pincel de selección");
    etiquetaRadio.append(t("Radio"), radio, valorRadio);
    this.controlSeleccion = etiquetaRadio;
    this.ayudaControl = Object.assign(document.createElement("span"), { className: "ayuda-control" });
    const barra = document.createElement("div");
    barra.className = "herramientas barra-control";
    barra.append(etiquetaRadio, this.ayudaControl);

    const cuerpoVisor = document.createElement("div");
    cuerpoVisor.className = "cuerpo-visor";
    cuerpoVisor.append(riel, this.area);
    this.element.append(barra, cuerpoVisor);

    this.capaLazo = document.createElement("canvas");
    this.capaLazo.className = "capa-lazo";
    this.area.append(this.capaLazo);
    this.panelCuerpo = new PanelCuerpo(
      (pose) => {
        this.pose = pose;
        this.programarCuerpo();
      },
      () => this.contornosDelModelo(),
    );
    this.barraPresentacion = this.montarBarraPresentacion();
    this.area.append(this.estadoTexto, this.panelCuerpo.element);
    this.element.append(this.barraPresentacion);
    this.actualizarControl();

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
    window.addEventListener("keydown", this.alTecla);

    const lienzo = this.renderer.domElement;
    lienzo.addEventListener("pointerdown", (e) => this.empezarPincel(e));
    lienzo.addEventListener("pointermove", (e) => this.moverPincel(e));
    lienzo.addEventListener("pointerup", (e) => this.terminarPincel(e));
    lienzo.addEventListener("contextmenu", (e) => e.preventDefault());

    this.observador = new ResizeObserver(() => this.ajustarTamano());
    this.observador.observe(this.area);

    // Se dibuja solo cuando algo cambia (cámara, texturas, escena o entrada del usuario), y
    // además una vez por segundo por si acaso: así el visor no gasta GPU mientras se dibuja
    // en el lienzo ni cuando no se toca (RNF-01, RNF-02).
    for (const tipo of ["pointerdown", "pointermove", "pointerup", "wheel", "keydown", "keyup"]) {
      this.element.addEventListener(tipo, this.redibujar, { passive: true });
    }
    this.renderer.setAnimationLoop((t) => {
      if (!this.activo) return;
      const movida = this.controles.update();
      const texturas = this.subirTexturas();
      if (movida || texturas || this.framesPendientes > 0 || this.controles.autoRotate || t - this.ultimoRender > 1000) {
        this.framesPendientes = Math.max(0, this.framesPendientes - 1);
        this.ultimoRender = t;
        this.renderer.render(this.escena, this.camara);
      }
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
    this.botonGirar = boton(t("Girar"), () => this.alternarGiro(!this.controles.autoRotate));
    this.versiones = document.createElement("div");
    this.versiones.className = "versiones";
    barra.append(
      this.versiones,
      vista(t("Frente"), [0, 0.1, 1]),
      vista(t("Espalda"), [0, 0.1, -1]),
      vista(t("Izquierda"), [1, 0.1, 0.05]),
      vista(t("Derecha"), [-1, 0.1, 0.05]),
      this.botonGirar,
      titulo(boton(t("Imagen…"), () => void this.exportarImagen()), t("Guardar esta vista en PNG")),
      titulo(boton(t("Salir"), () => this.presentar(false)), t("Salir de la presentación (Esc)")),
    );
    return barra;
  }

  /**
   * Lienzos del proyecto como botones para enseñarlos u ocultarlos durante la presentación:
   * así se comparan versiones del diseño delante del cliente (RF-46).
   */
  private pintarVersiones(): void {
    const p = app.proyecto;
    this.versiones.replaceChildren();
    if (!p || !this.presentando) return;
    const nodos = p.nodosLienzo();
    if (nodos.length < 2) return;
    for (const nodo of nodos) {
      const b = boton(nodo.nombre, () => p.alternarVisible(nodo.id));
      b.classList.toggle("activo", nodo.visible !== false);
      b.title = t("Mostrar u ocultar este lienzo");
      this.versiones.append(b);
    }
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
      if (this.modoLazo) this.alternarLazo();
      if (this.modoCorteManual) this.alternarCorteManual();
      if (this.modoPintar) this.alternarPintar();
      this.activo = true;
      if (this.cuerpo) this.encuadrar([0, this.cuerpo.altura / 2, 0], this.cuerpo.altura / 2, [0, 0.1, 1]);
      this.alternarGiro(true);
      this.pintarVersiones();
      window.addEventListener("keydown", this.alTeclaPresentacion);
      void pantallaCompleta(true);
    } else {
      for (const { objeto, visible } of this.visiblesAntes) objeto.visible = visible;
      this.resaltarActivo();
      this.alternarGiro(false);
      window.removeEventListener("keydown", this.alTeclaPresentacion);
      void pantallaCompleta(false);
    }
    this.ajustarTamano();
  }

  /**
   * Encuadra la zona de un lienzo: centro y tamaño de sus vértices en el cuerpo actual,
   * mirando desde la dirección media de su piel (en mangas, que la rodean, desde la vista actual).
   */
  encuadrarZona(lienzo: Lienzo): void {
    if (!this.cuerpo || !this.normalesCuerpo) return;
    const v = this.cuerpo.vertices;
    const n = this.normalesCuerpo;
    const indices = lienzo.zona.verticeBase;
    const centro = new THREE.Vector3();
    const normal = new THREE.Vector3();
    for (const b of indices) {
      centro.x += v[3 * b];
      centro.y += v[3 * b + 1];
      centro.z += v[3 * b + 2];
      normal.x += n.getX(b);
      normal.y += n.getY(b);
      normal.z += n.getZ(b);
    }
    centro.divideScalar(indices.length);
    let radio = 0;
    for (const b of indices) radio = Math.max(radio, Math.hypot(v[3 * b] - centro.x, v[3 * b + 1] - centro.y, v[3 * b + 2] - centro.z));
    const direccion =
      normal.length() / indices.length > 0.35
        ? normal.normalize()
        : this.camara.position.clone().sub(this.controles.target).normalize();
    this.encuadrar(centro.toArray() as P3, Math.max(8, radio * 1.1), direccion.toArray() as P3);
  }

  private encuadrar(centro: P3, radio: number, direccion: P3): void {
    this.redibujar();
    this.controles.target.set(...centro);
    const dir = new THREE.Vector3(...direccion).normalize();
    this.camara.position.copy(this.controles.target).addScaledVector(dir, this.distanciaPara(radio));
    this.controles.update();
  }

  dispose(): void {
    if (this.presentando) this.presentar(false);
    visores.splice(visores.indexOf(this), 1);
    this.renderer.setAnimationLoop(null);
    for (const tipo of ["pointerdown", "pointermove", "pointerup", "wheel", "keydown", "keyup"]) {
      this.element.removeEventListener(tipo, this.redibujar);
    }
    this.observador.disconnect();
    this.controles.dispose();
    this.renderer.dispose();
    app.removeEventListener("lienzos", this.alCambiarLienzos);
    app.removeEventListener("activo", this.alCambiarActivo);
    app.removeEventListener("proyecto", this.alCambiarProyecto);
    window.removeEventListener("keydown", this.alTecla);
    this.proyectoSuscrito?.removeEventListener("modelo", this.alCambiarModelo);
  }

  // ── Carga y escena ────────────────────────────────────────────────────────────

  private montarEscena(): void {
    // Luz de estudio: un entorno suave (reflejos difusos realistas) más una luz principal
    // cálida, un relleno frío y un contraluz que dibuja la silueta.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.escena.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.escena.environmentIntensity = 0.55;
    pmrem.dispose();
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.escena.add(new THREE.HemisphereLight(0xfff4ec, 0x2a2420, 0.6));
    const luz = new THREE.DirectionalLight(0xfff1e6, 1.6);
    luz.position.set(60, 200, 150);
    this.escena.add(luz);
    const relleno = new THREE.DirectionalLight(0xdfe8ff, 0.35);
    relleno.position.set(-120, 80, 90);
    this.escena.add(relleno);
    const contraluz = new THREE.DirectionalLight(0xffe2d2, 0.9);
    contraluz.position.set(-80, 140, -160);
    this.escena.add(contraluz);
    this.escena.add(this.zonas3d);
    // Su geometría cambia con cada pincelada: sin recorte por frustum para no recalcular límites.
    this.resaltado.frustumCulled = false;
    this.resaltado.visible = false;
    this.escena.add(this.resaltado);
    const solido = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0x3fb8ff }));
    const traslucido = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: 0x3fb8ff, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false }),
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
      prepararSimetria(this.base);
    } catch (error) {
      this.estadoTexto.textContent = t("No se pudo cargar el cuerpo: {error}", { error: String(error) });
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
    this.mallaCuerpo = new THREE.Mesh(geometria, new THREE.MeshBasicMaterial());
    this.mallaCuerpo.visible = false;
    this.escena.add(this.mallaCuerpo);
    this.planCuerpo = crearPlanTeselado(this.cuerpo.caras, this.cuerpo.vertices.length / 3, NIVEL_TESELADO);
    const vista = new THREE.BufferGeometry();
    vista.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.planCuerpo.n * 3), 3));
    vista.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(this.planCuerpo.n * 3), 3));
    vista.setIndex(new THREE.BufferAttribute(this.planCuerpo.indice, 1));
    this.vistaCuerpo = new THREE.Mesh(vista, materialPiel(app.proyecto?.datos.modelo.tonoPiel ?? "#d8a98a"));
    this.escena.add(this.vistaCuerpo);
    this.actualizarVistaCuerpo();
    this.resaltado.geometry.setAttribute("position", vista.getAttribute("position"));
    // Sin índices dibujaría todos los vértices del cuerpo como triángulos sueltos.
    this.resaltado.geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(0), 1));
    this.resaltado.visible = false;
    this.precalcularCaras();
    this.verVista(0);
    app.fijarCuerpo(this.cuerpo);
    this.suscribirProyecto();
    this.reconstruirLienzos();
    this.estadoTexto.textContent =
      t("Elige una zona rápida o pinta una con «Seleccionar» · arrastra para girar, rueda para acercar");
  }

  /** Complexión guardada en el proyecto abierto (o la inicial si no hay proyecto). */
  private complexionDelProyecto(): Complexion {
    const m = app.proyecto?.datos.modelo;
    if (!m) return { ...COMPLEXION_INICIAL };
    return {
      // Hombre o mujer: los proyectos antiguos con valores intermedios se redondean.
      sexo: (m.sexo ?? 0) >= 0.5 ? 1 : 0,
      musculatura: m.musculatura ?? COMPLEXION_INICIAL.musculatura,
      peso: m.complexion ?? COMPLEXION_INICIAL.peso,
      altura: m.altura || COMPLEXION_INICIAL.altura,
    };
  }

  private cuerpoDelProyecto(): Cuerpo {
    const cuerpo = this.cuerpoSinPostura();
    return aplicarPose(cuerpo, this.pose);
  }

  /** Cuerpo con complexión y medidas del cliente, en postura recta. */
  private cuerpoSinPostura(): Cuerpo {
    const conForma = this.formas ? aplicarComplexion(this.base!, this.formas, this.complexionDelProyecto()) : this.base!;
    const medidas = app.proyecto?.datos.modelo.medidas;
    return medidas ? aplicarMedidas(conForma, medidas) : conForma;
  }

  /** Contornos del modelo sin las medidas del cliente (para orientar al introducirlas). */
  private contornosDelModelo(): Required<Medidas> | null {
    if (!this.base) return null;
    const conForma = this.formas ? aplicarComplexion(this.base, this.formas, this.complexionDelProyecto()) : this.base;
    return medirContornos(conForma);
  }

  private suscribirProyecto(): void {
    this.panelCuerpo.sincronizar();
    if (this.proyectoSuscrito === app.proyecto) return;
    this.pose = { ...POSE_RECTA };
    this.panelCuerpo.posturaRecta();
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
    this.redibujar();
    const material = this.vistaCuerpo!.material as THREE.MeshPhysicalMaterial;
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
    this.actualizarVistaCuerpo();
    this.precalcularCaras();
    this.actualizarResaltado();
    for (const [lienzo, m] of this.mallas) this.recolocarLienzo(lienzo, m);
    app.fijarCuerpo(this.cuerpo);
  }

  private actualizarVistaCuerpo(): void {
    if (!this.vistaCuerpo || !this.planCuerpo || !this.mallaCuerpo) return;
    const fuente = this.mallaCuerpo.geometry;
    const g = this.vistaCuerpo.geometry;
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const nor = g.getAttribute("normal") as THREE.BufferAttribute;
    evaluarTeselado(
      this.planCuerpo,
      fuente.getAttribute("position").array,
      fuente.getAttribute("normal").array,
      pos.array as Float32Array,
      nor.array as Float32Array,
    );
    pos.needsUpdate = true;
    nor.needsUpdate = true;
    g.computeBoundingSphere();
    g.computeBoundingBox();
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
      t("{zona}: {n} triángulos. La línea azul es el corte: gira la vista para moverlo. Pulsa «Aplanar zona».", { zona: t(zona.nombre), n: seleccion.triangulos.length });
  }

  // ── Selección a pincel ────────────────────────────────────────────────────────

  /** Barra de control: las opciones y la ayuda de la herramienta activa. */
  private actualizarControl(): void {
    if (!this.ayudaControl) return;
    this.controlSeleccion.hidden = !this.modoSeleccion;
    this.ayudaControl.textContent = this.modoSeleccion
      ? t("Arrastra sobre el cuerpo para añadir piel a la zona; Mayús + arrastrar quita.")
      : this.modoLazo
        ? t("Rodea la zona con el ratón: se añade lo que se ve dentro. Mayús quita.")
        : this.modoCorteManual
          ? t("Haz clic sobre la zona para marcar por dónde va el corte; se une a los bordes solo.")
          : this.modoCorte
            ? t("Haz clic dentro de la zona donde debe terminar el corte extra.")
            : this.modoPintar
              ? t("Dibuja sobre el modelo con el pincel del lienzo; botón derecho para girar.")
              : t("Selecciona una zona con las herramientas de la izquierda, ajusta el corte y pulsa Aplanar.");
  }

  private alternarCorteManual(): void {
    this.modoCorteManual = !this.modoCorteManual;
    if (this.modoCorteManual && this.modoCorte) this.alternarModoCorte();
    if (this.modoCorteManual && this.modoSeleccion) this.alternarSeleccion();
    if (this.modoCorteManual && this.modoLazo) this.alternarLazo();
    this.botonCorteManual.classList.toggle("activo", this.modoCorteManual);
    this.actualizarControl();
    this.renderer.domElement.style.cursor = this.modoCorteManual ? "crosshair" : "";
    if (this.modoCorteManual)
      this.estadoTexto.textContent = t("Haz clic en la manga por donde quieras que pase el corte (puedes marcar varios puntos).");
  }

  private añadirPuntoCorte(e: PointerEvent): void {
    const seleccion = this.seleccionActual();
    const golpe = this.lanzarRayo(e);
    if (!seleccion) {
      this.estadoTexto.textContent = t("Selecciona primero una manga.");
      return;
    }
    if (!golpe || !this.seleccionados.has(golpe.cara)) {
      this.estadoTexto.textContent = t("Haz clic sobre la zona seleccionada.");
      return;
    }
    const punto = verticeMasCercano(seleccion.malla, golpe.point.toArray() as P3);
    const puntos = [...this.puntosCorte, punto];
    if (!corteManual(seleccion.malla, puntos)) {
      this.estadoTexto.textContent = corteSugerido(seleccion.malla, [0, 0, 1])
        ? t("Ese punto está en el borde: elige uno dentro de la manga.")
        : t("El corte manual solo es para mangas (zonas con dos bordes).");
      return;
    }
    this.puntosCorte = puntos;
    this.actualizarCorte();
    this.estadoTexto.textContent = plural(puntos.length, "Corte manual con {n} punto. Añade más o pulsa «Aplanar zona».", "Corte manual con {n} puntos. Añade más o pulsa «Aplanar zona».");
  }

  /** Corte principal que se usará: el manual si hay puntos, si no el automático según la vista. */
  private corteActual(seleccion: Seleccion): { camino: number[]; extremos: [number, number]; manual: boolean } | null {
    if (this.puntosCorte.length) {
      const camino = corteManual(seleccion.malla, this.puntosCorte);
      if (camino) return { camino, extremos: [camino[0], camino[camino.length - 1]], manual: true };
    }
    const auto = corteSugerido(seleccion.malla, this.haciaCamara());
    return auto && { ...auto, manual: false };
  }

  private alternarModoCorte(): void {
    if (!this.modoCorte && this.modoCorteManual) this.alternarCorteManual();
    this.modoCorte = !this.modoCorte;
    if (this.modoCorte && this.modoSeleccion) this.alternarSeleccion();
    this.botonCorte.classList.toggle("activo", this.modoCorte);
    this.actualizarControl();
    this.renderer.domElement.style.cursor = this.modoCorte ? "crosshair" : "";
    if (this.modoCorte) this.estadoTexto.textContent = t("Haz clic en la zona seleccionada donde debe terminar el corte extra.");
  }

  private añadirCorteExtra(e: PointerEvent): void {
    const seleccion = this.seleccionActual();
    const golpe = this.lanzarRayo(e);
    if (!seleccion || !golpe) return;
    const objetivo = verticeMasCercano(seleccion.malla, golpe.point.toArray() as P3);
    const camino = corteExtraHasta(seleccion.malla, objetivo);
    if (camino.length < 2) {
      this.estadoTexto.textContent = t("Ese punto está en el borde: elige uno dentro de la zona.");
      return;
    }
    this.cortesExtra.push(camino);
    this.pintarCortesExtra();
    this.estadoTexto.textContent = plural(this.cortesExtra.length, "{n} corte extra. Pulsa «Aplanar zona» o añade más.", "{n} cortes extra. Pulsa «Aplanar zona» o añade más.");
  }

  private quitarCortesExtra(): void {
    this.cortesExtra = [];
    this.pintarCortesExtra();
    if (this.puntosCorte.length) {
      this.puntosCorte = [];
      this.actualizarCorte();
    }
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
    if (!this.modoSeleccion && this.modoLazo) this.alternarLazo();
    if (!this.modoSeleccion && this.modoPintar) this.alternarPintar();
    this.modoSeleccion = !this.modoSeleccion;
    this.botonSeleccionar.classList.toggle("activo", this.modoSeleccion);
    this.actualizarControl();
    this.botonesCamara(this.modoSeleccion);
  }

  private alternarPintar(): void {
    if (!this.modoPintar) {
      if (this.modoSeleccion) this.alternarSeleccion();
      if (this.modoLazo) this.alternarLazo();
      if (this.modoCorte) this.alternarModoCorte();
      if (this.modoCorteManual) this.alternarCorteManual();
    }
    this.modoPintar = !this.modoPintar;
    this.botonPintar.classList.toggle("activo", this.modoPintar);
    this.actualizarControl();
    this.botonesCamara(this.modoPintar);
    if (this.modoPintar)
      this.estadoTexto.textContent = app.activo
        ? t("Pintando en «{lienzo}» con el pincel del panel Lienzo. Gira con el botón derecho.", { lienzo: app.activo.nombre })
        : t("Abre o crea un lienzo para pintar sobre el modelo.");
  }

  /** Punto del lienzo activo bajo el puntero, en píxeles del documento. */
  private puntoEnLienzo(e: PointerEvent): { lienzo: Lienzo; doc: { x: number; y: number }; p3: THREE.Vector3 } | null {
    const lienzo = app.activo;
    const m = lienzo && this.mallas.get(lienzo);
    if (!lienzo || !m) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camara);
    // Solo vale si el lienzo es lo primero que toca el rayo (no a través del cuerpo).
    const golpes = this.raycaster.intersectObjects([this.mallaCuerpo!, m.grupo.children[0]], false);
    const g = golpes.find((x) => x.object === m.grupo.children[0]);
    if (!g || !g.uv || (golpes[0].object !== g.object && golpes[0].distance < g.distance - 0.3)) return null;
    const geo = lienzo.geo;
    return {
      lienzo,
      doc: { x: (g.uv.x * geo.anchoPrevia) / geo.escalaPrevia, y: (g.uv.y * geo.altoPrevia) / geo.escalaPrevia },
      p3: g.point.clone(),
    };
  }

  private pintar3d(e: PointerEvent, empezar: boolean): void {
    const punto = this.puntoEnLienzo(e);
    const presion = e.pointerType === "mouse" ? 0.5 : e.pressure || 0.5;
    if (!punto) {
      this.terminarTrazo3d();
      return;
    }
    const a = this.trazo3d;
    // Un salto grande en el lienzo para un paso pequeño en el cuerpo = se ha cruzado la
    // costura: se corta el trazo y sigue al otro lado (el lienzo ya continúa los bordes).
    const salto =
      a &&
      a.lienzo === punto.lienzo &&
      Math.hypot(punto.doc.x - a.doc.x, punto.doc.y - a.doc.y) > (a.p3.distanceTo(punto.p3) * PX_POR_CM_3D * 3 + 30);
    if (empezar || !a || a.lienzo !== punto.lienzo || salto) {
      this.terminarTrazo3d();
      const herramienta = app.ajustes.herramienta === "goma" ? "goma" : "pincel";
      if (!punto.lienzo.empezarTrazo({ ...app.ajustes, herramienta }, punto.doc.x, punto.doc.y, presion)) {
        this.estadoTexto.textContent = t("La capa «{capa}» está bloqueada u oculta.", { capa: punto.lienzo.doc.activa.nombre });
        return;
      }
    } else {
      punto.lienzo.continuarTrazo(punto.doc.x, punto.doc.y, presion);
    }
    this.trazo3d = punto;
  }

  private terminarTrazo3d(): void {
    if (this.trazo3d) this.trazo3d.lienzo.terminarTrazo();
    this.trazo3d = null;
  }

  private alternarLazo(): void {
    if (!this.modoLazo && this.modoCorte) this.alternarModoCorte();
    if (!this.modoLazo && this.modoSeleccion) this.alternarSeleccion();
    if (!this.modoLazo && this.modoPintar) this.alternarPintar();
    this.modoLazo = !this.modoLazo;
    this.botonLazo.classList.toggle("activo", this.modoLazo);
    this.actualizarControl();
    this.botonesCamara(this.modoLazo);
    if (this.modoLazo) this.estadoTexto.textContent = t("Rodea la zona con el ratón (Mayús para quitar). Gira la vista con el botón derecho.");
  }

  /** En los modos de selección el botón izquierdo selecciona; la cámara gira con el derecho. */
  private botonesCamara(seleccionando: boolean): void {
    this.controles.mouseButtons.LEFT = seleccionando ? null : THREE.MOUSE.ROTATE;
    this.controles.mouseButtons.RIGHT = seleccionando ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
    this.renderer.domElement.style.cursor = seleccionando ? "crosshair" : "";
  }

  private pintarLazo(): void {
    const c = this.capaLazo;
    const dpr = window.devicePixelRatio;
    const { clientWidth: w, clientHeight: h } = this.renderer.domElement;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const ctx = c.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    if (!this.lazo || this.lazo.puntos.length < 2) return;
    ctx.scale(dpr, dpr);
    ctx.beginPath();
    this.lazo.puntos.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = this.lazo.quitar ? "rgba(90, 140, 230, 0.18)" : "rgba(255, 70, 0, 0.18)";
    ctx.fill();
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = this.lazo.quitar ? "#5a8ce6" : "#ff4600";
    ctx.stroke();
  }

  /**
   * Triángulos del cuerpo visibles dentro del lazo: se dibuja el cuerpo con el número de
   * cada triángulo como color (sin luces ni suavizado) y se leen los píxeles dentro del contorno.
   * Así solo entra lo que se ve, nunca la cara de atrás del brazo.
   */
  private triangulosEnLazo(puntos: [number, number][]): number[] {
    if (!this.cuerpo || puntos.length < 3) return [];
    const { vertices: v, caras: f } = this.cuerpo;
    const nT = f.length / 3;
    const posiciones = new Float32Array(nT * 9);
    const colores = new Float32Array(nT * 9);
    for (let t = 0; t < nT; t++) {
      const id = t + 1;
      const rgb = [(id & 255) / 255, ((id >> 8) & 255) / 255, ((id >> 16) & 255) / 255];
      for (let k = 0; k < 3; k++) {
        const o = 3 * f[3 * t + k];
        posiciones.set([v[o], v[o + 1], v[o + 2]], 9 * t + 3 * k);
        colores.set(rgb, 9 * t + 3 * k);
      }
    }
    const geometria = new THREE.BufferGeometry();
    geometria.setAttribute("position", new THREE.BufferAttribute(posiciones, 3));
    geometria.setAttribute("color", new THREE.BufferAttribute(colores, 3));
    const material = new THREE.ShaderMaterial({
      vertexShader: "attribute vec3 color; varying vec3 vId; void main() { vId = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: "varying vec3 vId; void main() { gl_FragColor = vec4(vId, 1.0); }",
    });
    const escena = new THREE.Scene();
    escena.add(new THREE.Mesh(geometria, material));
    const dpr = this.renderer.getPixelRatio();
    const { clientWidth: w, clientHeight: h } = this.renderer.domElement;
    const ancho = Math.max(1, Math.round(w * dpr)), alto = Math.max(1, Math.round(h * dpr));
    const destino = new THREE.WebGLRenderTarget(ancho, alto, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    const colorAntes = new THREE.Color();
    this.renderer.getClearColor(colorAntes);
    const alfaAntes = this.renderer.getClearAlpha();
    this.renderer.setRenderTarget(destino);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.clear();
    this.renderer.render(escena, this.camara);
    const pixeles = new Uint8Array(ancho * alto * 4);
    this.renderer.readRenderTargetPixels(destino, 0, 0, ancho, alto, pixeles);
    this.renderer.setRenderTarget(null);
    this.renderer.setClearColor(colorAntes, alfaAntes);
    destino.dispose();
    geometria.dispose();
    material.dispose();

    // Máscara del lazo a la misma resolución.
    const mascara = new OffscreenCanvas(ancho, alto);
    const ctx = mascara.getContext("2d", { willReadFrequently: true })!;
    ctx.scale(dpr, dpr);
    ctx.beginPath();
    puntos.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
    const m = ctx.getImageData(0, 0, ancho, alto).data;
    const elegidos = new Set<number>();
    for (let y = 0; y < alto; y++) {
      // readRenderTargetPixels empieza por abajo; la máscara, por arriba.
      const filaId = (alto - 1 - y) * ancho;
      for (let x = 0; x < ancho; x++) {
        if (m[4 * (y * ancho + x) + 3] < 128) continue;
        const i = 4 * (filaId + x);
        const id = pixeles[i] | (pixeles[i + 1] << 8) | (pixeles[i + 2] << 16);
        if (id > 0 && id <= nT) elegidos.add(id - 1);
      }
    }
    return [...elegidos];
  }

  private posicionEnVisor(e: PointerEvent): [number, number] {
    const r = this.renderer.domElement.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private empezarPincel(e: PointerEvent): void {
    if (this.modoCorte && e.button === 0) {
      this.añadirCorteExtra(e);
      return;
    }
    if (this.modoCorteManual && e.button === 0) {
      this.añadirPuntoCorte(e);
      return;
    }
    if (this.modoPintar && e.button === 0) {
      this.renderer.domElement.setPointerCapture(e.pointerId);
      this.pintando3d = true;
      this.pintar3d(e, true);
      return;
    }
    if (this.modoLazo && e.button === 0) {
      this.lazo = { puntos: [this.posicionEnVisor(e)], quitar: e.shiftKey };
      this.renderer.domElement.setPointerCapture(e.pointerId);
      return;
    }
    if (!this.modoSeleccion || e.button !== 0 || !this.cuerpo) return;
    this.pintando = e.shiftKey ? "quitar" : "añadir";
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.pincel(e);
  }

  /** Al soltar, se suaviza el borde de la selección (quita picos de la malla base). */
  private terminarPincel(e?: PointerEvent): void {
    if (this.pintando3d) {
      this.pintando3d = false;
      this.terminarTrazo3d();
      return;
    }
    if (this.lazo) {
      const { puntos, quitar } = this.lazo;
      this.lazo = null;
      this.pintarLazo();
      if (e && this.renderer.domElement.hasPointerCapture(e.pointerId)) this.renderer.domElement.releasePointerCapture(e.pointerId);
      const dentro = this.triangulosEnLazo(puntos);
      if (!dentro.length || !this.cuerpo) return;
      const seleccion = new Set(this.seleccionados);
      for (const t of dentro) quitar ? seleccion.delete(t) : seleccion.add(t);
      this.fijarSeleccion(suavizarSeleccion(this.cuerpo, seleccion));
      this.estadoTexto.textContent = t("{n} triángulos seleccionados. Gira la vista y rodea más zona, o pulsa «Aplanar zona».", { n: this.seleccionados.size });
      return;
    }
    if (!this.pintando || !this.cuerpo) return;
    this.pintando = null;
    this.fijarSeleccion(suavizarSeleccion(this.cuerpo, this.seleccionados));
  }

  private moverPincel(e: PointerEvent): void {
    if (this.pintando3d) {
      for (const ev of e.getCoalescedEvents?.() ?? [e]) this.pintar3d(ev, false);
      return;
    }
    if (this.lazo) {
      const p = this.posicionEnVisor(e);
      const u = this.lazo.puntos[this.lazo.puntos.length - 1];
      if (Math.hypot(p[0] - u[0], p[1] - u[1]) >= 3) {
        this.lazo.puntos.push(p);
        this.pintarLazo();
      }
      return;
    }
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

  private lanzarRayo(e: PointerEvent): { point: THREE.Vector3; normal: THREE.Vector3; cara: number } | null {
    if (!this.mallaCuerpo) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camara);
    const golpe = this.raycaster.intersectObject(this.mallaCuerpo, false)[0];
    if (!golpe || golpe.faceIndex == null) return null;
    const t = golpe.faceIndex;
    const normal = new THREE.Vector3().fromArray(this.normalesCaras, 3 * t);
    return { point: golpe.point, normal, cara: t };
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
    this.redibujar();
    const seleccion = this.pintando ? null : this.seleccionActual();
    const corte = seleccion && this.corteActual(seleccion);
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
    if (this.cortesExtra.length || this.puntosCorte.length) this.quitarCortesExtra();
    this.programarCorte();
    // Sobre la malla que se ve: los k² triángulos de cada triángulo elegido.
    const plan = this.planCuerpo!;
    const porCara = plan.k * plan.k * 3;
    const indices = new Uint32Array(this.seleccionados.size * porCara);
    let k = 0;
    for (const t of this.seleccionados) {
      indices.set(plan.indice.subarray(t * porCara, (t + 1) * porCara), k);
      k += porCara;
    }
    this.resaltado.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.resaltado.visible = this.seleccionados.size > 0;
  }

  // ── Aplanado: cada zona aplanada es un lienzo nuevo (RF-29) ─────────────────

  private async aplanar(): Promise<void> {
    if (!this.cuerpo) return;
    if (this.seleccionados.size < 8) {
      this.estadoTexto.textContent = t("Selecciona primero una zona.");
      return;
    }
    const seleccion = this.seleccionActual()!;
    // Se puede seleccionar con el cuerpo en cualquier postura, pero el lienzo se hace siempre
    // con la piel en la postura base (sin doblar): la zona es la misma (mismos triángulos y
    // vértices, en el mismo orden), solo cambian las posiciones.
    const enReposo = esRecta(this.pose) ? seleccion : submalla(this.cuerpoSinPostura(), this.seleccionados);
    this.estadoTexto.textContent = t("Aplanando…");
    // El corte por defecto queda en la cara que no se ve (opuesta a la cámara), y el
    // lienzo se orienta como la vista actual: la derecha de la pantalla es la del lienzo.
    const haciaCamara = this.camara.position.clone().sub(this.controles.target).normalize();
    const derecha = new THREE.Vector3().setFromMatrixColumn(this.camara.matrixWorld, 0).normalize();
    try {
      // Se aplana con el mismo corte que se está mostrando.
      const corte = this.corteActual(seleccion);
      const { aplanado, milisegundos } = await aplanarEnSegundoPlano(
        enReposo.malla,
        {
          direccionExterna: haciaCamara.toArray() as P3,
          extremos: corte?.extremos,
          corteManual: corte?.manual ? corte.camino : undefined,
          cortesExtra: this.cortesExtra,
        },
        derecha.toArray() as P3,
        haciaCamara.toArray() as P3,
      );
      const deformacion = medirDeformacion(enReposo.malla, aplanado);
      const lienzo = new Lienzo(nuevoId(), nombreLibre(), {
        malla: enReposo.malla,
        aplanado,
        errorPorCara: deformacion.porCara,
        triangulos: seleccion.triangulos,
        verticeBase: seleccion.verticeBase,
      });
      if (app.proyecto) lienzo.tonoPiel = app.proyecto.datos.modelo.tonoPiel;
      this.fijarSeleccion([]);
      if (this.modoCorteManual) this.alternarCorteManual();
      if (this.modoCorte) this.alternarModoCorte();
      await añadirLienzo(lienzo);
      const tipo = aplanado.tipo === "manga" ? t("Manga aplanada (con corte)") : t("Parche aplanado");
      const [w, h] = lienzo.geo.tamanoCm;
      this.estadoTexto.textContent =
        t("{tipo} en {s} s · {ancho} × {alto} cm · {pct} % del área con deformación ≤ 2 %", {
          tipo,
          s: (milisegundos / 1000).toFixed(2),
          ancho: w.toFixed(1),
          alto: h.toFixed(1),
          pct: deformacion.areaDentroDel2.toFixed(0),
        });
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
      const malla = m.vista;
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
    this.teselarLienzo(m);
    for (const hijo of [...m.resalte.children]) {
      m.resalte.remove(hijo);
      if (hijo instanceof THREE.Mesh || hijo instanceof THREE.Line) hijo.geometry.dispose();
    }
    this.construirResalte(lienzo, m.resalte);
  }

  /** Borde de la zona (naranja) y cortes (azul), visibles solo en el lienzo activo. */
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
        new THREE.LineBasicMaterial({ color: 0xff4600 }),
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
        if (tramo.length > 1) resalte.add(new THREE.Mesh(tubo(tramo, 0.12), new THREE.MeshBasicMaterial({ color: 0x3fb8ff })));
        tramo = [];
      };
      for (const v of aplanado.corte) {
        if (v < 0) cerrarTramo();
        else tramo.push(punto(cortado.get(v)!, 0.12));
      }
      cerrarTramo();
    }
  }

  private teselarLienzo(m: MallaLienzo): void {
    const fuente = (m.grupo.children[0] as THREE.Mesh).geometry;
    const g = m.vista.geometry;
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const nor = g.getAttribute("normal") as THREE.BufferAttribute;
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    evaluarTeselado(
      m.plan,
      fuente.getAttribute("position").array,
      fuente.getAttribute("normal").array,
      pos.array as Float32Array,
      nor.array as Float32Array,
      fuente.getAttribute("uv").array,
      uv.array as Float32Array,
    );
    pos.needsUpdate = nor.needsUpdate = uv.needsUpdate = true;
    g.computeBoundingSphere();
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

    const material = materialPiel("#ffffff", textura);
    material.polygonOffset = true;
    const grupo = new THREE.Group();
    // Malla original (invisible, para el ratón) y la redondeada que se ve.
    const recoger = new THREE.Mesh(geometria, new THREE.MeshBasicMaterial());
    recoger.visible = false;
    grupo.add(recoger);
    const resalte = new THREE.Group();
    this.construirResalte(lienzo, resalte);
    grupo.add(resalte);
    const plan = crearPlanTeselado(aplanado.caras, aplanado.origen.length, NIVEL_TESELADO);
    const vista = new THREE.BufferGeometry();
    vista.setAttribute("position", new THREE.BufferAttribute(new Float32Array(plan.n * 3), 3));
    vista.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(plan.n * 3), 3));
    vista.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(plan.n * 2), 2));
    vista.setIndex(new THREE.BufferAttribute(plan.indice, 1));
    const mallaVista = new THREE.Mesh(vista, material);
    grupo.add(mallaVista);

    const m: MallaLienzo = { grupo, textura, resalte, vista: mallaVista, plan, pendiente: new RegionSucia(), desconectar: () => {} };
    this.teselarLienzo(m);
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
  /** Devuelve si ha subido algo (y por tanto hay que volver a dibujar). */
  private subirTexturas(): boolean {
    let algo = false;
    for (const [lienzo, m] of this.mallas) {
      if (m.pendiente.vacia) continue;
      for (const r of m.pendiente.vaciar()) this.subirRegion(lienzo, m, r);
      algo = true;
    }
    return algo;
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
    const { clientWidth: ancho, clientHeight: alto } = this.area;
    this.renderer.setSize(ancho, alto, false);
    this.renderer.render(this.escena, this.camara);
    // Hay que leer el canvas en el mismo instante del render (el búfer no se conserva).
    const url = this.renderer.domElement.toDataURL("image/png");
    this.renderer.setPixelRatio(proporcion);
    this.renderer.setSize(ancho, alto, false);
    [...this.mallas.values()].forEach((m, i) => (m.resalte.visible = resaltes[i]));
    this.resaltado.visible = resaltado;
    const bytes = Uint8Array.from(atob(url.split(",")[1]), (c) => c.charCodeAt(0));
    const nombre = t("{proyecto} - vista 3D", { proyecto: app.proyecto?.nombre ?? "Dermap" });
    const ruta = await guardarExportacion(bytes, nombre, { descripcion: t("Imagen PNG"), extension: "png", mime: "image/png" });
    if (ruta) this.estadoTexto.textContent = t("Imagen guardada: {ruta}", { ruta });
  }

  // ── Cámara ────────────────────────────────────────────────────────────────────

  private ajustarTamano(): void {
    this.redibujar();
    const { clientWidth: ancho, clientHeight: alto } = this.area;
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

/**
 * Pantalla completa para la presentación: en la aplicación, con la ventana nativa (el API del
 * navegador no siempre funciona en el WebView de macOS); en el navegador, con el estándar.
 */
async function pantallaCompleta(activar: boolean): Promise<void> {
  try {
    if (enTauri()) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().setFullscreen(activar);
    } else if (activar) {
      await document.documentElement.requestFullscreen?.();
    } else if (document.fullscreenElement) {
      await document.exitFullscreen();
    }
  } catch {
    // Sin pantalla completa la presentación ocupa igualmente toda la ventana.
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
  /** Malla redondeada que se ve (la de grupo.children[0] es la original, para el ratón). */
  vista: THREE.Mesh;
  plan: PlanTeselado;
  /** Regiones de la textura (px de la vista previa) pendientes de subir a la GPU. */
  pendiente: RegionSucia;
  desconectar: () => void;
}

function nombreLibre(): string {
  let n = app.lienzos.length + 1;
  while (app.lienzos.some((l) => l.nombre === t("Lienzo {n}", { n }))) n++;
  return t("Lienzo {n}", { n });
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
  { nombre: traducible("Cuerpo"), encuadre: (c) => ({ centro: [0, c.altura / 2, 0], radio: c.altura / 2, direccion: [0, 0.1, 1] }) },
  { nombre: traducible("Brazo izquierdo"), encuadre: (c) => ({ centro: medio(ejeDelBrazo(c, "l")), radio: 28, direccion: [0.6, 0.5, 0.65] }) },
  { nombre: traducible("Brazo derecho"), encuadre: (c) => ({ centro: medio(ejeDelBrazo(c, "r")), radio: 28, direccion: [-0.6, 0.5, 0.65] }) },
  { nombre: traducible("Brazo izquierdo · cara interna"), encuadre: (c) => ({ centro: medio(ejeDelBrazo(c, "l")), radio: 26, direccion: [0.3, -0.9, 0.3] }) },
  { nombre: traducible("Brazo derecho · cara interna"), encuadre: (c) => ({ centro: medio(ejeDelBrazo(c, "r")), radio: 26, direccion: [-0.3, -0.9, 0.3] }) },
  { nombre: traducible("Pierna izquierda"), encuadre: (c) => ({ centro: medio(ejeDeLaPierna(c, "l")), radio: 48, direccion: [0.55, 0.1, 0.85] }) },
  { nombre: traducible("Pierna derecha"), encuadre: (c) => ({ centro: medio(ejeDeLaPierna(c, "r")), radio: 48, direccion: [-0.55, 0.1, 0.85] }) },
  { nombre: traducible("Torso"), encuadre: (c) => ({ centro: [0, c.altura * 0.7, 0], radio: 38, direccion: [0, 0.05, 1] }) },
  { nombre: traducible("Espalda"), encuadre: (c) => ({ centro: [0, c.altura * 0.7, 0], radio: 38, direccion: [0, 0.05, -1] }) },
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
  { nombre: traducible("Manga brazo izquierdo"), vista: "Brazo izquierdo", seleccionar: manga("l") },
  { nombre: traducible("Manga brazo derecho"), vista: "Brazo derecho", seleccionar: manga("r") },
  { nombre: traducible("Antebrazo izquierdo"), vista: "Brazo izquierdo", seleccionar: antebrazo("l") },
  { nombre: traducible("Antebrazo derecho"), vista: "Brazo derecho", seleccionar: antebrazo("r") },
  { nombre: traducible("Pierna izquierda"), vista: "Pierna izquierda", seleccionar: pierna("l") },
  { nombre: traducible("Pierna derecha"), vista: "Pierna derecha", seleccionar: pierna("r") },
];

// ── Utilidades de interfaz ───────────────────────────────────────────────────────

/** Cada triángulo de la malla se ve dividido en NIVEL² (teselado de Phong). */
const NIVEL_TESELADO = 3;

/**
 * Material de piel: algo de brillo suave en ángulos rasantes (sheen) y un rojo leve en las
 * sombras, para que no parezca plástico.
 */
function materialPiel(color: string, mapa?: THREE.Texture): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    map: mapa ?? null,
    roughness: 0.62,
    metalness: 0,
    sheen: 0.35,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color("#ffd2c2"),
    specularIntensity: 0.35,
  });
}

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

