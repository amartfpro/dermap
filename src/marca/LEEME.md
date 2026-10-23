# Marca

Archivos de marca de la aplicación. Para cambiarlos basta con sustituir cada archivo por otro
SVG **con el mismo nombre**:

- `logo.svg`: logo de Dermap (cabecera, pantalla de inicio). Cuadrado.
- `autor.svg`: firma del desarrollador («Built by»). Apaisado, se muestra a 16 px de alto.
- `fondo.svg`: fondo de la aplicación (las olas), abajo y a todo lo ancho, detrás del inicio y
  de los paneles. Se tiñe del color primario y se deja muy tenue dentro del propio SVG.

El icono de la aplicación (Windows/macOS) se genera aparte con `npx tauri icon`.

Los SVG exportados de Illustrator traen todo el documento: hay que dejar solo la capa del dibujo
(lo demás aumenta el tamaño y podría aparecer).
