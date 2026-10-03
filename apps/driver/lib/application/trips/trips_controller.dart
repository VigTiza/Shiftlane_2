import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors/app_failure.dart';
import '../../core/logging/app_logger.dart';
import '../../data/sync/sync_api.dart';
import '../../domain/trips/pending_overlay.dart';
import '../../domain/trips/trip_models.dart';
import '../providers.dart';
import '../sync/sync_coordinator.dart';
import '../tracking/trip_tracking.dart';
import 'trip_providers.dart';

/// Viajes del día y las acciones del chofer. Cada acción se guarda primero en la cola local
/// (con su UUID) y se envía en seguida por /sync/batch: con o sin señal el chofer sigue.
/// La lista se guarda en el celular para abrir sin señal (por ejemplo, tras un reinicio).
class TripsController extends AsyncNotifier<List<DriverTrip>> {
  final _log = appLogger('trips');

  @override
  Future<List<DriverTrip>> build() => _load();

  Future<void> refresh() async {
    state = await AsyncValue.guard(_load);
  }

  /// Del servidor más lo que sigue en la cola; sin señal, la copia guardada.
  Future<List<DriverTrip>> _load() async {
    final snapshots = ref.read(tripSnapshotStoreProvider);
    try {
      final trips = await ref.read(tripRepositoryProvider).todayTrips();
      final pending = await ref
          .read(outboxRepositoryProvider)
          .pending(limit: 5000, positions: false);
      final merged = applyPendingEvents(trips, pending);
      await snapshots.save(merged);
      return merged;
    } on AppFailure catch (failure) {
      final saved = await snapshots.load();
      if (saved == null) rethrow;
      _log.info('Viajes desde la copia del celular: ${failure.message}');
      return saved;
    }
  }

  /// Llegadas a parada que el servidor detectó con las posiciones GPS.
  void applyServerArrivals(List<AutoArrival> arrivals) {
    for (final arrival in arrivals) {
      final trip = _trips.where((t) => t.id == arrival.tripId).firstOrNull;
      if (trip == null || trip.stopsArrived.contains(arrival.stopId)) continue;
      _replace(
        trip.copyWith(stopsArrived: {...trip.stopsArrived, arrival.stopId}),
      );
    }
  }

  List<DriverTrip> get _trips => state.value ?? const [];

  /// El viaje en curso, o el siguiente por iniciar.
  DriverTrip? get current =>
      _trips.where((t) => t.status == TripStatus.inProgress).firstOrNull ??
      _trips.where((t) => t.status == TripStatus.scheduled).firstOrNull;

  void _replace(DriverTrip trip) {
    state = AsyncData([for (final t in _trips) t.id == trip.id ? trip : t]);
    unawaited(ref.read(tripSnapshotStoreProvider).save(_trips));
  }

  DriverTrip _byId(String id) => _trips.firstWhere((t) => t.id == id);

  Future<ActionResult> _perform(
    String type, {
    String? tripId,
    Map<String, Object?> data = const {},
    bool withLocation = true,
  }) async {
    final position = withLocation ? ref.read(lastPositionProvider) : null;
    final event = await ref
        .read(outboxServiceProvider)
        .record(
          type,
          tripId: tripId,
          data: {
            ...data,
            if (position != null) 'lat': position.lat,
            if (position != null) 'lng': position.lng,
          },
        );
    final report = await ref.read(syncCoordinatorProvider.notifier).syncNow();
    final result =
        report.results[event.id] ?? const ActionResult(SyncStatus.queued);
    if (!result.accepted) _log.info('$type rechazado: ${result.message}');
    return result;
  }

  /// Envía el checklist. Sin señal se da por aprobado si todos los puntos están bien.
  Future<ActionResult> submitChecklist(
    String tripId,
    List<({String key, bool ok, String? note, String? photoId})> items,
  ) async {
    final result = await _perform(
      'checklist',
      tripId: tripId,
      withLocation: false,
      data: {
        'items': [
          for (final item in items)
            {
              'key': item.key,
              'ok': item.ok,
              'note': ?item.note,
              'photoId': ?item.photoId,
            },
        ],
      },
    );
    if (result.accepted) {
      final passed =
          result.result?['passed'] as bool? ?? items.every((i) => i.ok);
      _replace(
        _byId(tripId).copyWith(checklistDone: true, checklistPassed: passed),
      );
    }
    return result;
  }

  Future<ActionResult> start(String tripId) async {
    final result = await _perform('start', tripId: tripId);
    if (result.accepted) {
      _replace(_byId(tripId).copyWith(status: TripStatus.inProgress));
    }
    return result;
  }

  Future<ActionResult> arriveStop(String tripId, String stopId) async {
    final result = await _perform(
      'stop_arrived',
      tripId: tripId,
      data: {'stopId': stopId},
    );
    if (result.accepted) {
      final trip = _byId(tripId);
      _replace(trip.copyWith(stopsArrived: {...trip.stopsArrived, stopId}));
    }
    return result;
  }

  /// Escaneo de un pasajero (credencial, gafete o número de empleado).
  Future<ActionResult> scan(
    String tripId, {
    String? code,
    String? employeeNumber,
  }) async {
    final result = await _perform(
      'scan',
      tripId: tripId,
      data: {'code': ?code, 'employeeNumber': ?employeeNumber},
    );
    final onboard = result.result?['onboard'] as int?;
    final trip = _byId(tripId);
    if (onboard != null) {
      _replace(trip.copyWith(onboard: onboard));
    } else if (result.status == SyncStatus.queued) {
      // Sin señal: se cuenta en el celular hasta que el servidor confirme.
      _replace(trip.copyWith(onboard: trip.onboard + 1));
    }
    return result;
  }

  Future<ActionResult> reportIncident(
    String tripId,
    IncidentType type, {
    String? description,
    List<String> photoIds = const [],
  }) => _perform(
    'incident',
    tripId: tripId,
    data: {
      'type': type.apiName,
      if (description != null && description.isNotEmpty)
        'description': description,
      'photoIds': photoIds,
    },
  );

  /// Pánico: siempre se acepta, con o sin viaje y con o sin señal.
  Future<ActionResult> panic({String? tripId}) =>
      _perform('panic', tripId: tripId);

  Future<ActionResult> gate(String tripId, String code) =>
      _perform('gate', tripId: tripId, data: {'code': code});

  Future<ActionResult> finish(String tripId) async {
    final result = await _perform('finish', tripId: tripId);
    if (result.accepted) {
      _replace(_byId(tripId).copyWith(status: TripStatus.completed));
    }
    return result;
  }

  Future<List<ChecklistPoint>> checklistTemplate() =>
      ref.read(tripRepositoryProvider).checklistTemplate();

  Future<String> uploadPhoto(
    String tripId,
    String kind,
    List<int> bytes,
    String fileName,
  ) => ref
      .read(tripRepositoryProvider)
      .uploadPhoto(tripId, kind, bytes, fileName);
}

final tripsControllerProvider =
    AsyncNotifierProvider<TripsController, List<DriverTrip>>(
      TripsController.new,
    );

/// El viaje en curso o el siguiente por iniciar.
final currentTripProvider = Provider<DriverTrip?>((ref) {
  final trips = ref.watch(tripsControllerProvider).value ?? const [];
  return trips.where((t) => t.status == TripStatus.inProgress).firstOrNull ??
      trips.where((t) => t.status == TripStatus.scheduled).firstOrNull;
});
