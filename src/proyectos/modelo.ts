/**
 * Formato de los proyectos en disco (ver «Documento de diseño», Formato de archivos).
 * Si cambia la forma de estos datos, se sube VERSION_FORMATO y se añade una migración.
 *
 *   <Proyecto>/
 *     proyecto.json                  ficha, modelo y árbol (carpetas, orden y visibilidad)
 *     <nombre>_<id>.lienzo/
 *       lienzo.json                  tamaño, capas y ajustes
 *       zona.bin                     zona del cuerpo y aplanado (binario)
 *       miniatura.png
 *       capas/<id de capa>/t_<x>_<y>.png   solo las teselas con contenido
 */
export const VERSION_FORMATO = 2;

export interface Proyecto {
  version: number;
  id: string;
  nombre: string;
  ficha: FichaCliente;
  modelo: ModeloCuerpo;
  /** Árbol de carpetas y lienzos. El orden (en profundidad) es el orden de dibujo en el 3D. */
  arbol: NodoArbol[];
}

/** Ficha del cliente (RF-05). Los campos opcionales no existían en los primeros proyectos. */
export interface FichaCliente {
  cliente: string;
  telefono?: string;
  correo?: string;
  /** Fecha de la cita (AAAA-MM-DD), si la hay. */
  cita?: string;
  notas: string;
  creado: string; // ISO 8601
  modificado: string;
}

/** Cuerpo del proyecto (RF-12, RF-14): uno por proyecto, compartido por todos sus lienzos. */
export interface ModeloCuerpo {
  altura: number; // cm
  complexion: number; // peso: 0 = delgada, 1 = robusta
  /** 0 = mujer, 1 = hombre. Opcional en proyectos anteriores (0,5). */
  sexo?: number;
  /** 0–1. Opcional en proyectos anteriores (0,5). */
  musculatura?: number;
  tonoPiel: string; // color CSS
  /** Contornos reales del cliente en cm (opcionales): ver modelos/medidas.ts. */
  medidas?: import("../modelos/medidas").Medidas;
  versionMalla: string; // versión de la malla base
  /** Postura en grados (ver modelos/pose.ts). Si falta, la natural. Solo cambia lo que se ve. */
  pose?: Partial<import("../modelos/pose").Pose>;
}

/**
 * Carpeta o lienzo del árbol. Las carpetas son virtuales (solo existen aquí); cada lienzo
 * guarda en `carpeta` el nombre de su carpeta .lienzo dentro del proyecto.
 */
export type NodoArbol = NodoCarpeta | NodoLienzo;

export interface NodoCarpeta {
  tipo: "carpeta";
  id: string;
  nombre: string;
  visible: boolean;
  abierta: boolean;
  hijos: NodoArbol[];
}

export interface NodoLienzo {
  tipo: "lienzo";
  id: string;
  nombre: string;
  visible: boolean;
  carpeta: string;
}

export interface DatosLienzo {
  version: number;
  id: string;
  nombre: string;
  ppp: number;
  ancho: number;
  alto: number;
  cuadricula: boolean;
  tonoPiel: string;
  tipo: "parche" | "manga";
  capaActiva: string;
  /** De abajo arriba. */
  capas: DatosCapa[];
}

export interface DatosCapa {
  id: string;
  nombre: string;
  visible: boolean;
  bloqueada: boolean;
  opacidad: number;
  modo: string;
  enStencil: boolean;
}
