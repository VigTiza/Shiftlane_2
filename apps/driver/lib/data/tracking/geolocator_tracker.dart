import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../domain/tracking/gps_fix.dart';

/// GPS con geolocator. En Android corre como servicio en primer plano con la notificación
/// fija «Viaje en curso», así el sistema no lo detiene con la pantalla apagada. Al cancelar
/// el stream (fin del viaje) se apaga el GPS y desaparece la notificación.
class GeolocatorTracker implements LocationTracker {
  @override
  Stream<GpsFix> watch() async* {
    final android = defaultTargetPlatform == TargetPlatform.android;
    if (android) {
      // Android 13+: sin este permiso la notificación no se ve (el servicio sí corre).
      await Permission.notification.request();
    }
    final settings = android
        ? AndroidSettings(
            accuracy: LocationAccuracy.high,
            distanceFilter: 0,
            intervalDuration: positionInterval,
            foregroundNotificationConfig: const ForegroundNotificationConfig(
              notificationTitle: 'Viaje en curso',
              notificationText: 'Shiftlane comparte tu ubicación solo mientras dura el viaje.',
              notificationChannelName: 'Viaje en curso',
              enableWakeLock: true,
              setOngoing: true,
            ),
          )
        : const LocationSettings(accuracy: LocationAccuracy.high);
    yield* Geolocator.getPositionStream(locationSettings: settings).map(_toFix);
  }

  static GpsFix _toFix(Position p) => GpsFix(
    lat: p.latitude,
    lng: p.longitude,
    recordedAt: p.timestamp,
    speedKmh: p.speed >= 0 ? p.speed * 3.6 : null,
    heading: p.heading >= 0 ? p.heading : null,
    accuracyM: p.accuracy >= 0 ? p.accuracy : null,
  );
}
