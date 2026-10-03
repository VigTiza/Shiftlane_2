import 'dart:math' as math;

typedef TileCoord = ({int z, int x, int y});

/// Mosaico que contiene un punto a un nivel de acercamiento (esquema XYZ).
TileCoord tileFor(double lat, double lng, int z) {
  final n = 1 << z;
  final x = ((lng + 180) / 360 * n).floor().clamp(0, n - 1);
  final latRad = lat * math.pi / 180;
  final y =
      ((1 - math.log(math.tan(latRad) + 1 / math.cos(latRad)) / math.pi) /
              2 *
              n)
          .floor()
          .clamp(0, n - 1);
  return (z: z, x: x, y: y);
}

/// Mosaicos que cubren los puntos de una ruta (con margen) en varios acercamientos, sin
/// pasar de `maxTiles` (los acercamientos lejanos primero: son los más útiles sin señal).
List<TileCoord> tilesForRoute(
  List<({double lat, double lng})> points, {
  List<int> zooms = const [12, 13, 14, 15],
  double paddingDegrees = 0.01,
  int maxTiles = 400,
}) {
  if (points.isEmpty) return const [];
  final minLat = points.map((p) => p.lat).reduce(math.min) - paddingDegrees;
  final maxLat = points.map((p) => p.lat).reduce(math.max) + paddingDegrees;
  final minLng = points.map((p) => p.lng).reduce(math.min) - paddingDegrees;
  final maxLng = points.map((p) => p.lng).reduce(math.max) + paddingDegrees;
  final tiles = <TileCoord>[];
  for (final z in zooms) {
    final topLeft = tileFor(maxLat, minLng, z);
    final bottomRight = tileFor(minLat, maxLng, z);
    for (var x = topLeft.x; x <= bottomRight.x; x++) {
      for (var y = topLeft.y; y <= bottomRight.y; y++) {
        if (tiles.length >= maxTiles) return tiles;
        tiles.add((z: z, x: x, y: y));
      }
    }
  }
  return tiles;
}

String tileUrl(String template, TileCoord tile) => template
    .replaceAll('{z}', '${tile.z}')
    .replaceAll('{x}', '${tile.x}')
    .replaceAll('{y}', '${tile.y}');
