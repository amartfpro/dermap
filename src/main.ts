import { cambiarIdioma, IDIOMAS, idiomaActual, t, traducible } from "./i18n";
import { createDockview, themeVisualStudio, type DockviewApi, type IContentRenderer } from "dockview-core";
import "./vendor/dockview-8.6.1.css"; // hoja de estilos de dockview (MIT), copiada del paquete «dockview»
import { PanelProyectos } from "./panels/proyectos";
import { Visor3D, visorActual } from "./panels/visor3d";
import { abrirFicha } from "./panels/ficha";
import { abrirAyuda } from "./panels/ayuda";
import { PanelLienzo } from "./panels/lienzo";
import { PanelCapas } from "./panels/capas";
import { app } from "./estado";
import { abrirUltimo } from "./proyectos/gestor";
import { enTauri, sistemaArchivos } from "./proyectos/sistema-archivos";

const CLAVE_LAYOUT = "dermap.layout.v2";

const componentes: Record<string, () => IContentRenderer> = {
  proyectos: () => new PanelProyectos(),
  visor3d: () => new Visor3D(),
  lienzo: () => new PanelLienzo(),
  capas: () => new PanelCapas(),
};

const contenedor = document.getElementById("espacio")!;
const dock = createDockview(contenedor, {
  theme: themeVisualStudio,
  createComponent: ({ name }) => {
    const crear = componentes[name];
    if (!crear) throw new Error(`Panel desconocido: ${name}`);
    return crear();
  },
});

const TITULOS: Record<string, string> = {
  visor3d: traducible("Visor 3D"),
  lienzo: traducible("Lienzo"),
  proyectos: traducible("Proyectos"),
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
    id: "proyectos",
    component: "proyectos",
    title: t(TITULOS.proyectos),
    position: { referencePanel: "visor3d", direction: "left" },
    initialWidth: 250,
  });
  api.addPanel({
    id: "capas",
    component: "capas",
    title: t(TITULOS.capas),
    position: { referencePanel: "proyectos", direction: "below" },
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
  ["presentar", traducible("Presentar"), traducible("Enseñar el diseño al cliente a pantalla completa (F5)")],
  ["ayuda", "?", traducible("Flujo de trabajo y atajos de teclado (F1)")],
  ["restablecer", traducible("Restablecer paneles"), traducible("Volver a la distribución inicial de paneles")],
];
for (const [id, texto, titulo] of textosBarra) {
  const b = document.getElementById(id)!;
  b.textContent = texto === "?" ? "?" : t(texto);
  b.title = t(titulo);
}
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

// Nombre del cliente en la barra superior.
const etiquetaCliente = document.getElementById("cliente")!;
const mostrarCliente = () => {
  const p = app.proyecto;
  etiquetaCliente.textContent = p ? `· ${p.datos.ficha.cliente || p.datos.nombre}` : "";
};
app.addEventListener("proyecto", mostrarCliente);

// ── Proyectos: reabrir el último, guardar con Ctrl+S y antes de cerrar ───────────

void abrirUltimo((texto) => app.dispatchEvent(new CustomEvent("progreso", { detail: texto }))).catch((error) => console.error("No se pudo abrir el último proyecto", error));

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
