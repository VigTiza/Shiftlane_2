import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/logging/app_logger.dart';
import '../../data/tracking/geolocator_tracker.dart';
import '../../domain/tracking/gps_fix.dart';
import '../../domain/trips/trip_models.dart';
import '../providers.dart';
import '../sync/sync_coordinator.dart';
import '../trips/trips_controller.dart';

final locationTrackerProvider = Provider<LocationTracker>(
  (ref) => GeolocatorTracker(),
);

class TrackingState {
  const TrackingState({this.tripId});

  /// Viaje del que se está enviando la ubicación (null: GPS apagado).
  final String? tripId;

  bool get active => tripId != null;
}

/// Última lectura del GPS durante el viaje (null sin viaje). Va aparte del seguimiento para
/// que las acciones del viaje la lean sin depender de él.
class LastPosition extends Notifier<GpsFix?> {
  @override
  GpsFix? build() => null;

  void set(GpsFix? fix) => state = fix;
}

final lastPositionProvider = NotifierProvider<LastPosition, GpsFix?>(
  LastPosition.new,
);

/// Ubicación solo durante el viaje: al iniciar se enciende el GPS con la notificación «Viaje
/// en curso» y se guarda una posición cada 10 s en la cola; al terminar se apaga.
class TripTracking extends Notifier<TrackingState> {
  final _log = appLogger('tracking');
  StreamSubscription<GpsFix>? _subscription;
  GpsFix? _lastRecorded;

  @override
  TrackingState build() {
    ref.listen(currentTripProvider, (_, trip) => _follow(trip));
    Future.microtask(() {
      if (ref.mounted) _follow(ref.read(currentTripProvider));
    });
    ref.onDispose(() => _subscription?.cancel());
    return const TrackingState();
  }

  void _follow(DriverTrip? trip) {
    final tripId = trip?.status == TripStatus.inProgress ? trip!.id : null;
    if (tripId == state.tripId) return;
    unawaited(_subscription?.cancel());
    _subscription = null;
    _lastRecorded = null;
    state = TrackingState(tripId: tripId);
    ref.read(lastPositionProvider.notifier).set(null);
    if (tripId == null) {
      _log.info('Viaje terminado: GPS apagado');
      return;
    }
    _log.info('Viaje $tripId en curso: GPS encendido');
    _subscription = ref
        .read(locationTrackerProvider)
        .watch()
        .listen(
          (fix) => unawaited(_onFix(tripId, fix)),
          // Sin GPS el viaje sigue: solo se pierde la ubicación.
          onError: (Object error) => _log.warning('GPS no disponible: $error'),
        );
  }

  Future<void> _onFix(String tripId, GpsFix fix) async {
    if (state.tripId != tripId) return;
    ref.read(lastPositionProvider.notifier).set(fix);
    if (!shouldRecord(_lastRecorded, fix)) return;
    _lastRecorded = fix;
    await ref.read(outboxServiceProvider).recordPosition(tripId, fix);
    if (ref.mounted) {
      unawaited(ref.read(syncCoordinatorProvider.notifier).syncNow());
    }
  }
}

final tripTrackingProvider = NotifierProvider<TripTracking, TrackingState>(
  TripTracking.new,
);

/// Última posición conocida durante el viaje (para el aviso de parada y las acciones).
final positionProvider = Provider<({double lat, double lng})?>(
  (ref) => ref.watch(lastPositionProvider.select((fix) => fix?.point)),
);
