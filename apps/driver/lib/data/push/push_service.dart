import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

import '../../core/config/environment.dart';
import '../../core/network/api_client.dart';

/// Aviso recibido por Firebase (mensaje del despachador, viaje cancelado o cambio de ruta).
class PushNotice {
  const PushNotice({
    required this.type,
    required this.data,
    this.title,
    this.body,
    this.openedFromTray = false,
  });

  /// message, trip_cancelled o route_changed (lo manda la API en `data.type`).
  final String type;
  final Map<String, String> data;
  final String? title;
  final String? body;

  /// El chofer tocó la notificación (la app estaba cerrada o en segundo plano).
  final bool openedFromTray;
}

/// Avisos con la app cerrada. Con la app abierta los mismos avisos llegan por tiempo real.
abstract interface class PushService {
  /// Prepara los avisos y devuelve el token del celular (null sin permiso o sin Firebase).
  Future<String?> start();

  Stream<String> get tokenChanges;

  Stream<PushNotice> get notices;
}

/// Sin proyecto de Firebase configurado.
class DisabledPushService implements PushService {
  const DisabledPushService();

  @override
  Future<String?> start() async => null;

  @override
  Stream<String> get tokenChanges => const Stream.empty();

  @override
  Stream<PushNotice> get notices => const Stream.empty();
}

/// Firebase Cloud Messaging con los valores de compilación (FIREBASE_*), sin archivo
/// google-services.json.
class FirebasePushService implements PushService {
  FirebasePushService(this.settings);

  final FirebaseSettings settings;
  final _notices = StreamController<PushNotice>.broadcast();
  bool _started = false;

  static PushNotice _notice(RemoteMessage message, {required bool opened}) =>
      PushNotice(
        type: message.data['type']?.toString() ?? 'message',
        data: message.data.map((k, v) => MapEntry(k, '$v')),
        title: message.notification?.title,
        body: message.notification?.body,
        openedFromTray: opened,
      );

  @override
  Future<String?> start() async {
    if (!_started) {
      _started = true;
      await Firebase.initializeApp(
        options: FirebaseOptions(
          apiKey: settings.apiKey,
          appId: settings.appId,
          messagingSenderId: settings.messagingSenderId,
          projectId: settings.projectId,
        ),
      );
      FirebaseMessaging.onMessage.listen(
        (m) => _notices.add(_notice(m, opened: false)),
      );
      FirebaseMessaging.onMessageOpenedApp.listen(
        (m) => _notices.add(_notice(m, opened: true)),
      );
      final initial = await FirebaseMessaging.instance.getInitialMessage();
      if (initial != null) _notices.add(_notice(initial, opened: true));
    }
    await FirebaseMessaging.instance.requestPermission();
    return FirebaseMessaging.instance.getToken();
  }

  @override
  Stream<String> get tokenChanges => FirebaseMessaging.instance.onTokenRefresh;

  @override
  Stream<PushNotice> get notices => _notices.stream;
}

/// Registra el token en la API para recibir avisos de este chofer en este celular.
class PushTokenApi {
  PushTokenApi(this._api);

  final ApiClient _api;

  Future<void> save(String? token) =>
      _api.post<Object?>('/driver/push-token', body: {'token': token});
}
