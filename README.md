# Dermap

Aplicación de escritorio para planificar tatuajes: seleccionas una zona del cuerpo sobre un
modelo 3D, Dermap la aplana en un lienzo a escala real, dibujas en él (o importas tu diseño) y
ves el resultado en tiempo real sobre el modelo. Al final exportas el stencil a escala 1:1 para
la impresora térmica.

Funciona sin conexión y sin servidor. Se distribuye como un instalador normal para Windows y macOS.

> Estado: prototipo funcional. Se puede usar de principio a fin, pero aún no es una versión
> estable: guarda copias de tus proyectos importantes.

## Instalar sin compilar

En GitHub, pestaña **Actions → Instaladores → Run workflow**: en unos 15 minutos compila el
instalador de Windows (`.msi` y `.exe`) y el de macOS (`.dmg`), que se descargan desde la
ejecución terminada (sección «Artifacts»). También se lanza al subir una etiqueta de versión
(`git tag v0.2.0 && git push --tags`), que deja además un borrador de *release*.

Los instaladores aún no están firmados: Windows avisa con SmartScreen («Más información →
Ejecutar de todas formas») y macOS pide abrirlo con clic derecho → Abrir la primera vez.

## Preparar el entorno en Windows

1. **Node.js** 20.19 o posterior.
2. **Visual Studio Build Tools** con la carga de trabajo «Desarrollo para el escritorio con C++».
3. **Rust** instalado con [rustup](https://rustup.rs), con las opciones por defecto.

WebView2 ya viene incluido en Windows 10 y 11.

## Ejecutar

```bash
npm install
npm run tauri dev
```

La primera vez tarda unos minutos porque compila la parte de Rust; las siguientes arranca en segundos.
Para crear el instalador: `npm run tauri build` (queda en `src-tauri/target/release/bundle/`).

También se puede abrir en el navegador con `npm run dev` (los proyectos se guardan entonces en
el almacenamiento del navegador, no en disco).

## Cómo se usa

La interfaz sigue el estilo de Illustrator: herramientas como iconos en rieles verticales (pasa
el ratón para ver el nombre y el atajo), una barra de control arriba con las opciones de la
herramienta activa y menús con un triangulito en la esquina del icono. Los tres paneles
(Capas, Visor 3D y Lienzo) se redimensionan arrastrando la línea que aparece entre ellos.

1. **Inicio**: al abrir la app aparecen los proyectos (uno por cliente, en
   `Documentos/Dermap/`) con su portada. **Nuevo proyecto** pide la ficha del cliente y su
   cuerpo (sexo, altura, complexión, musculatura, tono de piel y, si las tienes, sus medidas)
   antes de entrar. El botón de la casa (arriba a la izquierda) guarda y vuelve al inicio.
   **Ficha del cliente** (arriba) guarda nombre, contacto, fecha de la cita y notas.
   **Exportar .dermap** guarda el proyecto entero en un archivo (copia de seguridad o para otro
   ordenador) y **Abrir archivo .dermap…** lo abre como proyecto nuevo (con la aplicación
   instalada, también basta con hacer doble clic en el archivo).
2. **Cuerpo** (visor 3D → **Cuerpo**): altura real, hombre o mujer, complexión, musculatura y
   tono de piel. El modelo se ve suavizado (teselado de Phong) con un material y una luz de piel. Los lienzos siguen al cuerpo al cambiarlo. Con las **medidas del cliente** (contornos
   de brazo, antebrazo, muñeca, muslo, gemelo y tobillo tomados con cinta) los lienzos nuevos
   salen a su escala real. **Postura** sube o baja los hombros (de brazos
   al costado a «en T»), abre o cierra las caderas y dobla codos y rodillas, con atajos
   «Postura natural» y «En T». Se puede seleccionar zonas en cualquier postura; el lienzo se
   aplana siempre en la postura base.
3. **Zona** (visor 3D): una «Zona rápida», **Seleccionar** (pincel) o **Lazo** (rodear lo que
   se ve); Mayús quita. En mangas, la línea azul es el corte: va por la cara que no estás
   mirando, o márcalo tú con **Corte manual**. **Corte extra** abre pinzas en zonas muy curvas.
   **Aplanar zona** crea un lienzo nuevo a escala real.
4. **Dibujo** (panel Lienzo): pinceles para tatuaje (línea fina, línea, relleno, sombreado,
   puntillismo), goma, cuentagotas, relleno, lazo para mover/copiar/borrar, línea, rectángulo y
   elipse, paleta guardable, presión de la tableta y tamaño en milímetros reales. Lo que dibujas
   aparece en el 3D al momento y los trazos continúan al otro lado de la costura. En mangas,
   **Vista recta** muestra la piel desenrollada en un rectángulo (una línea horizontal es un
   anillo alrededor del brazo), y **Pintar en 3D** dibuja directamente sobre el modelo.
5. **Capas**: cada lienzo es un grupo plegable con sus capas dentro (el ojo del grupo lo oculta
   en el 3D; se reordenan arrastrando). Crear, duplicar, reordenar, ocultar, bloquear, opacidad, modo de fusión,
   **Importar imagen…** (PNG/JPG), **A stencil…** (convierte una foto o boceto importado en
   líneas o en blanco y negro, en una capa nueva), **Texto…** (lettering con las tipografías
   instaladas y la altura de las mayúsculas en mm reales), **Copiar/Pegar** entre lienzos y
   **Traer dibujo de…**, que recoloca el dibujo de otro lienzo sobre la misma piel (para rehacer
   una zona con otro corte) o lo lleva **en espejo** a la zona simétrica (del brazo izquierdo al
   derecho, por ejemplo).
6. **Exportar stencil…**: PDF A4 a escala real (en piezas con solape si no cabe) o PNG a 300 ppp,
   con las capas que elijas, en negro puro para la impresora térmica y, si hace falta, en espejo
   (papel de stencil de inyección de tinta o calco a mano). **Imagen 3D…** guarda la
   vista del visor.
7. **Presentar** (o F5): el 3D a pantalla completa para el cliente, girando, con botones para
   mostrar u ocultar cada lienzo y comparar versiones (duplica un lienzo con ⧉ para hacer otra).

Para tatuajes ya hechos o cicatrices, crea lienzos aparte (por ejemplo «Previo – hombro»):
todos los lienzos visibles se ven a la vez en el 3D.

La interfaz está en español y en inglés (selector de idioma en la barra superior). Para
añadir otro idioma basta con copiar `src/i18n/en.json`, traducirlo y registrarlo en `src/i18n.ts`;
`npx tsx scripts/textos.ts <idioma>` lista lo que falte.

### Atajos

Todos están en la ayuda (botón **?** o F1). Los principales:

| Acción | Atajo |
| --- | --- |
| Pincel / goma / relleno / lazo / formas | B / E / G / L / U |
| Cuentagotas | I, o Alt + clic |
| Tamaño del pincel | [ y ] |
| Línea recta | Mayús + clic |
| Deshacer / rehacer | Ctrl+Z / Ctrl+Mayús+Z (o Ctrl+Y) |
| Copiar / cortar / pegar | Ctrl+C / Ctrl+X / Ctrl+V |
| Capa nueva / duplicar / cambiar | Ctrl+Mayús+N / Ctrl+J / Alt+↑↓ |
| Desplazar / zoom / girar el lienzo | Espacio + arrastrar / rueda / R + arrastrar |
| Vistas del 3D / zona activa | 1–9 / F (con el ratón sobre el visor) |
| Guardar ahora | Ctrl+S (también se guarda solo) |
| Presentar / ayuda | F5 / F1 |

## Tecnologías

- **Tauri 2**: genera el ejecutable. El código Rust es solo la plantilla que registra los plugins.
- **TypeScript + Vite**: todo el código propio (`src/`).
- **Three.js**: visor 3D. **dockview**: paneles acoplables.
- **libigl compilado a WebAssembly**: aplanado de zonas (LSCM + SLIM) en un Web Worker.
- **pdf-lib**: exportación del stencil en PDF. **fflate**: archivos `.dermap` (ZIP).
- Cuerpo: malla base y formas de [MakeHuman](https://github.com/makehumancommunity/makehuman) (CC0).
- Todas las dependencias tienen licencias permisivas (MIT, BSD, Apache, MPL); libigl se usa
  con su licencia MPL 2.0.

## Estructura

```text
src/
  main.ts              arranque, paneles, guardado al cerrar
  estado.ts            estado compartido: proyecto, lienzos, pestañas, pincel
  panels/              proyectos, visor 3D, lienzo, capas, cuerpo, ficha, ayuda, exportación
  lienzo/              motor de dibujo: teselas, capas, pincel, historial, herramientas,
                       portapapeles, transferencia entre lienzos, geometría de la zona
  geometria/           módulo WebAssembly del aplanado, Web Worker, selección de zonas
  proyectos/           formato en disco, guardado y carga, archivo .dermap, sistema de archivos
  exportar/            stencil PDF/PNG
  modelos/             cuerpo base y formas (complexión)
pruebas/               pruebas automáticas (npm test)
geometria/             código C++ del aplanado (libigl)
scripts/               conversión de MakeHuman, compilación del WebAssembly, medición P1
src-tauri/             configuración de Tauri y permisos
```

### Formato de un proyecto

```text
Documentos/Dermap/<Proyecto>/
  proyecto.json                 ficha, modelo y árbol (carpetas, orden, visibilidad)
  <lienzo>_<id>.lienzo/
    lienzo.json                 tamaño, capas y ajustes
    zona.bin                    zona del cuerpo y aplanado
    miniatura.png
    capas/<id>/t_<x>_<y>.png    teselas de 512 px con contenido
  exportaciones/
```

## Desarrollo

- `npm test`: pruebas automáticas (formato, historial, regiones, plan de hojas, archivo
  `.dermap`, complexión, selección, cortes y aplanado real con el WebAssembly en Node).
- `npx tsx scripts/medir-aplanado.ts`: mide la prueba P1 (tiempo, deformación y solapes del aplanado).
- `scripts/compilar-geometria.sh`: recompila `src/geometria/dermap_geom.wasm` (solo si se cambia
  el C++; necesita wasi-sdk 25, libigl 2.5 y Eigen 3.4, ver el script).
- `npx tsx scripts/convertir-makehuman.ts base.obj`: regenera el cuerpo base.
- `npx tsx scripts/convertir-formas.ts base.obj carpeta-de-targets`: regenera las formas de
  complexión (los targets de MakeHuman que lista el script).

La especificación de requisitos y el documento de diseño están en documentos compartidos aparte.
Los identificadores RF-xx y RNF-xx del código remiten a la especificación.
