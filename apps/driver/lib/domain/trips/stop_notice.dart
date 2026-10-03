import 'dart:math' as math;

import 'trip_models.dart';

/// Distancia en metros entre dos puntos (fórmula del haversine).
double distanceMeters(
  ({double lat, double lng}) a,
  ({double lat, double lng}) b,
) {
  const earthRadius = 6371000.0;
  double rad(double degrees) => degrees * math.pi / 180;
  final dLat = rad(b.lat - a.lat);
  final dLng = rad(b.lng - a.lng);
  final h =
      math.pow(math.sin(dLat / 2), 2) +
      math.cos(rad(a.lat)) *
          math.cos(rad(b.lat)) *
          math.pow(math.sin(dLng / 2), 2);
  return 2 * earthRadius * math.asin(math.sqrt(h));
}

/// Aviso de la siguiente parada según la posición del celular.
class StopNotice {
  const StopNotice({required this.stop, required this.meters});

  final TripStop stop;
  final int meters;

  /// Ya está dentro del radio de la parada.
  bool get atStop => meters <= stop.radiusMeters;

  String get text => atStop
      ? 'Llegaste a ${stop.name}. Marca la parada.'
      : '${stop.name} a ${_distance(meters)}';

  static String _distance(int meters) =>
      meters < 1000 ? '$meters m' : '${(meters / 1000).toStringAsFixed(1)} km';
}

/// Aviso para la siguiente parada, o null si no hay posición, parada o está lejos.
StopNotice? stopNoticeFor(
  DriverTrip trip,
  ({double lat, double lng})? position, {
  int approachMeters = 800,
}) {
  final stop = trip.nextStop;
  if (position == null || stop == null) return null;
  final meters = distanceMeters(position, (
    lat: stop.lat,
    lng: stop.lng,
  )).round();
  if (meters > approachMeters) return null;
  return StopNotice(stop: stop, meters: meters);
}
