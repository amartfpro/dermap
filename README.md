# Dermap

Aplicación de escritorio para planificar tatuajes: seleccionas una zona del cuerpo sobre un
modelo 3D, Dermap la aplana en un lienzo, dibujas en él y ves el resultado en tiempo real
sobre el modelo. Al final exportas el stencil a escala para la impresora térmica.

Funciona sin conexión y sin servidor. Se distribuye como un instalador normal para Windows y macOS.

> Estado: estructura inicial y prototipo técnico en curso. Aún no es una versión utilizable.

## Tecnologías

- **Tauri 2**: genera el ejecutable. El código Rust es solo la plantilla que registra los plugins.
- **TypeScript + Vite**: todo el código propio de la aplicación (`src/`).
- **Three.js**: visor 3D.
- **dockview**: paneles acoplables estilo Visual Studio.
- **libigl compilado a WebAssembly**: aplanado de zonas (LSCM + SLIM) en un Web Worker.

## Preparar el entorno en Windows

1. **Node.js** 20 o posterior.
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

Los proyectos se guardan en `Documentos/Dermap/`, una carpeta por cliente.

## Prototipo: aplanado

En el visor 3D, «Aplanar manga de prueba» o «Aplanar parche de prueba» aplana una zona del
brazo de prueba. El lienzo muestra la zona aplanada con una cuadrícula de 1 cm, la costura del
corte en rojo y, opcionalmente, el mapa de deformación (ámbar: 2–5 %, rojo: más del 5 %).
Lo que dibujes en el lienzo aparece sobre el brazo en tiempo real.

Para medir la prueba P1 (tiempo, deformación y solapes):

```bash
npx tsx scripts/medir-aplanado.ts
```

## Módulo de geometría

El código C++ está en `geometria/` y se compila a `src/geometria/dermap_geom.wasm`, que ya está
en el repositorio: **solo hay que recompilarlo si se cambia el C++**. Se hace con
`scripts/compilar-geometria.sh` (necesita wasi-sdk 25, libigl 2.5 y Eigen 3.4; instrucciones
dentro del script).

## Estructura

```text
src/
  main.ts              arranque y distribución de paneles
  zona.ts              zona activa: malla, aplanado y lienzos de dibujo
  panels/              contenido de cada panel (proyectos, visor 3D, lienzo)
  geometria/           módulo WebAssembly, Web Worker y brazo de prueba
  proyectos/           modelo de datos y lectura/escritura en disco
  vendor/              hoja de estilos de dockview
geometria/             código C++ del aplanado (libigl)
scripts/               compilación del módulo y medición de la prueba P1
src-tauri/             configuración de Tauri y permisos
```

## Documentación

La especificación de requisitos, las decisiones de diseño y el documento de diseño están en
documentos compartidos aparte. Los identificadores RF-xx y RNF-xx del código remiten a la especificación.
