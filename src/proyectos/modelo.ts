/**
 * Modelo de datos de un proyecto (ver «Documento de diseño», sección Modelo de datos).
 * Si cambia la forma de estos datos, se sube VERSION_FORMATO y se añade una migración.
 */
export const VERSION_FORMATO = 1;

export interface Proyecto {
  version: number;
  id: string;
  nombre: string;
  ficha: FichaCliente;
  modelo: ModeloCuerpo;
  arbol: NodoArbol[];
}

export interface FichaCliente {
  cliente: string;
  notas: string;
  creado: string; // ISO 8601
  modificado: string;
}

export interface ModeloCuerpo {
  altura: number; // cm
  complexion: number; // 0 = delgada, 1 = robusta
  tonoPiel: string; // color CSS
  versionMalla: string; // versión de la malla base de MakeHuman
}

/** Carpeta o lienzo del árbol. El orden del array es el orden de dibujo en el 3D. */
export type NodoArbol =
  | { tipo: "carpeta"; id: string; nombre: string; visible: boolean; hijos: NodoArbol[] }
  | { tipo: "lienzo"; id: string; nombre: string; visible: boolean; carpeta: string };
