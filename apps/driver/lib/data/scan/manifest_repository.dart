import 'dart:convert';

import '../../core/network/api_client.dart';
import '../../domain/scan/scan_models.dart';
import '../local/app_database.dart';

/// Descarga la lista de pasajeros de la planta del viaje.
class ManifestApi {
  ManifestApi(this._api);

  final ApiClient _api;

  Future<TripManifest> fetch(String tripId) async => TripManifest.fromJson(
    await _api.get<Map<String, dynamic>>('/driver/trips/$tripId/manifest'),
  );
}

/// Lista y escaneos del viaje guardados en el celular (sobreviven a un reinicio sin señal).
class ManifestStore {
  ManifestStore(this._db, {DateTime Function()? clock})
    : _clock = clock ?? DateTime.now;

  final AppDatabase _db;
  final DateTime Function() _clock;

  Future<void> _put(String key, Object json) => _db
      .into(_db.snapshots)
      .insertOnConflictUpdate(
        SnapshotsCompanion.insert(
          key: key,
          payload: jsonEncode(json),
          savedAt: _clock(),
        ),
      );

  Future<Object?> _get(String key) async {
    final row = await (_db.select(
      _db.snapshots,
    )..where((s) => s.key.equals(key))).getSingleOrNull();
    return row == null ? null : jsonDecode(row.payload);
  }

  Future<void> save(TripManifest manifest) =>
      _put('manifest:${manifest.tripId}', manifest.toJson());

  Future<TripManifest?> load(String tripId) async {
    final json = await _get('manifest:$tripId');
    return json is Map<String, dynamic> ? TripManifest.fromJson(json) : null;
  }

  /// Pasajeros escaneados en este celular durante el viaje.
  Future<Set<String>> scanned(String tripId) async {
    final json = await _get('scanned:$tripId');
    return json is List ? json.cast<String>().toSet() : <String>{};
  }

  Future<void> markScanned(String tripId, String passengerId) async {
    final current = await scanned(tripId);
    if (current.add(passengerId)) {
      await _put('scanned:$tripId', current.toList());
    }
  }
}
