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
- **libigl compilado a WebAssembly** (próximamente): aplanado de zonas en un Web Worker.

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

## Estructura

```text
src/
  main.ts              arranque y distribución de paneles
  panels/              contenido de cada panel (proyectos, visor 3D, lienzo)
  proyectos/           modelo de datos y lectura/escritura en disco
  vendor/              hoja de estilos de dockview
src-tauri/             configuración de Tauri y permisos
```

## Documentación

La especificación de requisitos, las decisiones de diseño y el documento de diseño están en
documentos compartidos aparte. Los identificadores RF-xx y RNF-xx del código remiten a la especificación.
