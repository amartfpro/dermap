/**
 * Ayuda rápida: el flujo de trabajo y todos los atajos de teclado (RNF-15). Se abre con el
 * botón «?» de la barra superior o con F1.
 */
const SECCIONES: { titulo: string; filas: [string, string][] }[] = [
  {
    titulo: "Flujo de trabajo",
    filas: [
      ["1 · Proyecto", "Uno por cliente. «Ficha del cliente» guarda contacto, cita y notas."],
      ["2 · Cuerpo", "«Cuerpo…» en el visor 3D: altura, complexión y tono de piel."],
      ["3 · Zona", "Zona rápida, «Seleccionar» (pincel) o «Lazo» sobre el cuerpo."],
      ["4 · Corte", "En mangas, la línea roja es el corte: gira la vista para moverlo o usa «Corte manual»."],
      ["5 · Aplanar", "Crea un lienzo nuevo con la forma de la zona, a escala real."],
      ["6 · Dibujar", "Lo que dibujas se ve al momento en el 3D. Las capas se eligen al exportar."],
      ["7 · Exportar", "«Exportar stencil…»: PDF A4 en piezas con regla, o PNG a 300 ppp."],
    ],
  },
  {
    titulo: "Lienzo (con el ratón encima)",
    filas: [
      ["B · E", "Pincel · goma"],
      ["G · L · U", "Relleno · lazo · formas (línea, rectángulo, elipse)"],
      ["I o Alt + clic", "Cuentagotas"],
      ["[ · ]", "Pincel más pequeño · más grande"],
      ["Mayús + clic", "Línea recta desde el final del trazo anterior"],
      ["Ctrl+Z · Ctrl+Mayús+Z", "Deshacer · rehacer"],
      ["Ctrl+C · Ctrl+X · Ctrl+V", "Copiar (selección o capa) · cortar selección · pegar"],
      ["Supr · Esc · Ctrl+D", "Borrar selección · quitarla"],
      ["Ctrl+Mayús+N · Ctrl+J", "Capa nueva · duplicar capa"],
      ["Alt + ↑ · Alt + ↓", "Capa de encima · de debajo"],
      ["Espacio + arrastrar · rueda", "Desplazar · zoom"],
      ["R + arrastrar · Mayús + rueda", "Girar el lienzo"],
      ["0", "Ver el lienzo entero"],
      ["Vista recta", "Mangas: la piel desenrollada en un rectángulo; una línea horizontal es un anillo"],
      ["Intro · Esc", "Aplicar · cancelar la imagen flotante"],
    ],
  },
  {
    titulo: "Visor 3D (con el ratón encima)",
    filas: [
      ["Arrastrar · rueda · botón derecho", "Girar · acercar · desplazar"],
      ["1 – 9", "Vistas: cuerpo, brazos, piernas, torso, espalda"],
      ["F", "Centrar en la zona del lienzo activo"],
      ["S · L", "Seleccionar con pincel · con lazo (Mayús quita)"],
      ["Intro", "Aplanar la zona seleccionada"],
    ],
  },
  {
    titulo: "General",
    filas: [
      ["Ctrl+S", "Guardar ahora (también se guarda solo)"],
      ["F5", "Presentar al cliente a pantalla completa (Esc para salir)"],
      ["F1", "Esta ayuda"],
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
  titulo.textContent = "Ayuda de Dermap";
  caja.append(titulo);
  const columnas = document.createElement("div");
  columnas.className = "ayuda-columnas";
  for (const s of SECCIONES) {
    const seccion = document.createElement("section");
    const h = document.createElement("h3");
    h.textContent = s.titulo;
    const tabla = document.createElement("dl");
    if (s === SECCIONES[0]) tabla.className = "flujo";
    for (const [tecla, que] of s.filas) {
      const dt = document.createElement("dt");
      dt.textContent = tecla;
      const dd = document.createElement("dd");
      dd.textContent = que;
      tabla.append(dt, dd);
    }
    seccion.append(h, tabla);
    columnas.append(seccion);
  }
  const cerrarBoton = document.createElement("button");
  cerrarBoton.className = "boton-texto";
  cerrarBoton.textContent = "Cerrar";
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
