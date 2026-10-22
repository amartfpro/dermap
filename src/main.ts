import { createDockview, themeVisualStudio, type DockviewApi, type IContentRenderer } from "dockview-core";
import "./vendor/dockview-8.6.1.css"; // hoja de estilos de dockview (MIT), copiada del paquete «dockview»
import { PanelProyectos } from "./panels/proyectos";
import { Visor3D } from "./panels/visor3d";
import { PanelLienzo } from "./panels/lienzo";
import { PanelCapas } from "./panels/capas";
import { app } from "./estado";

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

function layoutInicial(api: DockviewApi): void {
  api.clear();
  api.addPanel({ id: "visor3d", component: "visor3d", title: "Visor 3D" });
  api.addPanel({
    id: "lienzo",
    component: "lienzo",
    title: "Lienzo",
    position: { referencePanel: "visor3d", direction: "right" },
  });
  api.addPanel({
    id: "proyectos",
    component: "proyectos",
    title: "Proyectos",
    position: { referencePanel: "visor3d", direction: "left" },
    initialWidth: 250,
  });
  api.addPanel({
    id: "capas",
    component: "capas",
    title: "Capas",
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

dock.onDidLayoutChange(() => {
  try {
    localStorage.setItem(CLAVE_LAYOUT, JSON.stringify(dock.toJSON()));
  } catch {
    // Sin almacenamiento local: la distribución simplemente no se recuerda.
  }
});

document.getElementById("restablecer")!.addEventListener("click", () => layoutInicial(dock));

// Acceso para las pruebas automáticas en navegador (solo con ?prueba en la URL).
if (new URLSearchParams(location.search).has("prueba")) {
  (window as unknown as { dermap: unknown }).dermap = { app };
}
