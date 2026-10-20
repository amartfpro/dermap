#!/usr/bin/env bash
# Compila geometria/dermap_geom.cpp a WebAssembly (src/geometria/dermap_geom.wasm).
#
# Solo hace falta si se modifica el C++: el .wasm compilado ya está en el repositorio.
#
# Requisitos (rutas configurables con variables de entorno):
#   WASI_SDK  wasi-sdk 25   https://github.com/WebAssembly/wasi-sdk/releases
#   LIBIGL    libigl 2.5.0  https://github.com/libigl/libigl  (carpeta include/)
#   EIGEN     Eigen 3.4     https://eigen.tuxfamily.org        (carpeta con Eigen/)
set -euo pipefail

raiz="$(cd "$(dirname "$0")/.." && pwd)"
: "${WASI_SDK:?Define WASI_SDK con la ruta de wasi-sdk}"
: "${LIBIGL:?Define LIBIGL con la ruta de libigl}"
: "${EIGEN:=/usr/include/eigen3}"

mkdir -p "$raiz/src/geometria"
"$WASI_SDK/bin/clang++" \
  --target=wasm32-wasip1 \
  --sysroot="$WASI_SDK/share/wasi-sysroot" \
  -std=c++17 -O3 -DNDEBUG \
  -fno-exceptions \
  -mexec-model=reactor \
  -DEIGEN_DONT_PARALLELIZE \
  -DFE_UNDERFLOW=0 \
  -I "$raiz/geometria/compat" -I "$EIGEN" -I "$LIBIGL/include" \
  -Wl,-z,stack-size=8388608 \
  -Wl,--strip-all -Wl,--initial-memory=33554432 -Wl,--max-memory=2147483648 \
  -Wl,--export=_initialize \
  -o "$raiz/src/geometria/dermap_geom.wasm" \
  "$raiz/geometria/dermap_geom.cpp"

echo "Generado: src/geometria/dermap_geom.wasm ($(du -h "$raiz/src/geometria/dermap_geom.wasm" | cut -f1))"
