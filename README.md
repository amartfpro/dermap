# Dermap

Aplicación de escritorio para planificar tatuajes: seleccionas una zona del cuerpo sobre un
modelo 3D, Dermap la aplana en un lienzo a escala real, dibujas en él (o importas tu diseño) y
ves el resultado en tiempo real sobre el modelo. Al final exportas el stencil a escala 1:1 para
la impresora térmica.

Funciona sin conexión y sin servidor. Se distribuye como un instalador normal para Windows y macOS.

> Estado: prototipo funcional. Se puede usar de principio a fin, pero aún no es una versión
> estable: guarda copias de tus proyectos importantes.

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

1. **Proyecto** (panel izquierdo): uno por cliente. Elige uno o crea uno nuevo; se guardan en
   `Documentos/Dermap/`. Si aplanas una zona sin proyecto abierto, se crea «Sin título».
2. **Zona** (visor 3D): elige una «Zona rápida» (manga, antebrazo, pierna) o pinta una con
   «Seleccionar» (Mayús + arrastrar para quitar; con la selección activa la cámara gira con el
   botón derecho). Pulsa **Aplanar zona**: se crea un lienzo nuevo en el proyecto. Si la zona es
   una manga, el corte va por la cara que no estás mirando; la vista «cara interna» lo muestra.
3. **Dibujo** (panel Lienzo): pincel y goma con presión, color, tamaño en milímetros reales,
   opacidad y dureza. Lo que dibujas aparece en el 3D al momento, y un trazo que cruza la
   costura continúa al otro lado del corte.
4. **Capas** (panel Capas): crear, duplicar, reordenar, ocultar, bloquear, opacidad, modo de
   fusión, y **Importar imagen…** para traer un PNG o JPG y colocarlo (mover, escalar, girar).
5. **Exportar stencil…**: PDF A4 a escala real (en piezas con solape si no cabe) o PNG a 300 ppp,
   con las capas que elijas y en negro puro para la impresora térmica. **Imagen 3D…** guarda la
   vista del visor para enseñársela al cliente.

Para tatuajes ya hechos o cicatrices, crea lienzos aparte (por ejemplo en una carpeta
«Previos»): todos los lienzos visibles se ven a la vez en el 3D.

### Atajos

| Acción | Atajo |
| --- | --- |
| Pincel / goma | B / E |
| Tamaño del pincel | [ y ] |
| Deshacer / rehacer | Ctrl+Z / Ctrl+Mayús+Z (o Ctrl+Y) |
| Guardar ahora | Ctrl+S (también se guarda solo) |
| Desplazar el lienzo | Botón central, o Espacio + arrastrar |
| Zoom | Rueda |
| Girar el lienzo | Mayús + rueda, o R + arrastrar |
| Ver el lienzo entero | 0 |

## Tecnologías

- **Tauri 2**: genera el ejecutable. El código Rust es solo la plantilla que registra los plugins.
- **TypeScript + Vite**: todo el código propio (`src/`).
- **Three.js**: visor 3D. **dockview**: paneles acoplables.
- **libigl compilado a WebAssembly**: aplanado de zonas (LSCM + SLIM) en un Web Worker.
- **pdf-lib**: exportación del stencil en PDF.
- Cuerpo: malla base de [MakeHuman](https://github.com/makehumancommunity/makehuman) (CC0).

## Estructura

```text
src/
  main.ts              arranque, paneles, guardado al cerrar
  estado.ts            estado compartido: proyecto, lienzos, pestañas, pincel
  panels/              proyectos, visor 3D, lienzo, capas, diálogo de exportación
  lienzo/              motor de dibujo: teselas, capas, pincel, historial, geometría de la zona
  geometria/           módulo WebAssembly del aplanado, Web Worker, selección de zonas
  proyectos/           formato en disco, guardado y carga, sistema de archivos
  exportar/            stencil PDF/PNG
  modelos/             cuerpo base
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

- `npx tsx scripts/medir-aplanado.ts`: mide la prueba P1 (tiempo, deformación y solapes del aplanado).
- `scripts/compilar-geometria.sh`: recompila `src/geometria/dermap_geom.wasm` (solo si se cambia
  el C++; necesita wasi-sdk 25, libigl 2.5 y Eigen 3.4, ver el script).
- `npx tsx scripts/convertir-makehuman.ts base.obj`: regenera el cuerpo base.

La especificación de requisitos y el documento de diseño están en documentos compartidos aparte.
Los identificadores RF-xx y RNF-xx del código remiten a la especificación.
