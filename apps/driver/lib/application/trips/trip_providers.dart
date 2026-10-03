import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../data/map/route_tile_prefetcher.dart';
import '../../data/sync/sync_api.dart';
import '../../data/trips/api_trip_repository.dart';
import '../../domain/trips/trip_models.dart';
import '../providers.dart';
import '../sync/sync_service.dart';

final tripRepositoryProvider = Provider<TripRepository>(
  (ref) => ApiTripRepository(ref.watch(apiClientProvider)),
);

final syncApiProvider = Provider<SyncApi>(
  (ref) => SyncApi(ref.watch(apiClientProvider)),
);

final syncServiceProvider = Provider<SyncService>(
  (ref) => SyncService(
    outbox: ref.watch(outboxRepositoryProvider),
    api: ref.watch(syncApiProvider),
  ),
);

/// Posición del celular para las acciones y el aviso de parada (F07-P05 la llena con el GPS).
abstract interface class LocationSource {
  Future<({double lat, double lng})?> current();

  /// Posiciones mientras el viaje está en curso.
  Stream<({double lat, double lng})> watch();
}

class NoLocationSource implements LocationSource {
  const NoLocationSource();

  @override
  Future<({double lat, double lng})?> current() async => null;

  @override
  Stream<({double lat, double lng})> watch() => const Stream.empty();
}

final locationSourceProvider = Provider<LocationSource>(
  (ref) => const NoLocationSource(),
);

/// Última posición conocida durante el viaje.
final positionProvider = StreamProvider<({double lat, double lng})>(
  (ref) => ref.watch(locationSourceProvider).watch(),
);

/// Mostrar los mosaicos del mapa (en las pruebas no hay red).
final mapTilesEnabledProvider = Provider<bool>((ref) => true);

/// Foto tomada con la cámara (bytes y nombre), o null si el chofer canceló.
typedef PhotoCapture = Future<({List<int> bytes, String name})?> Function();

final photoCaptureProvider = Provider<PhotoCapture>((ref) {
  return () async {
    final file = await ImagePicker().pickImage(
      source: ImageSource.camera,
      imageQuality: 60,
      maxWidth: 1600,
    );
    if (file == null) return null;
    return (bytes: await file.readAsBytes(), name: file.name);
  };
});

final routeTilePrefetcherProvider = Provider<RouteTilePrefetcher>(
  (ref) => RouteTilePrefetcher(
    urlTemplate: ref.watch(appConfigProvider).tileUrlTemplate,
  ),
);
