import { cambiarIdioma, IDIOMAS, idiomaActual, plural, t } from "../i18n";
import { botonMenu } from "../ui/menu";
import { app } from "../estado";
import { confirmar } from "../dialogos";
import { ALTURA_MAXIMA, ALTURA_MINIMA } from "../modelos/formas";
import type { Medida, Medidas } from "../modelos/medidas";
import {
  abrirProyecto,
  cerrarProyecto,
  crearProyectoCompleto,
  eliminarProyecto,
  exportarProyectoDe,
  importarProyecto,
  proyectos,
  urlImagen,
} from "../proyectos/gestor";
import type { ResumenProyecto } from "../proyectos/proyecto";
import { sistemaArchivos } from "../proyectos/sistema-archivos";
import { TONOS } from "../panels/cuerpo";
import { icono } from "../ui/iconos";
import { firma } from "../ui/firma";

/**
 * Pantalla de inicio (como en Illustrator): proyectos recientes y «Nuevo proyecto», donde se
 * rellenan la ficha del cliente y su cuerpo antes de entrar al espacio de trabajo. Desde la
 * barra superior se vuelve aquí para cambiar de proyecto.
 */
let raiz: HTMLElement | null = null;
const urls: string[] = [];

export function inicioVisible(): boolean {
  return !!raiz;
}

/** Cierra el proyecto (guardando su portada) y muestra la pantalla de inicio. */
export async function volverAlInicio(): Promise<void> {
  if (app.proyecto) await cerrarProyecto();
  mostrarInicio();
}

export function mostrarInicio(vista: "recientes" | "nuevo" = "recientes"): void {
  if (!raiz) {
    raiz = document.createElement("div");
    raiz.className = "inicio";
    document.body.append(raiz);
    document.body.classList.add("en-inicio");
  }
  if (vista === "nuevo") pintarNuevo();
  else void pintarRecientes();
}

export function ocultarInicio(): void {
  raiz?.remove();
  raiz = null;
  document.body.classList.remove("en-inicio");
  for (const u of urls.splice(0)) URL.revokeObjectURL(u);
}

function marco(contenido: HTMLElement, vista: "recientes" | "nuevo" = "recientes"): void {
  if (!raiz) return;
  for (const u of urls.splice(0)) URL.revokeObjectURL(u);
  const lateral = document.createElement("aside");
  lateral.className = "inicio-lateral";
  const marca = document.createElement("div");
  marca.className = "marca inicio-marca";
  marca.textContent = "Dermap";
  const lema = document.createElement("p");
  lema.className = "inicio-lema";
  lema.textContent = t("Planifica sobre la piel.");
  const nuevo = boton("mas", t("Nuevo proyecto"), () => mostrarInicio("nuevo"), "primario grande");
  const importar = boton("abrir", t("Abrir archivo .dermap…"), () => void importar_(), "grande");
  const recientes = boton("capas", t("Proyectos"), () => mostrarInicio("recientes"), "grande" + (vista === "recientes" ? " activo" : ""));
  const nav = document.createElement("nav");
  nav.className = "inicio-nav";
  nav.append(nuevo, recientes, importar);
  const pie = document.createElement("div");
  pie.className = "inicio-pie";
  pie.append(firma());
  lateral.append(marca, lema, nav, pie);
  const principal = document.createElement("main");
  principal.className = "inicio-principal" + (vista === "nuevo" ? " centrado" : "");
  principal.append(contenido);
  raiz.replaceChildren(lateral, principal);
}

async function importar_(): Promise<void> {
  try {
    if (await importarProyecto()) ocultarInicio();
  } catch (error) {
    window.alert(t("No se pudo importar: {error}", { error: error instanceof Error ? error.message : String(error) }));
  }
}

// ── Recientes ─────────────────────────────────────────────────────────────────

async function pintarRecientes(): Promise<void> {
  const cont = document.createElement("div");
  cont.className = "inicio-recientes";
  const cabecera = document.createElement("div");
  cabecera.className = "inicio-cabecera";
  const titulo = document.createElement("h1");
  titulo.textContent = t("Proyectos");
  const buscar = document.createElement("input");
  buscar.type = "text";
  buscar.className = "inicio-buscar";
  buscar.placeholder = t("Buscar por proyecto o cliente…");
  // Idioma, a la derecha del buscador (como en la barra superior del espacio de trabajo).
  const idioma = botonMenu("idioma", t("Idioma"), () =>
    Object.entries(IDIOMAS).map(([codigo, { nombre }]) => ({
      texto: nombre,
      marcado: codigo === idiomaActual(),
      accion: () => cambiarIdioma(codigo),
    })),
  );
  idioma.classList.add("fantasma", "idioma-inicio");
  const derecha = document.createElement("div");
  derecha.className = "inicio-cabecera-derecha";
  derecha.append(buscar, idioma);
  cabecera.append(titulo, derecha);
  const rejilla = document.createElement("div");
  rejilla.className = "inicio-rejilla";
  cont.append(cabecera, rejilla);
  marco(cont);

  const lista = await proyectos().catch(() => [] as ResumenProyecto[]);
  const pintar = () => {
    const q = buscar.value.trim().toLowerCase();
    rejilla.replaceChildren();
    const nueva = document.createElement("button");
    nueva.type = "button";
    nueva.className = "tarjeta-proyecto tarjeta-nueva";
    const mas = document.createElement("span");
    mas.className = "tarjeta-portada";
    mas.append(icono("mas", 28));
    const texto = document.createElement("span");
    texto.className = "tarjeta-nombre";
    texto.textContent = t("Nuevo proyecto");
    nueva.append(mas, texto);
    nueva.addEventListener("click", () => mostrarInicio("nuevo"));
    if (!q) rejilla.append(nueva);
    for (const p of lista) {
      if (q && !`${p.nombre} ${p.cliente}`.toLowerCase().includes(q)) continue;
      rejilla.append(tarjeta(p, () => void pintarRecientes()));
    }
  };
  buscar.addEventListener("input", pintar);
  pintar();
}

function tarjeta(p: ResumenProyecto, alCambiar: () => void): HTMLElement {
  const el = document.createElement("div");
  el.className = "tarjeta-proyecto";
  el.tabIndex = 0;
  const portada = document.createElement("div");
  portada.className = "tarjeta-portada";
  portada.append(icono("capas", 30));
  // Vista previa de los lienzos (hasta cuatro): el diseño, más que el cuerpo.
  if (p.miniaturas.length)
    void Promise.all(p.miniaturas.map(urlImagen)).then((lista) => {
      const imgs = lista.filter((u): u is string => !!u);
      if (!imgs.length) return;
      urls.push(...imgs);
      portada.replaceChildren(
        ...imgs.map((u) => {
          const img = document.createElement("img");
          img.src = u;
          img.alt = "";
          return img;
        }),
      );
      portada.dataset.n = String(imgs.length);
    });
  const nombre = document.createElement("span");
  nombre.className = "tarjeta-nombre";
  nombre.textContent = p.nombre;
  const detalle = document.createElement("span");
  detalle.className = "tarjeta-detalle";
  const partes = [];
  if (p.cliente && p.cliente !== p.nombre) partes.push(p.cliente);
  partes.push(plural(p.lienzos, "{n} lienzo", "{n} lienzos"));
  if (p.modificado) partes.push(fechaRelativa(p.modificado));
  detalle.textContent = partes.join(" · ");

  const acciones = document.createElement("div");
  acciones.className = "tarjeta-acciones";
  const exportar = document.createElement("button");
  exportar.type = "button";
  exportar.className = "icono";
  exportar.title = t("Exportar a un archivo .dermap (copia de seguridad o para otro ordenador)");
  exportar.append(icono("exportar", 15));
  exportar.addEventListener("click", async (e) => {
    e.stopPropagation();
    await exportarProyectoDe(p.carpeta).catch((error) => window.alert(String(error)));
  });
  const borrar = document.createElement("button");
  borrar.type = "button";
  borrar.className = "icono";
  borrar.title = t("Eliminar el proyecto");
  borrar.append(icono("borrar", 15));
  borrar.addEventListener("click", async (e) => {
    e.stopPropagation();
    const ok = await confirmar(
      plural(
        p.lienzos,
        "¿Eliminar el proyecto «{nombre}» y su lienzo? Se borra del disco y no se puede deshacer. Si quieres conservar una copia, usa antes «Exportar…».",
        "¿Eliminar el proyecto «{nombre}» y sus {n} lienzos? Se borra del disco y no se puede deshacer. Si quieres conservar una copia, usa antes «Exportar…».",
      ).replace("{nombre}", p.nombre),
      t("Eliminar proyecto"),
    );
    if (!ok) return;
    await eliminarProyecto(p.carpeta);
    alCambiar();
  });
  acciones.append(exportar, borrar);

  el.append(portada, nombre, detalle, acciones);
  const abrir = async () => {
    el.classList.add("abriendo");
    detalle.textContent = t("Abriendo proyecto…");
    try {
      await abrirProyecto(p.carpeta, (texto) => (detalle.textContent = texto));
      ocultarInicio();
    } catch (error) {
      el.classList.remove("abriendo");
      detalle.textContent = t("No se pudo abrir el proyecto: {error}", { error: error instanceof Error ? error.message : String(error) });
    }
  };
  el.addEventListener("click", () => void abrir());
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void abrir();
  });
  return el;
}

function fechaRelativa(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const dias = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (dias <= 0) return t("hoy");
  if (dias === 1) return t("ayer");
  if (dias < 7) return t("hace {n} días", { n: dias });
  return d.toLocaleDateString(idiomaActual() === "en" ? "en-GB" : "es-ES", { day: "numeric", month: "short", year: "numeric" });
}

// ── Nuevo proyecto ────────────────────────────────────────────────────────────

function pintarNuevo(): void {
  const form = document.createElement("form");
  form.className = "inicio-nuevo";
  const titulo = document.createElement("h1");
  titulo.textContent = t("Nuevo proyecto");
  const intro = document.createElement("p");
  intro.className = "nota";
  intro.textContent = t("Planifica directamente sobre la piel. Ficha, cuerpo y diseños de cada cliente, en un solo proyecto.");
  // Dónde se guardará, en una segunda línea más discreta.
  const donde = document.createElement("p");
  donde.className = "nota tenue";
  void sistemaArchivos()
    .then((fs) => fs.descripcion())
    .then((d) => (donde.textContent = t("Se guarda en {donde}. Puedes cambiarlo todo después.", { donde: d })));

  // Cliente
  const nombre = campoTexto(t("Nombre del proyecto"), "text", "");
  nombre.input.required = true;
  const cliente = campoTexto(t("Cliente"), "text", "");
  const telefono = campoTexto(t("Teléfono"), "tel", "");
  const correo = campoTexto(t("Correo"), "email", "");
  const cita = campoTexto(t("Cita"), "date", "");
  const tarjetaCliente = bloque(t("Cliente"), rejilla(nombre.el, cliente.el, telefono.el, correo.el, cita.el));

  // Cuerpo
  let sexo = 0;
  const sexoSeg = document.createElement("div");
  sexoSeg.className = "segmentado sexo";
  const opcionSexo = (valor: number, texto: string) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "boton-texto";
    b.textContent = texto;
    b.addEventListener("click", () => {
      sexo = valor;
      for (const x of sexoSeg.children) x.classList.toggle("activo", x === b);
    });
    if (valor === sexo) b.classList.add("activo");
    return b;
  };
  sexoSeg.append(opcionSexo(0, t("Mujer")), opcionSexo(1, t("Hombre")));
  const altura = deslizadorConNumero(ALTURA_MINIMA, ALTURA_MAXIMA, 170, "cm");
  const complexion = deslizadorConNumero(0, 100, 50, "%");
  const musculatura = deslizadorConNumero(0, 100, 50, "%");
  let tono = TONOS[2];
  const tonos = document.createElement("div");
  tonos.className = "tonos";
  for (const c of TONOS) {
    const m = document.createElement("button");
    m.type = "button";
    m.className = "muestra" + (c === tono ? " activo" : "");
    m.style.background = c;
    m.title = c;
    m.addEventListener("click", () => {
      tono = c;
      for (const x of tonos.children) x.classList.toggle("activo", x === m);
    });
    tonos.append(m);
  }
  const tarjetaCuerpo = bloque(
    t("Cuerpo"),
    filaCampo(t("Sexo"), sexoSeg),
    filaCampo(t("Altura"), altura.el),
    filaCampo(t("Complexión"), complexion.el),
    filaCampo(t("Musculatura"), musculatura.el),
    filaCampo(t("Tono de piel"), tonos),
  );

  // Medidas (opcionales)
  const NOMBRES: [Medida, string][] = [
    ["brazo", t("Brazo (bíceps)")],
    ["antebrazo", t("Antebrazo")],
    ["muneca", t("Muñeca")],
    ["muslo", t("Muslo")],
    ["gemelo", t("Gemelo")],
    ["tobillo", t("Tobillo")],
  ];
  const camposMedida = NOMBRES.map(([clave, texto]) => {
    const c = campoTexto(`${texto} (cm)`, "number", "");
    c.input.min = "5";
    c.input.max = "120";
    c.input.step = "0.5";
    return { clave, input: c.input, el: c.el };
  });
  const notaMedidas = document.createElement("p");
  notaMedidas.className = "nota";
  notaMedidas.textContent = t("Contornos con cinta métrica. Con ellos el cuerpo se ajusta y los lienzos salen a la escala real del cliente.");
  const tarjetaMedidas = bloque(t("Medidas (opcional)"), notaMedidas, rejilla(...camposMedida.map((c) => c.el)));
  tarjetaMedidas.classList.add("plegable");

  const crear = document.createElement("button");
  crear.type = "submit";
  crear.className = "boton-texto primario grande";
  crear.textContent = t("Crear proyecto");
  const cancelar = document.createElement("button");
  cancelar.type = "button";
  cancelar.className = "boton-texto grande";
  cancelar.textContent = t("Cancelar");
  cancelar.addEventListener("click", () => mostrarInicio("recientes"));
  const estado = document.createElement("span");
  estado.className = "estado-modal";
  const pie = document.createElement("div");
  pie.className = "modal-pie";
  pie.append(estado, cancelar, crear);

  const columnas = document.createElement("div");
  columnas.className = "inicio-columnas";
  const izq = document.createElement("div");
  izq.append(tarjetaCliente, tarjetaMedidas);
  const der = document.createElement("div");
  der.append(tarjetaCuerpo);
  columnas.append(izq, der);
  form.append(titulo, intro, donde, columnas, pie);
  marco(form, "nuevo");
  nombre.input.focus();

  // El cliente se rellena con el nombre del proyecto mientras no se escriba otro.
  let clienteTocado = false;
  cliente.input.addEventListener("input", () => (clienteTocado = true));
  nombre.input.addEventListener("input", () => {
    if (!clienteTocado) cliente.input.value = nombre.input.value;
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const n = nombre.input.value.trim();
    if (!n) return;
    crear.disabled = true;
    estado.textContent = t("Creando proyecto…");
    const medidas: Medidas = {};
    for (const c of camposMedida) {
      const v = Number(c.input.value);
      if (c.input.value !== "" && v > 0) medidas[c.clave] = Math.min(120, Math.max(5, v));
    }
    try {
      await crearProyectoCompleto(
        n,
        { cliente: cliente.input.value.trim() || n, telefono: telefono.input.value.trim(), correo: correo.input.value.trim(), cita: cita.input.value },
        {
          sexo,
          altura: altura.valor(),
          complexion: complexion.valor() / 100,
          musculatura: musculatura.valor() / 100,
          tonoPiel: tono,
          ...(Object.keys(medidas).length ? { medidas } : {}),
        },
      );
      ocultarInicio();
    } catch (error) {
      crear.disabled = false;
      estado.textContent = t("No se pudo crear el proyecto: {error}", { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

// ── Piezas ────────────────────────────────────────────────────────────────────

function boton(nombre: Parameters<typeof icono>[0], texto: string, alPulsar: () => void, clase = ""): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `boton-texto con-icono ${clase}`.trim();
  const s = document.createElement("span");
  s.textContent = texto;
  b.append(icono(nombre), s);
  b.addEventListener("click", alPulsar);
  return b;
}

function campoTexto(etiqueta: string, tipo: string, placeholder: string): { el: HTMLElement; input: HTMLInputElement } {
  const el = document.createElement("label");
  el.className = "campo-ficha";
  const s = document.createElement("span");
  s.textContent = etiqueta;
  const input = document.createElement("input");
  input.type = tipo;
  input.placeholder = placeholder;
  el.append(s, input);
  return { el, input };
}

function bloque(titulo: string, ...hijos: HTMLElement[]): HTMLElement {
  const b = document.createElement("section");
  b.className = "inicio-bloque";
  const h = document.createElement("h2");
  h.textContent = titulo;
  b.append(h, ...hijos);
  return b;
}

function rejilla(...hijos: HTMLElement[]): HTMLElement {
  const r = document.createElement("div");
  r.className = "rejilla-ficha";
  r.append(...hijos);
  return r;
}

function filaCampo(etiqueta: string, control: HTMLElement): HTMLElement {
  const f = document.createElement("div");
  f.className = "fila-campo";
  const s = document.createElement("span");
  s.textContent = etiqueta;
  f.append(s, control);
  return f;
}

function deslizadorConNumero(min: number, max: number, valor: number, unidad: string): { el: HTMLElement; valor: () => number } {
  const el = document.createElement("div");
  el.className = "deslizador-numero";
  const r = document.createElement("input");
  r.type = "range";
  r.min = String(min);
  r.max = String(max);
  r.value = String(valor);
  const n = document.createElement("input");
  n.type = "number";
  n.className = "numero";
  n.min = String(min);
  n.max = String(max);
  n.value = String(valor);
  const u = document.createElement("span");
  u.className = "unidad";
  u.textContent = unidad;
  r.addEventListener("input", () => (n.value = r.value));
  n.addEventListener("change", () => {
    const v = Math.min(max, Math.max(min, Math.round(Number(n.value) || valor)));
    n.value = r.value = String(v);
  });
  el.append(r, n, u);
  return { el, valor: () => Number(r.value) };
}
