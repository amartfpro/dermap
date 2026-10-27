import { desplegable } from "../ui/desplegable";
import { plural, t } from "../i18n";
import type { IContentRenderer } from "dockview-core";
import { app } from "../estado";
import { MODOS_FUSION, nuevoId, type Capa, type GrupoCapas, type ModoFusion } from "../lienzo/capa";
import type { Lienzo } from "../lienzo/lienzo";
import { simetriaActual } from "../geometria/simetria";
import { confirmar } from "../dialogos";
import { duplicarLienzo, eliminarNodo } from "../proyectos/gestor";
import type { NodoLienzo } from "../proyectos/modelo";
import type { ProyectoAbierto } from "../proyectos/proyecto";
import { transferirDibujo } from "../lienzo/transferir";
import { abrirDialogoTexto } from "./texto";
import { abrirDialogoFiltro } from "./filtro";
import { panelLienzoActual } from "./lienzo";
import { botonIcono, icono, type NombreIcono } from "../ui/iconos";
import { botonMenu, type ElementoMenu } from "../ui/menu";
import { campoDeslizante } from "../ui/campo";

type Arrastre = { tipo: "lienzo"; id: string } | { tipo: "grupo"; lienzo: Lienzo; grupo: GrupoCapas } | { tipo: "capa"; lienzo: Lienzo; capa: Capa };
type Destino =
  | { tipo: "lienzo"; nodo: NodoLienzo; lienzo: Lienzo | undefined }
  | { tipo: "grupo"; lienzo: Lienzo; grupo: GrupoCapas }
  | { tipo: "capa"; lienzo: Lienzo; capa: Capa };
type Zona = "encima" | "debajo" | "dentro";

/**
 * Panel Capas (RF-31): los lienzos del proyecto, cada uno con sus capas y grupos de capas.
 * Pulsar un lienzo lo abre para dibujar; se crean, duplican, agrupan, ocultan, bloquean y
 * reordenan capas, grupos y lienzos arrastrando. También importa imágenes PNG/JPG como capa
 * nueva (RF-33). Todos los cambios de estructura de un lienzo se pueden deshacer.
 */
export class PanelCapas implements IContentRenderer {
  readonly element: HTMLElement;
  private lista: HTMLUListElement;
  private propiedades: HTMLElement;
  private lienzo: Lienzo | null = null;
  /** Qué representa cada fila de la lista (para soltar encima). */
  private destinoDe = new WeakMap<HTMLElement, Destino>();
  /** Tras soltar un arrastre se ignora el clic que lo acompaña. */
  private ignorarClic = false;
  private ultimoClic: { clave: string; t: number } | null = null;
  /** Lienzos no activos que el usuario ha desplegado para ver sus capas. */
  private desplegados = new Set<string>();
  private proyecto: ProyectoAbierto | null = null;
  private alCambiarProyecto = () => {
    this.proyecto?.removeEventListener("arbol", this.alCambiarCapas);
    this.proyecto = app.proyecto;
    this.proyecto?.addEventListener("arbol", this.alCambiarCapas);
    this.pintar();
  };
  private alCambiarActivo = () => this.mostrar(app.activo);
  private alCambiarCapas = () => this.pintar();

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "panel panel-capas";

    const barra = document.createElement("div");
    barra.className = "pie-iconos";
    const archivo = document.createElement("input");
    archivo.type = "file";
    archivo.accept = "image/png,image/jpeg";
    archivo.hidden = true;
    archivo.addEventListener("change", () => {
      const f = archivo.files?.[0];
      archivo.value = "";
      // Sin el foco en el campo de archivo, Intro y Esc llegan a la imagen colocada.
      archivo.blur();
      if (f) void this.importar(f);
    });
    const sep = () => Object.assign(document.createElement("span"), { className: "separador-control" });
    const hueco = Object.assign(document.createElement("span"), { className: "hueco" });
    barra.append(
      botonIcono("imagen", t("Importar un PNG o JPG como capa nueva"), () => archivo.click()),
      botonIcono("texto", t("Texto a tamaño real (T)"), () => abrirDialogoTexto()),
      botonIcono("stencil", t("Convertir la capa activa (foto o boceto) en líneas o en blanco y negro"), () => abrirDialogoFiltro()),
      botonMenu("traer", t("Traer el dibujo de otro lienzo (misma piel o en espejo)"), () => this.menuTraer()),
      sep(),
      botonIcono("copiar", t("Copiar la capa activa (Ctrl+C)"), () => void panelLienzoActual()?.copiar()),
      botonIcono("pegar", t("Pegar la capa copiada, en este u otro lienzo (Ctrl+V)"), () => panelLienzoActual()?.pegar()),
      hueco,
      archivo,
    );

    this.propiedades = document.createElement("div");
    this.propiedades.className = "propiedades-capa";

    this.lista = document.createElement("ul");
    this.lista.className = "lista-capas";

    this.element.append(this.propiedades, this.lista, barra);
    app.addEventListener("activo", this.alCambiarActivo);
    app.addEventListener("proyecto", this.alCambiarProyecto);
    app.addEventListener("lienzos", this.alCambiarCapas);
    this.alCambiarProyecto();
    this.mostrar(app.activo);
    window.addEventListener("keydown", this.alTecla);
  }

  /** Ctrl+G: agrupar la capa activa (si el foco no está escribiendo en un campo). */
  private alTecla = (e: KeyboardEvent) => {
    const enCampo = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    if (enCampo || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "g" || !this.lienzo) return;
    e.preventDefault();
    this.agrupar();
  };

  init(): void {}

  dispose(): void {
    app.removeEventListener("activo", this.alCambiarActivo);
    app.removeEventListener("proyecto", this.alCambiarProyecto);
    app.removeEventListener("lienzos", this.alCambiarCapas);
    window.removeEventListener("keydown", this.alTecla);
    this.proyecto?.removeEventListener("arbol", this.alCambiarCapas);
    this.lienzo?.removeEventListener("capas", this.alCambiarCapas);
  }

  private mostrar(lienzo: Lienzo | null): void {
    this.lienzo?.removeEventListener("capas", this.alCambiarCapas);
    this.lienzo = lienzo;
    lienzo?.addEventListener("capas", this.alCambiarCapas);
    this.pintar();
  }

  // ── Acciones (todas registran un paso de historial antes de cambiar) ─────────

  private conPaso(descripcion: string, accion: (l: Lienzo) => void, lienzo: Lienzo | null = this.lienzo): void {
    const l = lienzo;
    if (!l) return;
    l.historial.registrar(l.doc.instantaneaCapas(descripcion));
    accion(l);
  }

  private nueva(lienzo: Lienzo | null = this.lienzo): void {
    if (lienzo && lienzo !== this.lienzo) app.abrir(lienzo);
    this.conPaso("Nueva capa", (l) => l.doc.añadirCapa(), lienzo);
  }

  /** Grupo nuevo con una capa nueva dentro, arriba del lienzo. */
  private nuevoGrupo(l: Lienzo): void {
    if (l !== this.lienzo) app.abrir(l);
    this.conPaso("Nuevo grupo", (lz) => {
      const capa = lz.doc.añadirCapa(undefined, lz.doc.capas[lz.doc.capas.length - 1]);
      lz.doc.colocarCapa(capa, null, "encima", null);
      lz.doc.agrupar(capa);
    }, l);
  }

  private nuevaEnGrupo(l: Lienzo, grupo: GrupoCapas): void {
    if (l !== this.lienzo) app.abrir(l);
    const suyas = l.doc.capasDe(grupo);
    this.conPaso("Nueva capa", (lz) => lz.doc.añadirCapa(undefined, suyas[suyas.length - 1]), l);
  }

  private duplicar(l: Lienzo | null = this.lienzo, origen: Capa | undefined = l?.doc.activa): void {
    if (!l || !origen) return;
    if (l !== this.lienzo) app.abrir(l);
    this.conPaso("Duplicar capa", (lz) => {
      const copia = origen.duplicar(nuevoId(), t("{nombre} copia", { nombre: origen.nombre }));
      copia.grupo = origen.grupo;
      lz.doc.insertarCapa(copia, lz.doc.capas.indexOf(origen) + 1);
    }, l);
  }

  private agrupar(l: Lienzo | null = this.lienzo, capa: Capa | undefined = l?.doc.activa): void {
    if (!l || !capa || capa.grupo) return;
    if (l !== this.lienzo) app.abrir(l);
    this.conPaso("Agrupar", (lz) => lz.doc.agrupar(capa), l);
  }

  private async eliminarGrupo(l: Lienzo, grupo: GrupoCapas): Promise<void> {
    const n = l.doc.capasDe(grupo).length;
    if (n >= l.doc.capas.length) {
      window.alert(t("Un lienzo necesita al menos una capa: crea otra antes de eliminar este grupo."));
      return;
    }
    if (!(await confirmar(plural(n, "¿Eliminar el grupo «{nombre}» y su capa?", "¿Eliminar el grupo «{nombre}» y sus {n} capas?").replace("{nombre}", grupo.nombre)))) return;
    this.conPaso("Eliminar grupo", (lz) => lz.doc.eliminarGrupo(grupo), l);
  }

  private eliminarCapa(l: Lienzo, capa: Capa): void {
    if (l.doc.capas.length <= 1) {
      window.alert(t("Un lienzo necesita al menos una capa."));
      return;
    }
    this.conPaso("Eliminar capa", (lz) => lz.doc.eliminarCapa(capa), l);
  }

  private cambiar(
    capa: Capa,
    cambios: Partial<Pick<Capa, "nombre" | "visible" | "bloqueada" | "opacidad" | "modo" | "enStencil">>,
    descripcion: string,
    lienzo: Lienzo | null = this.lienzo,
  ): void {
    this.conPaso(descripcion, (l) => l.doc.cambiarCapa(capa, cambios), lienzo);
  }

  private cambiarGrupo(
    l: Lienzo,
    grupo: GrupoCapas,
    cambios: Partial<Pick<GrupoCapas, "nombre" | "visible" | "bloqueado" | "opacidad">>,
    descripcion: string,
  ): void {
    this.conPaso(descripcion, (lz) => lz.doc.cambiarGrupo(grupo, cambios), l);
  }

  private async importar(archivo: File): Promise<void> {
    if (!this.lienzo) return;
    try {
      const imagen = await createImageBitmap(archivo);
      panelLienzoActual()?.colocarImagen(imagen, archivo.name);
    } catch {
      window.alert(t("No se pudo abrir «{archivo}». Usa una imagen PNG o JPG.", { archivo: archivo.name }));
    }
  }

  /**
   * «Traer dibujo de…»: lista los demás lienzos del proyecto que comparten piel con el
   * activo y copia su dibujo a una capa nueva, recolocado a través del cuerpo (RF-29).
   */
  private menuTraer(): ElementoMenu[] {
    const actual = this.lienzo;
    if (!actual) return [{ texto: t("Sin lienzo abierto"), deshabilitado: true }];
    const propios = new Set(actual.zona.triangulos);
    const sim = simetriaActual();
    const reflejados = sim ? new Set(Array.from(actual.zona.triangulos, (tri) => sim.triangulos[tri])) : null;
    const directos: ElementoMenu[] = [];
    const espejos: ElementoMenu[] = [];
    for (const otro of app.lienzos) {
      if (otro === actual) continue;
      let comunes = 0, enEspejo = 0;
      for (const tri of otro.zona.triangulos) {
        if (propios.has(tri)) comunes++;
        if (reflejados?.has(tri)) enEspejo++;
      }
      const pct = Math.round((100 * comunes) / propios.size);
      directos.push({
        texto: otro.nombre,
        detalle: comunes ? t("{pct} % común", { pct }) : t("no coincide"),
        deshabilitado: comunes === 0,
        accion: () => this.traer(otro, false),
      });
      // La zona simétrica (el otro brazo, la otra pierna…) se ofrece en espejo.
      if (enEspejo > propios.size * 0.05)
        espejos.push({
          texto: otro.nombre,
          icono: "espejo",
          detalle: `${Math.round((100 * enEspejo) / propios.size)} %`,
          accion: () => this.traer(otro, true),
        });
    }
    if (!directos.length) return [{ texto: t("No hay otros lienzos"), deshabilitado: true }];
    return [
      { titulo: t("Misma piel") },
      ...directos,
      ...(espejos.length ? (["separador", { titulo: t("En espejo (lado contrario)") }, ...espejos] as ElementoMenu[]) : []),
    ];
  }

  private traer(origen: Lienzo, espejo: boolean): void {
    if (!this.lienzo) return;
    const sim = espejo ? simetriaActual() : null;
    if (espejo && !sim) return;
    const { comunes, total } = transferirDibujo(origen, this.lienzo, sim ?? undefined);
    const nombre = espejo ? t("{lienzo} (espejo)", { lienzo: origen.nombre }) : origen.nombre;
    if (comunes < total) {
      const fuera = Math.round((100 * (total - comunes)) / total);
      this.aviso(t("Dibujo traído de «{lienzo}». El {pct} % de esta zona no estaba en el original y queda vacío.", { lienzo: nombre, pct: fuera }));
    } else this.aviso(t("Dibujo traído de «{lienzo}».", { lienzo: nombre }));
  }

  private aviso(texto: string): void {
    this.propiedades.title = texto;
    const p = document.createElement("p");
    p.className = "aviso-capas";
    p.textContent = texto;
    this.element.querySelector(".aviso-capas")?.remove();
    this.propiedades.after(p);
    setTimeout(() => p.remove(), 8000);
  }

  // ── Pintado ───────────────────────────────────────────────────────────────────

  private pintar(): void {
    // Al repintar se conserva el desplazamiento de la lista.
    const scroll = this.lista.scrollTop;
    this.lista.replaceChildren();
    this.propiedades.replaceChildren();
    this.pintarLista();
    this.lista.scrollTop = scroll;
    const l = this.lienzo;
    if (!l) return;
    const grupo = l.doc.grupoSeleccionado;
    if (grupo) return this.propiedadesGrupo(l, grupo);
    const activa = l.doc.activa;

    // Propiedades de la capa activa: modo de fusión, opacidad y si va al stencil.
    let pasoRegistrado = false;
    const opacidad = campoDeslizante(t("Opacidad"), t("Opacidad de la capa"), 0, 100, (v) => {
      // Un único paso de historial por arrastre.
      if (!pasoRegistrado) l.historial.registrar(l.doc.instantaneaCapas("Opacidad de capa"));
      pasoRegistrado = true;
      const valor = Math.round(v);
      opacidad.fijar(v, `${valor} %`);
      l.doc.cambiarCapa(activa, { opacidad: valor / 100 });
    });
    opacidad.fijar(activa.opacidad * 100, `${Math.round(activa.opacidad * 100)} %`);
    const modo = desplegable(
      MODOS_FUSION.map((m) => ({ valor: m.modo, texto: t(m.nombre) })),
      activa.modo,
      t("Modo de fusión"),
    );
    modo.addEventListener("change", () => this.cambiar(activa, { modo: modo.value as ModoFusion }, "Modo de fusión"));
    const stencil = document.createElement("label");
    stencil.className = "casilla con-conmutador";
    stencil.title = t("Si está activado, la capa sale al exportar el stencil. Desactívalo en fotos de referencia, bocetos o guías.");
    const casilla = document.createElement("input");
    casilla.type = "checkbox";
    casilla.className = "conmutador";
    casilla.setAttribute("role", "switch");
    casilla.checked = activa.enStencil;
    casilla.addEventListener("change", () => this.cambiar(activa, { enStencil: casilla.checked }, "Capa en stencil"));
    stencil.append(casilla, t("En el stencil"));
    this.propiedades.append(modo, opacidad.el, stencil);
  }

  /** Propiedades del grupo seleccionado: opacidad y desagrupar. */
  private propiedadesGrupo(l: Lienzo, grupo: GrupoCapas): void {
    let pasoRegistrado = false;
    const opacidad = campoDeslizante(t("Opacidad"), t("Opacidad del grupo (se aplica a todas sus capas)"), 0, 100, (v) => {
      if (!pasoRegistrado) l.historial.registrar(l.doc.instantaneaCapas("Opacidad de grupo"));
      pasoRegistrado = true;
      const valor = Math.round(v);
      opacidad.fijar(v, `${valor} %`);
      l.doc.cambiarGrupo(grupo, { opacidad: valor / 100 });
    });
    opacidad.fijar(grupo.opacidad * 100, `${Math.round(grupo.opacidad * 100)} %`);
    const desagrupar = botonIcono("desagrupar", t("Desagrupar: las capas salen del grupo y quedan en su sitio"), () =>
      this.conPaso("Desagrupar", (lz) => lz.doc.desagrupar(grupo), l),
      { texto: t("Desagrupar") },
    );
    // Las mismas tres casillas que con una capa: al pasar de capa a grupo nada salta de sitio.
    const etiqueta = document.createElement("span");
    etiqueta.className = "etiqueta-grupo";
    etiqueta.append(icono("grupoAbierto", 14), grupo.nombre);
    etiqueta.title = grupo.nombre;
    this.propiedades.append(etiqueta, opacidad.el, desagrupar);
  }

  /**
   * Los lienzos del proyecto (el de arriba se dibuja encima en el 3D) con sus grupos y capas
   * dentro, de arriba abajo. El lienzo activo siempre está desplegado; los demás, si se pide.
   */
  private pintarLista(): void {
    const p = app.proyecto;
    if (!p) return;
    const nodos = p.nodosLienzo();
    if (!nodos.length) {
      const aviso = document.createElement("li");
      aviso.className = "aviso";
      aviso.textContent = t("Proyecto vacío. Selecciona una zona en la columna Modelo y pulsa «Mapear zona» para crear el primer lienzo: un tatuaje nuevo, uno existente o una cicatriz.");
      this.lista.append(aviso);
      return;
    }
    for (const nodo of [...nodos].reverse()) {
      const lienzo = p.lienzos.get(nodo.id);
      const abierto = lienzo ? lienzo === this.lienzo || this.desplegados.has(nodo.id) : false;
      this.lista.append(this.filaLienzo(nodo, lienzo, abierto));
      if (!lienzo || !abierto) continue;
      const vistos = new Set<GrupoCapas>();
      for (const capa of [...lienzo.doc.capas].reverse()) {
        const g = capa.grupo;
        if (g && !vistos.has(g)) {
          vistos.add(g);
          this.lista.append(this.filaGrupo(lienzo, g));
        }
        if (!g || g.abierto) this.lista.append(this.filaCapa(lienzo, capa));
      }
    }
  }

  private filaLienzo(nodo: NodoLienzo, lienzo: Lienzo | undefined, abierto: boolean): HTMLElement {
    const p = app.proyecto!;
    const li = document.createElement("li");
    li.className = "fila-lienzo" + (lienzo && lienzo === this.lienzo ? " activa" : "") + (nodo.visible ? "" : " oculta");
    li.dataset.id = nodo.id;
    const fallo = p.noAbiertos.get(nodo.id);
    if (fallo) {
      li.classList.add("dañada");
      li.title = t("No se pudo abrir: {error}", { error: fallo });
    }
    const flecha = iconoBoton(abierto ? "plegar" : "desplegar", abierto ? t("Plegar") : t("Desplegar"), () => {
      if (lienzo === this.lienzo) return;
      if (this.desplegados.has(nodo.id)) this.desplegados.delete(nodo.id);
      else this.desplegados.add(nodo.id);
      this.pintar();
    });
    flecha.classList.add("flecha");
    const ojo = iconoBoton(nodo.visible ? "ojo" : "ojoCerrado", nodo.visible ? t("Ocultar en el 3D") : t("Mostrar en el 3D"), () => p.alternarVisible(nodo.id));
    ojo.classList.toggle("tenue", !nodo.visible);
    const tipo = document.createElement("span");
    tipo.className = "tipo";
    const manga = lienzo?.zona.aplanado.tipo === "manga";
    tipo.append(icono(manga ? "recta" : "zona", 14));
    tipo.title = manga ? t("Manga (con corte)") : t("Parche");
    const nombre = document.createElement("span");
    nombre.className = "nombre";
    nombre.textContent = fallo ? t("{nombre} (no se pudo abrir)", { nombre: nodo.nombre }) : nodo.nombre;
    this.alDobleClic(nombre, `lienzo:${nodo.id}`, () => this.renombrarLienzo(nodo, nombre));
    const detalle = document.createElement("span");
    detalle.className = "detalle";
    if (lienzo) detalle.textContent = String(lienzo.doc.capas.length);
    detalle.title = lienzo ? plural(lienzo.doc.capas.length, "{n} capa", "{n} capas") : "";
    const acciones = document.createElement("span");
    acciones.className = "acciones-fila";
    if (lienzo)
      acciones.append(
        iconoBoton("mas", t("Nueva capa en este lienzo"), () => this.nueva(lienzo)),
        iconoBoton("agrupar", t("Nuevo grupo con una capa nueva"), () => this.nuevoGrupo(lienzo)),
      );
    acciones.append(
      iconoBoton("duplicar", t("Duplicar el lienzo (para probar otra versión del diseño)"), () => void duplicarLienzo(nodo.id)),
      iconoBoton("borrar", t("Eliminar el lienzo"), async () => {
        if (await confirmar(t("¿Eliminar el lienzo «{nombre}»? No se puede deshacer.", { nombre: nodo.nombre }))) await eliminarNodo(nodo.id);
      }),
    );
    li.append(flecha, ojo, tipo, nombre, detalle, acciones);
    li.addEventListener("click", () => {
      if (!lienzo || this.ignorarClic) return;
      app.abrir(lienzo);
      // Pulsar el lienzo selecciona su capa activa (no un grupo).
      if (lienzo.doc.grupoSeleccionado) lienzo.doc.seleccionarCapa(lienzo.doc.activa);
    });
    this.arrastrable(li, { tipo: "lienzo", id: nodo.id });
    this.soltable(li, { tipo: "lienzo", nodo, lienzo });
    return li;
  }

  private filaGrupo(l: Lienzo, grupo: GrupoCapas): HTMLElement {
    const li = document.createElement("li");
    const seleccionado = l === this.lienzo && l.doc.grupoSeleccionado === grupo;
    li.className = "fila-grupo-capas" + (seleccionado ? " activa" : "") + (grupo.visible ? "" : " oculta");
    const flecha = iconoBoton(grupo.abierto ? "plegar" : "desplegar", grupo.abierto ? t("Plegar") : t("Desplegar"), () =>
      l.doc.cambiarGrupo(grupo, { abierto: !grupo.abierto }),
    );
    flecha.classList.add("flecha");
    const ojo = iconoBoton(grupo.visible ? "ojo" : "ojoCerrado", grupo.visible ? t("Ocultar el grupo") : t("Mostrar el grupo"), () =>
      this.cambiarGrupo(l, grupo, { visible: !grupo.visible }, grupo.visible ? "Ocultar grupo" : "Mostrar grupo"),
    );
    ojo.classList.toggle("tenue", !grupo.visible);
    const candado = iconoBoton(grupo.bloqueado ? "candado" : "candadoAbierto", grupo.bloqueado ? t("Desbloquear el grupo") : t("Bloquear el grupo"), () =>
      this.cambiarGrupo(l, grupo, { bloqueado: !grupo.bloqueado }, grupo.bloqueado ? "Desbloquear grupo" : "Bloquear grupo"),
    );
    candado.classList.toggle("tenue", !grupo.bloqueado);
    const tipo = document.createElement("span");
    tipo.className = "tipo";
    tipo.append(icono(grupo.abierto ? "grupoAbierto" : "grupo", 14));
    const nombre = document.createElement("span");
    nombre.className = "nombre";
    nombre.textContent = grupo.nombre;
    this.alDobleClic(nombre, `grupo:${grupo.id}`, () =>
      this.renombrarCampo(nombre, grupo.nombre, (nuevo) => this.cambiarGrupo(l, grupo, { nombre: nuevo }, "Renombrar grupo")),
    );
    const detalle = document.createElement("span");
    detalle.className = "detalle";
    const n = l.doc.capasDe(grupo).length;
    const partes = [String(n)];
    if (grupo.opacidad < 1) partes.unshift(`${Math.round(grupo.opacidad * 100)} %`);
    detalle.textContent = partes.join(" · ");
    detalle.title = plural(n, "{n} capa", "{n} capas");
    const acciones = document.createElement("span");
    acciones.className = "acciones-fila";
    acciones.append(
      iconoBoton("transformar", t("Transformar el grupo: mover, escalar, girar y voltear (Ctrl+T)"), () => {
        if (l !== this.lienzo) app.abrir(l);
        l.doc.seleccionarGrupo(grupo);
        void panelLienzoActual()?.transformar();
      }),
      iconoBoton("mas", t("Nueva capa en este grupo"), () => this.nuevaEnGrupo(l, grupo)),
      iconoBoton("desagrupar", t("Desagrupar: las capas salen del grupo y quedan en su sitio"), () => this.conPaso("Desagrupar", (lz) => lz.doc.desagrupar(grupo), l)),
      iconoBoton("borrar", t("Eliminar el grupo con sus capas"), () => void this.eliminarGrupo(l, grupo)),
    );
    li.append(flecha, ojo, candado, tipo, nombre, detalle, acciones);
    li.addEventListener("click", () => {
      if (this.ignorarClic) return;
      if (l !== this.lienzo) app.abrir(l);
      l.doc.seleccionarGrupo(grupo);
    });
    this.arrastrable(li, { tipo: "grupo", lienzo: l, grupo });
    this.soltable(li, { tipo: "grupo", lienzo: l, grupo });
    return li;
  }

  private filaCapa(l: Lienzo, capa: Capa): HTMLElement {
    const activa = l === this.lienzo && capa === l.doc.activa && !l.doc.grupoSeleccionado;
    const li = document.createElement("li");
    li.className = "fila-capa" + (activa ? " activa" : "") + (capa.grupo ? " en-grupo" : "") + (capa.seVe ? "" : " oculta");
    const ojo = iconoBoton(capa.visible ? "ojo" : "ojoCerrado", capa.visible ? t("Ocultar") : t("Mostrar"), () =>
      this.cambiar(capa, { visible: !capa.visible }, capa.visible ? "Ocultar capa" : "Mostrar capa", l),
    );
    const candado = iconoBoton(capa.bloqueada ? "candado" : "candadoAbierto", capa.bloqueada ? t("Desbloquear") : t("Bloquear"), () =>
      this.cambiar(capa, { bloqueada: !capa.bloqueada }, capa.bloqueada ? "Desbloquear capa" : "Bloquear capa", l),
    );
    candado.classList.toggle("tenue", !capa.bloqueada);
    ojo.classList.toggle("tenue", !capa.visible);
    const nombre = document.createElement("span");
    nombre.className = "nombre";
    nombre.textContent = capa.nombre;
    this.alDobleClic(nombre, `capa:${capa.id}`, () =>
      this.renombrarCampo(nombre, capa.nombre, (nuevo) => this.cambiar(capa, { nombre: nuevo }, "Renombrar capa", l)),
    );
    const detalle = document.createElement("span");
    detalle.className = "detalle";
    const partes = [];
    if (capa.opacidad < 1) partes.push(`${Math.round(capa.opacidad * 100)} %`);
    if (capa.modo !== "normal") partes.push(t(MODOS_FUSION.find((m) => m.modo === capa.modo)!.nombre));
    if (!capa.enStencil) partes.push(t("sin stencil"));
    detalle.textContent = partes.join(" · ");
    const acciones = document.createElement("span");
    acciones.className = "acciones-fila";
    if (!capa.grupo) acciones.append(iconoBoton("agrupar", t("Agrupar: mete esta capa en un grupo nuevo (Ctrl+G)"), () => this.agrupar(l, capa)));
    acciones.append(
      iconoBoton("transformar", t("Transformar la capa: mover, escalar, girar y voltear (Ctrl+T)"), () => {
        if (l !== this.lienzo) app.abrir(l);
        l.doc.seleccionarCapa(capa);
        void panelLienzoActual()?.transformar();
      }),
      iconoBoton("duplicar", t("Duplicar la capa (Ctrl+J)"), () => this.duplicar(l, capa)),
      iconoBoton("borrar", t("Eliminar la capa"), () => this.eliminarCapa(l, capa)),
    );
    li.append(ojo, candado, nombre, detalle, acciones);
    li.addEventListener("click", () => {
      if (this.ignorarClic) return;
      if (l !== this.lienzo) app.abrir(l);
      l.doc.seleccionarCapa(capa);
    });
    this.arrastrable(li, { tipo: "capa", lienzo: l, capa });
    this.soltable(li, { tipo: "capa", lienzo: l, capa });
    return li;
  }

  // ── Arrastrar y soltar ────────────────────────────────────────────────────────
  // Con eventos de puntero (no el arrastrar y soltar HTML5): en la aplicación de escritorio el
  // sistema se queda los arrastres de la ventana para soltar archivos y el HTML5 no funciona.

  private arrastrable(li: HTMLElement, arrastre: Arrastre): void {
    li.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest("button, input")) return;
      const x0 = e.clientX, y0 = e.clientY;
      let fantasma: HTMLElement | null = null;
      let accion: ReturnType<PanelCapas["resolver"]> = null;
      const mover = (ev: PointerEvent) => {
        if (!fantasma) {
          if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
          // Empieza el arrastre: una copia de la fila sigue al puntero.
          li.classList.add("arrastrando");
          const r = li.getBoundingClientRect();
          fantasma = li.cloneNode(true) as HTMLElement;
          fantasma.classList.add("fantasma-fila");
          fantasma.style.width = `${r.width}px`;
          document.body.append(fantasma);
          document.body.classList.add("arrastrando-fila");
        }
        fantasma.style.transform = `translate(${ev.clientX + 8}px, ${ev.clientY - 14}px)`;
        this.desplazarSiHaceFalta(ev.clientY);
        this.limpiarIndicador();
        accion = null;
        const fila = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest("li");
        const destino = fila && this.lista.contains(fila) ? this.destinoDe.get(fila) : undefined;
        if (!fila || !destino) return;
        const r = fila.getBoundingClientRect();
        accion = this.resolver(arrastre, destino, (ev.clientY - r.top) / r.height, fila);
        accion?.fila.classList.add(`soltar-${accion.zona}`);
      };
      const soltar = () => {
        window.removeEventListener("pointermove", mover);
        window.removeEventListener("pointerup", soltar);
        window.removeEventListener("pointercancel", soltar);
        if (!fantasma) return;
        fantasma.remove();
        document.body.classList.remove("arrastrando-fila");
        li.classList.remove("arrastrando");
        this.limpiarIndicador();
        // El clic que llega al soltar no debe seleccionar la fila.
        this.ignorarClic = true;
        setTimeout(() => (this.ignorarClic = false));
        accion?.hacer();
      };
      window.addEventListener("pointermove", mover);
      window.addEventListener("pointerup", soltar);
      window.addEventListener("pointercancel", soltar);
    });
  }

  private soltable(li: HTMLElement, destino: Destino): void {
    this.destinoDe.set(li, destino);
  }

  /** Cerca del borde de la lista, la lista se desplaza sola mientras se arrastra. */
  private desplazarSiHaceFalta(y: number): void {
    const r = this.lista.getBoundingClientRect();
    if (y < r.top + 28) this.lista.scrollTop -= 10;
    else if (y > r.bottom - 28) this.lista.scrollTop += 10;
  }

  private limpiarIndicador(): void {
    for (const el of this.lista.querySelectorAll(".soltar-encima, .soltar-debajo, .soltar-dentro"))
      el.classList.remove("soltar-encima", "soltar-debajo", "soltar-dentro");
  }

  /**
   * Qué pasa al soltar `a` sobre la fila `d` a la altura relativa `y` (0 arriba, 1 abajo):
   * la fila que se marca, cómo (línea encima o debajo, o dentro) y la acción. null: no se puede.
   */
  private resolver(a: Arrastre, d: Destino, y: number, aqui: HTMLElement): { fila: HTMLElement; zona: Zona; hacer: () => void } | null {
    const p = app.proyecto;
    if (!p) return null;
    const mitad = y < 0.5 ? "encima" : "debajo";
    const tercios: Zona = y < 0.3 ? "encima" : y > 0.7 ? "debajo" : "dentro";

    // Lienzos: se reordenan entre sí (encima en la lista = se dibuja encima en el 3D).
    if (a.tipo === "lienzo") {
      if (d.tipo !== "lienzo" || d.nodo.id === a.id) return null;
      const zona = mitad;
      return {
        fila: aqui,
        zona,
        hacer: () => {
          const orden = p.nodosLienzo().map((n) => n.id).filter((x) => x !== a.id);
          const i = orden.indexOf(d.nodo.id);
          const siguiente = zona === "encima" ? (orden[i + 1] ?? null) : d.nodo.id;
          p.mover(a.id, null, siguiente);
        },
      };
    }

    // Capas y grupos solo se mueven dentro de su lienzo.
    const l = a.lienzo;
    if (d.lienzo !== l) return null;
    const doc = l.doc;
    const arriba = (g: GrupoCapas) => doc.capasDe(g)[doc.capasDe(g).length - 1];
    const abajo = (g: GrupoCapas) => doc.capasDe(g)[0];
    const conPaso = (descripcion: string, f: () => void) => () => this.conPaso(descripcion, f, l);

    if (a.tipo === "capa") {
      const c = a.capa;
      if (d.tipo === "lienzo") return { fila: aqui, zona: "dentro", hacer: conPaso("Mover capa", () => doc.colocarCapa(c, null, "encima", null)) };
      if (d.tipo === "capa") {
        if (d.capa === c) return null;
        return { fila: aqui, zona: mitad, hacer: conPaso("Mover capa", () => doc.colocarCapa(c, d.capa, mitad, d.capa.grupo)) };
      }
      const g = d.grupo;
      if (tercios === "encima") return { fila: aqui, zona: "encima", hacer: conPaso("Mover capa", () => doc.colocarCapa(c, arriba(g), "encima", null)) };
      if (tercios === "debajo" && !g.abierto)
        return { fila: aqui, zona: "debajo", hacer: conPaso("Mover capa", () => doc.colocarCapa(c, abajo(g), "debajo", null)) };
      return { fila: aqui, zona: "dentro", hacer: conPaso("Meter en el grupo", () => doc.colocarCapa(c, arriba(g), "encima", g)) };
    }

    // Grupo: se mueve entero, nunca dentro de otro grupo.
    const g = a.grupo;
    if (d.tipo === "lienzo") return { fila: aqui, zona: "dentro", hacer: conPaso("Mover grupo", () => doc.colocarGrupo(g, null, "encima")) };
    const otro = d.tipo === "grupo" ? d.grupo : d.capa.grupo;
    if (otro === g) return null;
    if (otro) {
      // Sobre otro grupo (su cabecera o sus capas): encima o debajo del grupo entero.
      const zona = d.tipo === "grupo" ? (y < 0.5 ? "encima" : "debajo") : mitad;
      const filaGrupo = d.tipo === "grupo" ? aqui : ([...this.lista.children] as HTMLElement[]).find((f) => {
        const x = this.destinoDe.get(f);
        return x?.tipo === "grupo" && x.grupo === otro;
      }) ?? aqui;
      return {
        fila: zona === "encima" ? filaGrupo : aqui,
        zona,
        hacer: conPaso("Mover grupo", () => (zona === "encima" ? doc.colocarGrupo(g, arriba(otro), "encima") : doc.colocarGrupo(g, abajo(otro), "debajo"))),
      };
    }
    const capa = (d as { capa: Capa }).capa;
    return { fila: aqui, zona: mitad, hacer: conPaso("Mover grupo", () => doc.colocarGrupo(g, capa, mitad)) };
  }

  private renombrarLienzo(nodo: NodoLienzo, span: HTMLElement): void {
    const campo = document.createElement("input");
    campo.className = "campo-nombre";
    campo.value = nodo.nombre;
    span.replaceWith(campo);
    campo.focus();
    campo.select();
    let hecho = false;
    const terminar = (guardar: boolean) => {
      if (hecho) return;
      hecho = true;
      const nuevo = campo.value.trim();
      if (guardar && nuevo && nuevo !== nodo.nombre) app.proyecto?.renombrar(nodo.id, nuevo);
      else this.pintar();
    };
    campo.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") terminar(true);
      if (e.key === "Escape") terminar(false);
    });
    campo.addEventListener("click", (e) => e.stopPropagation());
    campo.addEventListener("blur", () => terminar(true));
  }

  /**
   * Doble clic hecho a mano: el primer clic selecciona la fila y la lista se vuelve a pintar,
   * así que el segundo cae en otro elemento y el «dblclick» del navegador no llega.
   */
  private alDobleClic(nombre: HTMLElement, clave: string, accion: () => void): void {
    nombre.addEventListener("click", (e) => {
      const ahora = performance.now();
      const anterior = this.ultimoClic;
      this.ultimoClic = { clave, t: ahora };
      if (anterior?.clave === clave && ahora - anterior.t < 450 && !this.ignorarClic) {
        e.stopPropagation();
        this.ultimoClic = null;
        accion();
      }
    });
  }

  /** Cambia un texto de la lista por un campo para renombrar (Intro guarda, Esc cancela). */
  private renombrarCampo(span: HTMLElement, actual: string, guardar: (nuevo: string) => void): void {
    const campo = document.createElement("input");
    campo.className = "campo-nombre";
    campo.value = actual;
    span.replaceWith(campo);
    campo.focus();
    campo.select();
    let hecho = false;
    const terminar = (ok: boolean) => {
      if (hecho) return;
      hecho = true;
      const nuevo = campo.value.trim();
      if (ok && nuevo && nuevo !== actual) guardar(nuevo);
      else this.pintar();
    };
    campo.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") terminar(true);
      if (e.key === "Escape") terminar(false);
    });
    campo.addEventListener("click", (e) => e.stopPropagation());
    campo.addEventListener("blur", () => terminar(true));
  }
}

function iconoBoton(nombre: NombreIcono, titulo: string, alPulsar: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "icono";
  b.append(icono(nombre, 15));
  b.title = titulo;
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    alPulsar();
  });
  return b;
}
