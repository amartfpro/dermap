import { app } from "../estado";
import type { Lienzo } from "../lienzo/lienzo";
import { listarProyectos, ProyectoAbierto } from "./proyecto";
import { sistemaArchivos } from "./sistema-archivos";

/**
 * Operaciones de proyecto que afectan a toda la aplicación: abrir, crear, añadir y quitar
 * lienzos, manteniendo sincronizados el proyecto, el visor 3D y las pestañas.
 */
const CLAVE_ULTIMO = "dermap.ultimoProyecto";

let alCambiarArbol: ((e: Event) => void) | null = null;

export async function proyectos() {
  return listarProyectos(await sistemaArchivos());
}

export async function abrirProyecto(carpeta: string, progreso?: (t: string) => void): Promise<ProyectoAbierto> {
  await cerrarProyecto();
  const p = await ProyectoAbierto.abrir(await sistemaArchivos(), carpeta, progreso);
  activar(p);
  return p;
}

export async function crearProyecto(nombre: string): Promise<ProyectoAbierto> {
  await cerrarProyecto();
  const p = await ProyectoAbierto.crear(await sistemaArchivos(), nombre);
  activar(p);
  return p;
}

/** Guarda y cierra el proyecto abierto. */
export async function cerrarProyecto(): Promise<void> {
  const p = app.proyecto;
  if (!p) return;
  await p.guardar();
  if (alCambiarArbol) p.removeEventListener("arbol", alCambiarArbol);
  p.cerrar();
  app.fijarProyecto(null, []);
}

/** Proyecto abierto o, si no hay ninguno, uno nuevo «Sin título». */
export async function asegurarProyecto(): Promise<ProyectoAbierto> {
  if (app.proyecto) return app.proyecto;
  const existentes = new Set((await proyectos()).map((p) => p.nombre));
  let nombre = "Sin título";
  for (let n = 2; existentes.has(nombre); n++) nombre = `Sin título ${n}`;
  return crearProyecto(nombre);
}

export async function añadirLienzo(lienzo: Lienzo): Promise<void> {
  const p = await asegurarProyecto();
  await p.añadirLienzo(lienzo);
  app.actualizarLienzos(p.ordenDeDibujo());
  app.abrir(lienzo);
}

export async function duplicarLienzo(id: string): Promise<void> {
  const p = app.proyecto;
  const copia = p && (await p.duplicarLienzo(id));
  if (!p || !copia) return;
  app.actualizarLienzos(p.ordenDeDibujo());
  app.abrir(copia);
}

export async function eliminarNodo(id: string): Promise<void> {
  const p = app.proyecto;
  if (!p) return;
  await p.eliminar(id);
  app.actualizarLienzos(p.ordenDeDibujo());
}

/** Al arrancar se abre el último proyecto usado, si sigue existiendo. */
export async function abrirUltimo(progreso?: (t: string) => void): Promise<void> {
  let ultimo: string | null = null;
  try {
    ultimo = localStorage.getItem(CLAVE_ULTIMO);
  } catch {
    // Sin almacenamiento local.
  }
  if (!ultimo) return;
  const lista = await proyectos();
  if (lista.some((p) => p.carpeta === ultimo)) await abrirProyecto(ultimo, progreso);
}

function activar(p: ProyectoAbierto): void {
  alCambiarArbol = (e) => {
    if ((e as CustomEvent<{ afectaDibujo: boolean }>).detail.afectaDibujo) app.actualizarLienzos(p.ordenDeDibujo());
  };
  p.addEventListener("arbol", alCambiarArbol);
  const orden = p.ordenDeDibujo();
  app.fijarProyecto(p, orden);
  // Se abre el último lienzo del árbol para que el panel de dibujo no aparezca vacío.
  const ultimo = orden[orden.length - 1];
  if (ultimo) app.abrir(ultimo);
  try {
    localStorage.setItem(CLAVE_ULTIMO, p.carpeta);
  } catch {
    // Sin almacenamiento local: simplemente no se recuerda.
  }
}
