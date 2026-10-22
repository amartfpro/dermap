import { idiomaActual, plural, t } from "../i18n";
import { app } from "../estado";
import { asegurarProyecto } from "../proyectos/gestor";

/**
 * Ficha del cliente del proyecto abierto (RF-05): nombre, contacto, fecha de la cita y
 * notas (zona, ideas, alergias, presupuesto…). Se guarda con el proyecto.
 */
export async function abrirFicha(): Promise<void> {
  const proyecto = app.proyecto ?? (await asegurarProyecto());
  const ficha = proyecto.datos.ficha;

  const fondo = document.createElement("div");
  fondo.className = "fondo-modal";
  const caja = document.createElement("form");
  caja.className = "modal modal-ficha";
  fondo.append(caja);

  const titulo = document.createElement("h2");
  titulo.textContent = t("Ficha del cliente");

  const nombreProyecto = entrada("text", proyecto.datos.nombre);
  const cliente = entrada("text", ficha.cliente);
  const telefono = entrada("tel", ficha.telefono ?? "");
  const correo = entrada("email", ficha.correo ?? "");
  const cita = entrada("date", ficha.cita ?? "");
  const notas = document.createElement("textarea");
  notas.rows = 7;
  notas.value = ficha.notas;
  notas.placeholder = t("Zona, idea del diseño, referencias, alergias, presupuesto, sesiones…");

  const fecha = (iso: string) => {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? "—" : d.toLocaleString(idiomaActual() === "en" ? "en-GB" : "es-ES", { dateStyle: "medium", timeStyle: "short" });
  };
  const info = document.createElement("p");
  info.className = "nota";
  const lienzos = proyecto.nodosLienzo().length;
  info.textContent =
    t("Creado {creado} · modificado {modificado}", { creado: fecha(ficha.creado), modificado: fecha(ficha.modificado) }) +
    " · " +
    plural(lienzos, "{n} lienzo", "{n} lienzos");

  const rejilla = document.createElement("div");
  rejilla.className = "rejilla-ficha";
  rejilla.append(
    campo(t("Proyecto"), nombreProyecto),
    campo(t("Cliente"), cliente),
    campo(t("Teléfono"), telefono),
    campo(t("Correo"), correo),
    campo(t("Cita"), cita),
  );
  const campoNotas = campo(t("Notas"), notas);
  campoNotas.classList.add("ancho");

  const guardar = document.createElement("button");
  guardar.type = "submit";
  guardar.className = "boton-texto primario";
  guardar.textContent = t("Guardar");
  const cancelar = document.createElement("button");
  cancelar.type = "button";
  cancelar.className = "boton-texto";
  cancelar.textContent = t("Cancelar");
  const pie = document.createElement("div");
  pie.className = "modal-pie";
  pie.append(info, cancelar, guardar);
  info.style.flex = "1";

  caja.append(titulo, rejilla, campoNotas, pie);
  document.body.append(fondo);
  cliente.focus();

  const cerrar = () => {
    fondo.remove();
    window.removeEventListener("keydown", alTecla, true);
  };
  const alTecla = (e: KeyboardEvent) => {
    if (e.key === "Escape") cerrar();
    // Que los atajos de los paneles (B, E, [ ]…) no actúen mientras se escribe.
    e.stopPropagation();
  };
  window.addEventListener("keydown", alTecla, true);
  cancelar.addEventListener("click", cerrar);
  fondo.addEventListener("mousedown", (e) => {
    if (e.target === fondo) cerrar();
  });
  caja.addEventListener("submit", (e) => {
    e.preventDefault();
    if (nombreProyecto.value.trim() && nombreProyecto.value.trim() !== proyecto.datos.nombre) {
      proyecto.renombrarProyecto(nombreProyecto.value);
    }
    proyecto.cambiarFicha({
      cliente: cliente.value.trim(),
      telefono: telefono.value.trim(),
      correo: correo.value.trim(),
      cita: cita.value,
      notas: notas.value,
    });
    app.dispatchEvent(new Event("proyecto"));
    cerrar();
  });
}

function entrada(tipo: string, valor: string): HTMLInputElement {
  const e = document.createElement("input");
  e.type = tipo;
  e.value = valor;
  return e;
}

function campo(nombre: string, control: HTMLElement): HTMLElement {
  const l = document.createElement("label");
  l.className = "campo-ficha";
  const t = document.createElement("span");
  t.textContent = nombre;
  l.append(t, control);
  return l;
}
