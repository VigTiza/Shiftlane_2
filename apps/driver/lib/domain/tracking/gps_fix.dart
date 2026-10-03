/// Lectura del GPS del celular.
class GpsFix {
  const GpsFix({
    required this.lat,
    required this.lng,
    required this.recordedAt,
    this.speedKmh,
    this.heading,
    this.accuracyM,
  });

  final double lat;
  final double lng;
  final DateTime recordedAt;
  final double? speedKmh;
  final double? heading;
  final double? accuracyM;

  ({double lat, double lng}) get point => (lat: lat, lng: lng);

  /// Punto como lo recibe `/driver/positions`.
  Map<String, Object?> toPointJson(String tripId, {int? battery}) => {
    'tripId': tripId,
    'recordedAt': recordedAt.toUtc().toIso8601String(),
    'lat': lat,
    'lng': lng,
    if (speedKmh != null) 'speedKmh': speedKmh!.clamp(0, 300),
    if (heading != null) 'heading': heading!.clamp(0, 360),
    if (accuracyM != null) 'accuracyM': accuracyM!.clamp(0, 10000),
    'battery': ?battery,
  };
}

/// GPS del celular con la notificación fija «Viaje en curso» (servicio en primer plano).
abstract interface class LocationTracker {
  /// Al escuchar se enciende el GPS; al cancelar la suscripción se apaga.
  Stream<GpsFix> watch();
}

/// Cada cuánto se guarda una posición durante el viaje.
const positionInterval = Duration(seconds: 10);

/// Lecturas con un margen de error mayor no se guardan (darían llegadas falsas).
const maxAccuracyMeters = 100.0;

/// ¿Se guarda esta lectura? Una cada [positionInterval] y solo si es precisa.
bool shouldRecord(GpsFix? last, GpsFix next) {
  if (next.accuracyM != null && next.accuracyM! > maxAccuracyMeters) {
    return false;
  }
  if (last == null) return true;
  return next.recordedAt.difference(last.recordedAt) >= positionInterval;
}
