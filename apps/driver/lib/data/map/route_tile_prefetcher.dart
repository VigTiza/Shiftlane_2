import 'package:flutter_map/flutter_map.dart';
import 'package:http/http.dart' as http;

import '../../core/logging/app_logger.dart';
import '../../domain/map/tiles.dart';
import '../../domain/trips/trip_models.dart';

/// Guarda en el celular los mosaicos de las rutas del día (en el caché de flutter_map) para
/// ver el mapa aunque se pierda la señal en el camino.
class RouteTilePrefetcher {
  RouteTilePrefetcher({
    required this.urlTemplate,
    MapCachingProvider? cache,
    http.Client? client,
  }) : _cache = cache ?? BuiltInMapCachingProvider.getOrCreateInstance(),
       _client = client ?? http.Client();

  final String urlTemplate;
  final MapCachingProvider _cache;
  final http.Client _client;
  final _log = appLogger('map');

  /// Devuelve cuántos mosaicos nuevos se guardaron.
  Future<int> prefetch(Iterable<DriverTrip> trips) async {
    if (!_cache.isSupported) return 0;
    var saved = 0;
    for (final trip in trips) {
      final tiles = tilesForRoute([
        for (final stop in trip.stops) (lat: stop.lat, lng: stop.lng),
      ]);
      for (final tile in tiles) {
        final url = tileUrl(urlTemplate, tile);
        try {
          if (await _cache.getTile(url) != null) continue;
          final response = await _client.get(
            Uri.parse(url),
            headers: {'User-Agent': 'mx.shiftlane.driver'},
          );
          if (response.statusCode != 200) continue;
          await _cache.putTile(
            url: url,
            metadata: CachedMapTileMetadata.fromHttpHeaders(
              response.headers,
              fallbackFreshnessAge: const Duration(days: 30),
            ),
            bytes: response.bodyBytes,
          );
          saved += 1;
        } on Exception catch (error) {
          // Sin señal o el servidor de mapas falló: se intenta en la siguiente carga.
          _log.info('No se guardó el mosaico $url: $error');
          return saved;
        }
      }
    }
    return saved;
  }
}
