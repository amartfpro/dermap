// Dermap · módulo de geometría
//
// Aplana una zona del cuerpo (parche o manga) en un lienzo 2D con libigl.
// Se compila a WebAssembly con wasi-sdk (ver scripts/compilar-geometria.sh) y se usa
// desde src/geometria/ en un Web Worker. Las unidades de entrada se conservan:
// si la malla está en centímetros, las coordenadas del lienzo salen en centímetros.
//
// Interfaz C mínima: el llamador reserva memoria con dm_reservar, llama a dm_aplanar
// y lee los resultados con las funciones dm_resultado_*.

#include <Eigen/Core>
#include <Eigen/Dense>
#include <Eigen/Sparse>
#include <igl/boundary_loop.h>
#include <igl/cut_mesh.h>
#include <igl/lscm.h>
#include <igl/slim.h>

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <limits>
#include <queue>
#include <utility>
#include <vector>

#define EXPORTAR(nombre) __attribute__((export_name(#nombre)))

namespace {

// Códigos de resultado de dm_aplanar.
enum Codigo : int {
  OK = 0,
  TOPOLOGIA_NO_VALIDA = 1,  // la zona no tiene 1 borde (parche) ni 2 (manga)
  CORTE_IMPOSIBLE = 2,      // no hay camino entre los dos bordes de la manga
  CORTE_NO_VALIDO = 3,      // los extremos indicados no están en bordes distintos
  APLANADO_FALLIDO = 4,     // LSCM no converge
};

struct Resultado {
  int codigo = OK;
  int bordes = 0;
  std::vector<double> uv;           // nV' x 2, coordenadas en el lienzo
  std::vector<int> caras;           // nF x 3, sobre los vértices cortados
  std::vector<int> origen;          // nV', vértice original de cada vértice cortado
  std::vector<int> corte;           // vértices originales del camino de corte, en orden
  std::vector<double> estiramiento; // nF x 2, valores singulares (σ1 ≥ σ2) de cada triángulo
  int volteados = 0;                // triángulos invertidos tras el aplanado
};

Resultado resultado;

using Arista = std::pair<int, int>;

// Camino mínimo (Dijkstra) por las aristas de la malla desde `desde` hasta cualquier
// vértice marcado en `destino`. Las aristas de borde se penalizan para que el corte
// cruce la piel en lugar de recorrer el borde de la zona.
std::vector<int> camino_minimo(const Eigen::MatrixXd& V, const Eigen::MatrixXi& F,
                               int desde, const std::vector<char>& destino,
                               const std::vector<char>& en_borde) {
  const int n = static_cast<int>(V.rows());
  std::vector<std::vector<std::pair<int, double>>> vecinos(n);
  for (int f = 0; f < F.rows(); ++f) {
    for (int j = 0; j < 3; ++j) {
      const int a = F(f, j), b = F(f, (j + 1) % 3);
      double peso = (V.row(a) - V.row(b)).norm();
      if (en_borde[a] && en_borde[b]) peso *= 1000.0;
      vecinos[a].push_back({b, peso});
      vecinos[b].push_back({a, peso});
    }
  }
  std::vector<double> distancia(n, std::numeric_limits<double>::infinity());
  std::vector<int> anterior(n, -1);
  using Nodo = std::pair<double, int>;
  std::priority_queue<Nodo, std::vector<Nodo>, std::greater<Nodo>> cola;
  distancia[desde] = 0.0;
  cola.push({0.0, desde});
  int llegada = -1;
  while (!cola.empty()) {
    auto [d, v] = cola.top();
    cola.pop();
    if (d > distancia[v]) continue;
    if (destino[v] && v != desde) {
      llegada = v;
      break;
    }
    for (auto [w, peso] : vecinos[v]) {
      if (d + peso < distancia[w]) {
        distancia[w] = d + peso;
        anterior[w] = v;
        cola.push({distancia[w], w});
      }
    }
  }
  std::vector<int> camino;
  for (int v = llegada; v != -1; v = anterior[v]) camino.push_back(v);
  std::reverse(camino.begin(), camino.end());
  return camino;
}

// Vértice de un borde con menor proyección sobre `direccion` (p. ej. la cara interna del brazo).
int extremo_por_direccion(const Eigen::MatrixXd& V, const std::vector<int>& borde,
                          const Eigen::RowVector3d& direccion) {
  int mejor = borde.front();
  double minimo = std::numeric_limits<double>::infinity();
  for (int v : borde) {
    const double p = V.row(v).dot(direccion);
    if (p < minimo) {
      minimo = p;
      mejor = v;
    }
  }
  return mejor;
}

// Marca como corte, en la convención de libigl (arista j de la cara f = F(f,j) → F(f,j+1)),
// todas las aristas que unen vértices consecutivos de los caminos (separados por -1).
Eigen::MatrixXi marcas_de_corte(const Eigen::MatrixXi& F, const std::vector<int>& caminos) {
  std::vector<Arista> aristas;
  for (size_t i = 0; i + 1 < caminos.size(); ++i)
    if (caminos[i] >= 0 && caminos[i + 1] >= 0) aristas.push_back(std::minmax(caminos[i], caminos[i + 1]));
  std::sort(aristas.begin(), aristas.end());
  Eigen::MatrixXi C = Eigen::MatrixXi::Zero(F.rows(), 3);
  for (int f = 0; f < F.rows(); ++f)
    for (int j = 0; j < 3; ++j) {
      const Arista e = std::minmax(F(f, j), F(f, (j + 1) % 3));
      if (std::binary_search(aristas.begin(), aristas.end(), e)) C(f, j) = 1;
    }
  return C;
}

// Valores singulares del jacobiano 3D → 2D de cada triángulo: cuánto se estira (σ > 1)
// o se comprime (σ < 1) el dibujo en cada dirección. Una isometría perfecta da σ1 = σ2 = 1.
void medir_deformacion(const Eigen::MatrixXd& V, const Eigen::MatrixXi& F,
                       const Eigen::MatrixXd& UV) {
  resultado.estiramiento.assign(F.rows() * 2, 1.0);
  int positivos = 0, negativos = 0;
  std::vector<double> signo(F.rows());
  for (int f = 0; f < F.rows(); ++f) {
    const Eigen::Vector3d p0 = V.row(F(f, 0)), p1 = V.row(F(f, 1)), p2 = V.row(F(f, 2));
    // Base ortonormal local del triángulo 3D.
    const Eigen::Vector3d e1 = p1 - p0, e2 = p2 - p0;
    const Eigen::Vector3d x = e1.normalized();
    const Eigen::Vector3d z = e1.cross(e2).normalized();
    const Eigen::Vector3d y = z.cross(x);
    Eigen::Matrix2d P;  // aristas en 2D local
    P << e1.dot(x), e2.dot(x), e1.dot(y), e2.dot(y);
    const Eigen::Vector2d q0 = UV.row(F(f, 0)), q1 = UV.row(F(f, 1)), q2 = UV.row(F(f, 2));
    Eigen::Matrix2d Q;
    Q.col(0) = q1 - q0;
    Q.col(1) = q2 - q0;
    const Eigen::Matrix2d J = Q * P.inverse();
    const Eigen::JacobiSVD<Eigen::Matrix2d> svd(J);
    resultado.estiramiento[2 * f] = svd.singularValues()(0);
    resultado.estiramiento[2 * f + 1] = svd.singularValues()(1);
    signo[f] = J.determinant();
    (signo[f] >= 0 ? positivos : negativos)++;
  }
  // La orientación global es libre (el lienzo puede salir en espejo); se cuentan como
  // volteados los triángulos con orientación contraria a la mayoría.
  resultado.volteados = std::min(positivos, negativos);
}

}  // namespace

extern "C" {

EXPORTAR(dm_reservar) void* dm_reservar(int bytes) { return std::malloc(bytes); }
EXPORTAR(dm_liberar) void dm_liberar(void* p) { std::free(p); }

// Aplana la zona V (nV x 3, double) / F (nF x 3, int32).
// direccion: vector hacia el que NO va el corte por defecto (se corta por el lado de menor
//            proyección; para un brazo, pasar la normal de su cara externa).
// extremo_a, extremo_b: vértices de inicio y fin del corte en cada borde, o -1 para
//            elegirlos automáticamente.
// iteraciones: iteraciones de SLIM tras la inicialización con LSCM.
// extra, nExtra: cortes adicionales (RF-25) como caminos de vértices separados por -1; cada
//            uno debe empezar en un borde. Se devuelven en dm_resultado_corte tras el principal.
EXPORTAR(dm_aplanar)
int dm_aplanar(const double* vertices, int nV, const int* caras, int nF, double dx, double dy,
               double dz, int extremo_a, int extremo_b, int iteraciones, const int* extra, int nExtra) {
  resultado = Resultado{};
  Eigen::MatrixXd V = Eigen::Map<const Eigen::Matrix<double, Eigen::Dynamic, 3, Eigen::RowMajor>>(vertices, nV, 3);
  Eigen::MatrixXi F = Eigen::Map<const Eigen::Matrix<int, Eigen::Dynamic, 3, Eigen::RowMajor>>(caras, nF, 3);

  // 1. Topología: un borde = parche, dos = manga.
  std::vector<std::vector<int>> bordes;
  igl::boundary_loop(F, bordes);
  resultado.bordes = static_cast<int>(bordes.size());
  if (bordes.empty() || bordes.size() > 2) return resultado.codigo = TOPOLOGIA_NO_VALIDA;

  Eigen::MatrixXd Vc = V;
  Eigen::MatrixXi Fc = F;
  Eigen::VectorXi I = Eigen::VectorXi::LinSpaced(nV, 0, nV - 1);
  std::vector<int> cortes;  // todos los caminos a cortar, separados por -1

  // Corte manual (RF-22): con extremo_a == -2, el primer camino de `extra` (hasta el primer -1)
  // es el corte principal trazado por el usuario; el resto son cortes adicionales.
  std::vector<int> manual;
  if (extremo_a == -2) {
    int k = 0;
    while (k < nExtra && extra[k] >= 0) manual.push_back(extra[k++]);
    if (k < nExtra) k++;  // salta el -1
    extra = nExtra > k ? extra + k : nullptr;
    nExtra = nExtra > k ? nExtra - k : 0;
    if (bordes.size() != 2 || manual.size() < 2) return resultado.codigo = CORTE_NO_VALIDO;
  }

  // 2. Corte de borde a borde (solo mangas).
  if (bordes.size() == 2 && !manual.empty()) {
    std::vector<char> en_a(nV, 0), en_b(nV, 0);
    for (int v : bordes[0]) en_a[v] = 1;
    for (int v : bordes[1]) en_b[v] = 1;
    for (int v : manual)
      if (v < 0 || v >= nV) return resultado.codigo = CORTE_NO_VALIDO;
    const int ini = manual.front(), fin = manual.back();
    // RF-24: debe ir de un borde al otro.
    if (!((en_a[ini] && en_b[fin]) || (en_b[ini] && en_a[fin]))) return resultado.codigo = CORTE_NO_VALIDO;
    resultado.corte = manual;
    cortes = manual;
  } else if (bordes.size() == 2) {
    std::vector<char> en_borde(nV, 0), en_a(nV, 0), en_b(nV, 0);
    for (int v : bordes[0]) en_borde[v] = en_a[v] = 1;
    for (int v : bordes[1]) en_borde[v] = en_b[v] = 1;
    const Eigen::RowVector3d dir(dx, dy, dz);
    int a = extremo_a >= 0 ? extremo_a : extremo_por_direccion(V, bordes[0], dir);
    if (a >= nV) return resultado.codigo = CORTE_NO_VALIDO;
    if (en_b[a]) std::swap(en_a, en_b);
    if (!en_a[a]) return resultado.codigo = CORTE_NO_VALIDO;
    std::vector<char> destino = en_b;
    if (extremo_b >= 0) {
      if (extremo_b >= nV || !en_b[extremo_b]) return resultado.codigo = CORTE_NO_VALIDO;
      std::fill(destino.begin(), destino.end(), 0);
      destino[extremo_b] = 1;
    }
    resultado.corte = camino_minimo(V, F, a, destino, en_borde);
    if (resultado.corte.size() < 2) return resultado.codigo = CORTE_IMPOSIBLE;
    cortes = resultado.corte;
  }

  // Cortes adicionales (pinzas): se añaden a las aristas que se abren.
  if (extra && nExtra > 0) {
    std::vector<int> adicionales(extra, extra + nExtra);
    for (int v : adicionales)
      if (v >= nV) return resultado.codigo = CORTE_NO_VALIDO;
    if (!cortes.empty()) cortes.push_back(-1);
    cortes.insert(cortes.end(), adicionales.begin(), adicionales.end());
    if (!resultado.corte.empty()) resultado.corte.push_back(-1);
    resultado.corte.insert(resultado.corte.end(), adicionales.begin(), adicionales.end());
  }
  if (!cortes.empty()) {
    const Eigen::MatrixXi C = marcas_de_corte(F, cortes);
    igl::cut_mesh(Vc, Fc, C, I);
  }

  // 3. Inicialización conforme (LSCM) fijando dos vértices alejados del borde.
  std::vector<int> borde;
  igl::boundary_loop(Fc, borde);
  int v0 = borde.front(), v1 = v0;
  double lejos = -1.0;
  for (int v : borde) {
    const double d = (Vc.row(v) - Vc.row(v0)).squaredNorm();
    if (d > lejos) {
      lejos = d;
      v1 = v;
    }
  }
  Eigen::VectorXi b(2);
  b << v0, v1;
  Eigen::MatrixXd bc(2, 2);
  bc << 0, 0, std::sqrt(lejos), 0;
  Eigen::MatrixXd UV;
  if (!igl::lscm(Vc, Fc, b, bc, UV)) return resultado.codigo = APLANADO_FALLIDO;

  // LSCM conserva ángulos pero no la escala: se reescala para igualar el área 3D.
  double area3d = 0.0, area2d = 0.0;
  for (int f = 0; f < Fc.rows(); ++f) {
    const Eigen::Vector3d a3 = Vc.row(Fc(f, 1)) - Vc.row(Fc(f, 0));
    const Eigen::Vector3d b3 = Vc.row(Fc(f, 2)) - Vc.row(Fc(f, 0));
    area3d += 0.5 * a3.cross(b3).norm();
    const Eigen::Vector2d a2 = UV.row(Fc(f, 1)) - UV.row(Fc(f, 0));
    const Eigen::Vector2d b2 = UV.row(Fc(f, 2)) - UV.row(Fc(f, 0));
    area2d += 0.5 * std::abs(a2.x() * b2.y() - a2.y() * b2.x());
  }
  UV *= std::sqrt(area3d / area2d);

  // 4. Refinado con SLIM (Dirichlet simétrico): minimiza la deformación de longitudes
  //    sin permitir triángulos invertidos.
  if (iteraciones > 0) {
    igl::SLIMData datos;
    Eigen::VectorXi sin_fijos;
    Eigen::MatrixXd sin_valores;
    igl::slim_precompute(Vc, Fc, UV, datos, igl::MappingEnergyType::SYMMETRIC_DIRICHLET,
                         sin_fijos, sin_valores, 0.0);
    UV = igl::slim_solve(datos, iteraciones);
  }

  medir_deformacion(Vc, Fc, UV);

  resultado.uv.resize(UV.rows() * 2);
  for (int i = 0; i < UV.rows(); ++i) {
    resultado.uv[2 * i] = UV(i, 0);
    resultado.uv[2 * i + 1] = UV(i, 1);
  }
  resultado.caras.resize(Fc.rows() * 3);
  for (int f = 0; f < Fc.rows(); ++f)
    for (int j = 0; j < 3; ++j) resultado.caras[3 * f + j] = Fc(f, j);
  resultado.origen.assign(I.data(), I.data() + I.size());
  return resultado.codigo = OK;
}

EXPORTAR(dm_resultado_bordes) int dm_resultado_bordes() { return resultado.bordes; }
EXPORTAR(dm_resultado_volteados) int dm_resultado_volteados() { return resultado.volteados; }
EXPORTAR(dm_resultado_num_vertices) int dm_resultado_num_vertices() { return static_cast<int>(resultado.origen.size()); }
EXPORTAR(dm_resultado_num_caras) int dm_resultado_num_caras() { return static_cast<int>(resultado.caras.size() / 3); }
EXPORTAR(dm_resultado_num_corte) int dm_resultado_num_corte() { return static_cast<int>(resultado.corte.size()); }
EXPORTAR(dm_resultado_uv) const double* dm_resultado_uv() { return resultado.uv.data(); }
EXPORTAR(dm_resultado_caras) const int* dm_resultado_caras() { return resultado.caras.data(); }
EXPORTAR(dm_resultado_origen) const int* dm_resultado_origen() { return resultado.origen.data(); }
EXPORTAR(dm_resultado_corte) const int* dm_resultado_corte() { return resultado.corte.data(); }
EXPORTAR(dm_resultado_estiramiento) const double* dm_resultado_estiramiento() { return resultado.estiramiento.data(); }

}  // extern "C"
