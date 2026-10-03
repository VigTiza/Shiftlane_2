import '../outbox/outbox_event.dart';
import 'trip_models.dart';

/// Aplica a los viajes lo que el chofer hizo y todavía no llega al servidor (eventos en la
/// cola). Así, tras reiniciar el celular o recargar la lista, la pantalla muestra lo que de
/// verdad pasó: el viaje iniciado, las paradas visitadas y los pasajeros a bordo.
List<DriverTrip> applyPendingEvents(
  List<DriverTrip> trips,
  List<OutboxEvent> pending,
) {
  final byId = {for (final trip in trips) trip.id: trip};
  for (final event in pending) {
    final trip = byId[event.tripId];
    if (trip == null) continue;
    byId[trip.id] = switch (event.type) {
      'checklist' => trip.copyWith(
        checklistDone: true,
        checklistPassed: (event.data['items'] as List? ?? const []).every(
          (item) => (item as Map)['ok'] == true,
        ),
      ),
      'start' when trip.status == TripStatus.scheduled => trip.copyWith(
        status: TripStatus.inProgress,
      ),
      'stop_arrived' => trip.copyWith(
        stopsArrived: {...trip.stopsArrived, event.data['stopId']! as String},
      ),
      'scan' => trip.copyWith(onboard: trip.onboard + 1),
      'finish' => trip.copyWith(status: TripStatus.completed),
      _ => trip,
    };
  }
  return [for (final trip in trips) byId[trip.id]!];
}
