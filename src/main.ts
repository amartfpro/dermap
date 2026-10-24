import { cambiarIdioma, IDIOMAS, idiomaActual, t, traducible } from "./i18n";
import { createDockview, type DockviewApi, type DockviewTheme, type IContentRenderer } from "dockview-core";
import "./vendor/dockview-8.6.1.css"; // hoja de estilos de dockview (MIT), copiada del paquete «dockview»
import "./estilos/dock.css";
import "./estilos/fuentes.css";
import { Visor3D, visorActual } from "./panels/visor3d";
import { abrirFicha } from "./panels/ficha";
import { abrirAyuda } from "./panels/ayuda";
import { PanelLienzo } from "./panels/lienzo";
import { PanelCapas } from "./panels/capas";
import { app } from "./estado";
import { abrirArchivoInicial, abrirProyecto, exportarProyecto } from "./proyectos/gestor";
import { inicioVisible, mostrarInicio, ocultarInicio, volverAlInicio } from "./inicio/inicio";
import { icono, type NombreIcono } from "./ui/iconos";
import { botonMenu } from "./ui/menu";
import { instalarTooltips } from "./ui/tooltip";
import { firma } from "./ui/firma";
import { enTauri, sistemaArchivos } from "./proyectos/sistema-archivos";

const CLAVE_LAYOUT = "dermap.layout.v4";
/** Proyecto que reabrir tras recargar la interfaz al cambiar de idioma. */
const CLAVE_REABRIR = "dermap.reabrir";

const componentes: Record<string, () => IContentRenderer> = {
  visor3d: () => new Visor3D(),
  lienzo: () => new PanelLienzo(),
  capas: () => new PanelCapas(),
};

/** Paneles como tarjetas con radio sobre el fondo, separados por un hueco. */
const temaDermap: DockviewTheme = {
  name: "dermap",
  className: "dockview-theme-dermap",
  colorScheme: "dark",
  gap: 8,
  dndOverlayMounting: "absolute",
  dndPanelOverlay: "group",
};

const contenedor = document.getElementById("espacio")!;
const dock = createDockview(contenedor, {
  theme: temaDermap,
  createComponent: ({ name }) => {
    const crear = componentes[name];
    if (!crear) throw new Error(`Panel desconocido: ${name}`);
    return crear();
  },
});

// Cada columna tiene un solo panel: se pueden recolocar arrastrando su cabecera a un borde, pero no
// apilar en pestañas (así la cabecera es un título con su botón de cerrar).
dock.onWillShowOverlay((e) => {
  if (e.kind === "tab" || e.kind === "header_space" || (e.kind === "content" && e.position === "center")) e.preventDefault();
});

const TITULOS: Record<string, string> = {
  visor3d: traducible("Modelo"),
  lienzo: traducible("Lienzo"),
  capas: traducible("Capas"),
};

function layoutInicial(api: DockviewApi): void {
  // En el orden del trabajo: Modelo (elegir la zona) → Lienzo (dibujar) → Capas, junto al lienzo.
  api.clear();
  api.addPanel({ id: "visor3d", component: "visor3d", title: t(TITULOS.visor3d) });
  api.addPanel({
    id: "lienzo",
    component: "lienzo",
    title: t(TITULOS.lienzo),
    position: { referencePanel: "visor3d", direction: "right" },
  });
  api.addPanel({
    id: "capas",
    component: "capas",
    title: t(TITULOS.capas),
    position: { referencePanel: "lienzo", direction: "right" },
    initialWidth: 290,
  });
  // Modelo algo más de un tercio, Capas estrecha y el resto para el lienzo. Al arrancar el espacio
  // de trabajo puede estar oculto (pantalla de inicio): se ajusta cuando tenga tamaño.
  const ajustar = () => {
    const ancho = contenedor.clientWidth;
    if (!ancho) return false;
    // En este orden: cada cambio lo absorbe la columna vecina (la del lienzo al final).
    api.getPanel("visor3d")?.group.api.setSize({ width: Math.round(ancho * 0.36) });
    api.getPanel("capas")?.group.api.setSize({ width: 290 });
    return true;
  };
  // Dockview reparte el espacio en el siguiente fotograma: se ajusta después.
  requestAnimationFrame(() => {
    if (ajustar()) return;
    const observador = new ResizeObserver(() => {
      if (ajustar()) observador.disconnect();
    });
    observador.observe(contenedor);
  });
}

// Restaura la distribución guardada; si no hay o está dañada, usa la inicial.
function restaurar(): void {
  try {
    const guardado = localStorage.getItem(CLAVE_LAYOUT);
    if (guardado) {
      dock.fromJSON(JSON.parse(guardado));
      return;
    }
  } catch {
    // localStorage no disponible o layout inválido: se ignora.
  }
  layoutInicial(dock);
}

restaurar();
// Los títulos guardados en la distribución pueden estar en otro idioma.
for (const panel of dock.panels) if (TITULOS[panel.id]) panel.api.setTitle(t(TITULOS[panel.id]));

// Textos de la barra superior y selector de idioma (RNF-14).
// Barra superior: solo iconos con tooltip (como Illustrator).
const iconosBarra: [string, NombreIcono, string][] = [
  ["inicio", "inicio", traducible("Inicio: proyectos y nuevo proyecto")],
  ["ficha", "ficha", traducible("Ficha del cliente: datos, cita y notas")],
  ["exportar-proyecto", "descargar", traducible("Exportar el proyecto a un archivo .dermap (copia de seguridad o para otro ordenador)")],
  ["ayuda", "ayuda", traducible("Flujo de trabajo y atajos de teclado (F1)")],
  ["restablecer", "distribucion", traducible("Restablecer la distribución de paneles")],
  ["presentar", "presentar", traducible("Presentar al cliente a pantalla completa (F5)")],
];
for (const [id, nombre, titulo] of iconosBarra) {
  const b = document.getElementById(id)!;
  b.replaceChildren(icono(nombre));
  b.title = t(titulo);
  b.setAttribute("aria-label", t(titulo));
}
const botonIdioma = botonMenu("idioma", t("Idioma"), () =>
  Object.entries(IDIOMAS).map(([codigo, { nombre }]) => ({
    texto: nombre,
    marcado: codigo === idiomaActual(),
    accion: async () => {
      if (codigo === idiomaActual()) return;
      await app.proyecto?.guardar();
      // Cambiar de idioma recarga la interfaz: al volver, se reabre el mismo proyecto.
      try {
        if (app.proyecto) sessionStorage.setItem(CLAVE_REABRIR, app.proyecto.carpeta);
      } catch {
        // Sin almacenamiento de sesión: se vuelve al inicio.
      }
      cambiarIdioma(codigo);
    },
  })),
);
botonIdioma.classList.add("fantasma");
document.getElementById("hueco-idioma")!.replaceWith(botonIdioma);
instalarTooltips();
document.getElementById("firma")!.replaceWith(firma());

dock.onDidLayoutChange(() => {
  try {
    localStorage.setItem(CLAVE_LAYOUT, JSON.stringify(dock.toJSON()));
  } catch {
    // Sin almacenamiento local: la distribución simplemente no se recuerda.
  }
});

document.getElementById("restablecer")!.addEventListener("click", () => layoutInicial(dock));
document.getElementById("ayuda")!.addEventListener("click", abrirAyuda);
document.getElementById("ficha")!.addEventListener("click", () => void abrirFicha());
document.getElementById("presentar")!.addEventListener("click", () => visorActual()?.presentar(true));
document.getElementById("inicio")!.addEventListener("click", () => void volverAlInicio());
document.getElementById("exportar-proyecto")!.addEventListener("click", () => void exportarProyecto().catch((e) => window.alert(String(e))));

// Nombre del cliente en la barra superior.
const etiquetaCliente = document.getElementById("cliente")!;
const estadoGuardado = document.getElementById("estado-guardado")!;
let proyectoVigilado: typeof app.proyecto = null;
const mostrarEstado = () => {
  const p = app.proyecto;
  if (!p) {
    estadoGuardado.textContent = "";
    return;
  }
  estadoGuardado.textContent = {
    guardado: t("Guardado"),
    pendiente: t("Cambios sin guardar"),
    guardando: t("Guardando…"),
    error: t("Error al guardar: {error}", { error: p.ultimoError }),
  }[p.estadoGuardado];
  estadoGuardado.dataset.estado = p.estadoGuardado;
};
const mostrarCliente = () => {
  const p = app.proyecto;
  etiquetaCliente.textContent = p ? p.datos.nombre + (p.datos.ficha.cliente && p.datos.ficha.cliente !== p.datos.nombre ? ` · ${p.datos.ficha.cliente}` : "") : "";
  if (proyectoVigilado !== p) {
    proyectoVigilado?.removeEventListener("guardado", mostrarEstado);
    p?.addEventListener("guardado", mostrarEstado);
    proyectoVigilado = p;
  }
  mostrarEstado();
};
app.addEventListener("proyecto", mostrarCliente);
// Un proyecto abierto por otra vía (doble clic en un .dermap con la app abierta) sale del inicio.
app.addEventListener("proyecto", () => {
  if (app.proyecto && inicioVisible()) ocultarInicio();
});

// ── Proyectos: reabrir el último, guardar con Ctrl+S y antes de cerrar ───────────

// Al arrancar: si la app se abrió con un archivo .dermap, ese proyecto; si se acaba de cambiar
// el idioma, el proyecto que estaba abierto; si no, la pantalla de inicio.
let reabrir: string | null = null;
try {
  reabrir = sessionStorage.getItem(CLAVE_REABRIR);
  sessionStorage.removeItem(CLAVE_REABRIR);
} catch {
  // Sin almacenamiento de sesión.
}
// Al reabrir tras cambiar el idioma no se enseña el inicio (salvo que falle).
if (!reabrir) mostrarInicio();
const progresoInicial = (texto: string) => app.dispatchEvent(new CustomEvent("progreso", { detail: texto }));
void abrirArchivoInicial(progresoInicial)
  .then(async () => {
    if (!app.proyecto && reabrir) await abrirProyecto(reabrir, progresoInicial).catch(() => undefined);
    if (app.proyecto) ocultarInicio();
    else if (reabrir) mostrarInicio();
  })
  .catch((error) => console.error("No se pudo abrir el archivo inicial", error));

window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    void app.proyecto?.guardar();
  } else if (e.key === "F1") {
    e.preventDefault();
    abrirAyuda();
  } else if (e.key === "F5") {
    e.preventDefault(); // en la aplicación, F5 no recarga: presenta
    visorActual()?.presentar(true);
  }
});

if (enTauri()) {
  // Al cerrar la ventana se guarda lo pendiente y luego se cierra de verdad.
  void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
    const ventana = getCurrentWindow();
    void ventana.onCloseRequested(async (evento) => {
      if (!app.proyecto?.hayCambios) return;
      evento.preventDefault();
      try {
        await app.proyecto.guardar();
      } finally {
        await ventana.destroy();
      }
    });
  });
} else {
  window.addEventListener("beforeunload", (e) => {
    if (app.proyecto?.hayCambios) {
      void app.proyecto.guardar();
      e.preventDefault();
    }
  });
}

// Acceso para las pruebas automáticas en navegador (solo con ?prueba en la URL).
if (new URLSearchParams(location.search).has("prueba")) {
  void Promise.all([import("./proyectos/paquete"), import("./lienzo/vista-recta")]).then(([paquete, { VistaRecta }]) => {
    (window as unknown as { dermap: unknown }).dermap = { app, sistemaArchivos, paquete, VistaRecta, visorActual, dock };
  });
  (window as unknown as { dermap: unknown }).dermap = { app, sistemaArchivos };
}
