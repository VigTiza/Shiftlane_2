import 'dart:convert';

import '../../domain/trips/trip_models.dart';
import '../local/app_database.dart';

/// Copia de los viajes del día en el celular: si se reinicia sin señal a mitad del viaje,
/// la app abre con el viaje en curso tal como lo dejó el chofer. Una copia por chofer (el
/// celular puede ser compartido entre turnos).
class TripSnapshotStore {
  TripSnapshotStore(this._db, {DateTime Function()? clock})
    : _clock = clock ?? DateTime.now;

  static String _key(String driverId) => 'driver_trips:$driverId';

  /// Una copia más vieja ya no sirve (es de otro día de trabajo).
  static const maxAge = Duration(hours: 24);

  final AppDatabase _db;
  final DateTime Function() _clock;

  Future<void> save(String driverId, List<DriverTrip> trips) async {
    await _db
        .into(_db.snapshots)
        .insertOnConflictUpdate(
          SnapshotsCompanion.insert(
            key: _key(driverId),
            payload: jsonEncode([for (final trip in trips) trip.toJson()]),
            savedAt: _clock(),
          ),
        );
  }

  Future<List<DriverTrip>?> load(String driverId) async {
    final row = await (_db.select(
      _db.snapshots,
    )..where((s) => s.key.equals(_key(driverId)))).getSingleOrNull();
    if (row == null || _clock().difference(row.savedAt) > maxAge) return null;
    return (jsonDecode(row.payload) as List<dynamic>)
        .cast<Map<String, dynamic>>()
        .map(DriverTrip.fromJson)
        .toList();
  }
}
