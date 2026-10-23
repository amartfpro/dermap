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
import { abrirArchivoInicial, exportarProyecto } from "./proyectos/gestor";
import { inicioVisible, mostrarInicio, ocultarInicio, volverAlInicio } from "./inicio/inicio";
import { icono } from "./ui/iconos";
import { enTauri, sistemaArchivos } from "./proyectos/sistema-archivos";

const CLAVE_LAYOUT = "dermap.layout.v3";

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

const TITULOS: Record<string, string> = {
  visor3d: traducible("Visor 3D"),
  lienzo: traducible("Lienzo"),
  capas: traducible("Capas"),
};

function layoutInicial(api: DockviewApi): void {
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
    position: { referencePanel: "visor3d", direction: "left" },
    initialWidth: 290,
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
const textosBarra: [string, string, string][] = [
  ["ficha", traducible("Ficha del cliente"), traducible("Datos del cliente y notas del proyecto")],
  ["exportar-proyecto", traducible("Exportar .dermap"), traducible("Guardar todo el proyecto en un solo archivo .dermap (copia de seguridad o para otro ordenador)")],
  ["presentar", traducible("Presentar"), traducible("Enseñar el diseño al cliente a pantalla completa (F5)")],
  ["ayuda", "?", traducible("Flujo de trabajo y atajos de teclado (F1)")],
  ["restablecer", "", traducible("Volver a la distribución inicial de paneles")],
  ["inicio", "", traducible("Inicio: proyectos recientes y nuevo proyecto")],
];
for (const [id, texto, titulo] of textosBarra) {
  const b = document.getElementById(id)!;
  if (texto) b.textContent = texto === "?" ? "?" : t(texto);
  b.title = t(titulo);
}
document.getElementById("inicio")!.append(icono("inicio"));
document.getElementById("restablecer")!.append(icono("encajar"));
document.getElementById("presentar")!.prepend(icono("camara"));
document.getElementById("presentar")!.classList.add("con-icono");
document.getElementById("ficha")!.prepend(icono("cuerpo"));
document.getElementById("ficha")!.classList.add("con-icono");
document.getElementById("exportar-proyecto")!.prepend(icono("exportar"));
document.getElementById("exportar-proyecto")!.classList.add("con-icono");
const selectorIdioma = document.createElement("select");
selectorIdioma.className = "desplegable idioma";
selectorIdioma.title = t("Idioma");
for (const [codigo, { nombre }] of Object.entries(IDIOMAS)) selectorIdioma.append(new Option(nombre, codigo, false, codigo === idiomaActual()));
selectorIdioma.addEventListener("change", async () => {
  await app.proyecto?.guardar();
  cambiarIdioma(selectorIdioma.value);
});
document.getElementById("ayuda")!.before(selectorIdioma);

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

// Al arrancar: si la app se abrió con un archivo .dermap, ese proyecto; si no, la pantalla de inicio.
mostrarInicio();
void abrirArchivoInicial((texto) => app.dispatchEvent(new CustomEvent("progreso", { detail: texto })))
  .then(() => {
    if (app.proyecto) ocultarInicio();
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
    (window as unknown as { dermap: unknown }).dermap = { app, sistemaArchivos, paquete, VistaRecta };
  });
  (window as unknown as { dermap: unknown }).dermap = { app, sistemaArchivos };
}
