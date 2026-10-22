import { t, traducible } from "../i18n";
/**
 * Ayuda rápida: el flujo de trabajo y todos los atajos de teclado (RNF-15). Se abre con el
 * botón «?» de la barra superior o con F1.
 */
const SECCIONES: { titulo: string; filas: [string, string][] }[] = [
  {
    titulo: traducible("Flujo de trabajo"),
    filas: [
      [traducible("1 · Proyecto"), traducible("Uno por cliente. «Ficha del cliente» guarda contacto, cita y notas.")],
      [traducible("2 · Cuerpo"), traducible("«Cuerpo…» en el visor 3D: altura, complexión y tono de piel.")],
      [traducible("3 · Zona"), traducible("Zona rápida, «Seleccionar» (pincel) o «Lazo» sobre el cuerpo.")],
      [traducible("4 · Corte"), traducible("En mangas, la línea roja es el corte: gira la vista para moverlo o usa «Corte manual».")],
      [traducible("5 · Aplanar"), traducible("Crea un lienzo nuevo con la forma de la zona, a escala real.")],
      [traducible("6 · Dibujar"), traducible("Lo que dibujas se ve al momento en el 3D. Las capas se eligen al exportar.")],
      [traducible("7 · Exportar"), traducible("«Exportar stencil…»: PDF A4 en piezas con regla, o PNG a 300 ppp.")],
    ],
  },
  {
    titulo: traducible("Lienzo (con el ratón encima)"),
    filas: [
      [traducible("B · E"), traducible("Pincel · goma")],
      [traducible("G · L · U"), traducible("Relleno · lazo · formas (línea, rectángulo, elipse)")],
      [traducible("I o Alt + clic"), traducible("Cuentagotas")],
      [traducible("T"), traducible("Texto (lettering) a tamaño real")],
      [traducible("[ · ]"), traducible("Pincel más pequeño · más grande")],
      [traducible("Mayús + clic"), traducible("Línea recta desde el final del trazo anterior")],
      [traducible("Ctrl+Z · Ctrl+Mayús+Z"), traducible("Deshacer · rehacer")],
      [traducible("Ctrl+C · Ctrl+X · Ctrl+V"), traducible("Copiar (selección o capa) · cortar selección · pegar")],
      [traducible("Supr · Esc · Ctrl+D"), traducible("Borrar selección · quitarla")],
      [traducible("Ctrl+Mayús+N · Ctrl+J"), traducible("Capa nueva · duplicar capa")],
      [traducible("Alt + ↑ · Alt + ↓"), traducible("Capa de encima · de debajo")],
      [traducible("Espacio + arrastrar · rueda"), traducible("Desplazar · zoom")],
      [traducible("R + arrastrar · Mayús + rueda"), traducible("Girar el lienzo")],
      [traducible("0"), traducible("Ver el lienzo entero")],
      [traducible("Vista recta"), traducible("Mangas: la piel desenrollada en un rectángulo; una línea horizontal es un anillo")],
      [traducible("Intro · Esc"), traducible("Aplicar · cancelar la imagen flotante")],
    ],
  },
  {
    titulo: traducible("Visor 3D (con el ratón encima)"),
    filas: [
      [traducible("Arrastrar · rueda · botón derecho"), traducible("Girar · acercar · desplazar")],
      [traducible("1 – 9"), traducible("Vistas: cuerpo, brazos, piernas, torso, espalda")],
      [traducible("F"), traducible("Centrar en la zona del lienzo activo")],
      [traducible("S · L"), traducible("Seleccionar con pincel · con lazo (Mayús quita)")],
      [traducible("Intro"), traducible("Aplanar la zona seleccionada")],
    ],
  },
  {
    titulo: traducible("General"),
    filas: [
      [traducible("Ctrl+S"), traducible("Guardar ahora (también se guarda solo)")],
      [traducible("F5"), traducible("Presentar al cliente a pantalla completa (Esc para salir)")],
      [traducible("F1"), traducible("Esta ayuda")],
    ],
  },
];

export function abrirAyuda(): void {
  if (document.querySelector(".modal-ayuda")) return;
  const fondo = document.createElement("div");
  fondo.className = "fondo-modal";
  const caja = document.createElement("div");
  caja.className = "modal modal-ayuda";
  const titulo = document.createElement("h2");
  titulo.textContent = t("Ayuda de Dermap");
  caja.append(titulo);
  const columnas = document.createElement("div");
  columnas.className = "ayuda-columnas";
  for (const s of SECCIONES) {
    const seccion = document.createElement("section");
    const h = document.createElement("h3");
    h.textContent = t(s.titulo);
    const tabla = document.createElement("dl");
    if (s === SECCIONES[0]) tabla.className = "flujo";
    for (const [tecla, que] of s.filas) {
      const dt = document.createElement("dt");
      dt.textContent = t(tecla);
      const dd = document.createElement("dd");
      dd.textContent = t(que);
      tabla.append(dt, dd);
    }
    seccion.append(h, tabla);
    columnas.append(seccion);
  }
  const cerrarBoton = document.createElement("button");
  cerrarBoton.className = "boton-texto";
  cerrarBoton.textContent = t("Cerrar");
  const pie = document.createElement("div");
  pie.className = "modal-pie";
  pie.append(cerrarBoton);
  caja.append(columnas, pie);
  fondo.append(caja);
  document.body.append(fondo);
  const cerrar = () => {
    fondo.remove();
    window.removeEventListener("keydown", alTecla);
  };
  const alTecla = (e: KeyboardEvent) => {
    if (e.key === "Escape") cerrar();
  };
  window.addEventListener("keydown", alTecla);
  cerrarBoton.addEventListener("click", cerrar);
  fondo.addEventListener("mousedown", (e) => {
    if (e.target === fondo) cerrar();
  });
}
