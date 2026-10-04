import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors/app_failure.dart';
import '../../core/logging/app_logger.dart';
import '../../data/push/push_service.dart';
import '../../domain/trips/trip_models.dart';
import '../providers.dart';
import '../trips/trips_controller.dart';

final pushServiceProvider = Provider<PushService>((ref) {
  final firebase = ref.watch(appConfigProvider).firebase;
  return firebase == null
      ? const DisabledPushService()
      : FirebasePushService(firebase);
});

final pushTokenApiProvider = Provider<PushTokenApi>(
  (ref) => PushTokenApi(ref.watch(apiClientProvider)),
);

/// Avisos con la app cerrada: registra el token del celular al entrar (y cuando Firebase lo
/// renueva) y reacciona a los avisos. Estado: el token ya registrado en la API.
class PushController extends Notifier<String?> {
  final _log = appLogger('push');
  StreamSubscription<String>? _tokens;
  StreamSubscription<PushNotice>? _notices;
  final _openedMessages = StreamController<DriverMessage>.broadcast();

  @override
  String? build() {
    ref.onDispose(() {
      _tokens?.cancel();
      _notices?.cancel();
      _openedMessages.close();
    });
    return null;
  }

  /// Mensajes del despachador que el chofer abrió desde la notificación (la app los muestra).
  Stream<DriverMessage> get openedMessages => _openedMessages.stream;

  Future<void> register() async {
    final service = ref.read(pushServiceProvider);
    try {
      final token = await service.start();
      _tokens ??= service.tokenChanges.listen((t) => unawaited(_save(t)));
      _notices ??= service.notices.listen(_onNotice);
      if (token != null) await _save(token);
    } on Object catch (error) {
      // Sin avisos la app sigue: los avisos llegan por tiempo real con la app abierta.
      _log.warning('Avisos no disponibles: $error');
    }
  }

  Future<void> _save(String token) async {
    if (token == state) return;
    try {
      await ref.read(pushTokenApiProvider).save(token);
      if (ref.mounted) state = token;
    } on AppFailure catch (failure) {
      // Se vuelve a intentar al siguiente inicio de sesión.
      _log.info('No se registró el token de avisos: ${failure.message}');
    }
  }

  void _onNotice(PushNotice notice) {
    if (notice.type == 'trip_cancelled' || notice.type == 'route_changed') {
      unawaited(ref.read(tripsControllerProvider.notifier).refresh());
    }
    // Con la app abierta el mensaje ya llegó por tiempo real.
    if (notice.openedFromTray && notice.type == 'message') {
      _openedMessages.add(
        DriverMessage(
          id: notice.data['messageId'] ?? '',
          text: notice.body ?? '',
          sentAt: DateTime.now(),
        ),
      );
    }
  }
}

final pushControllerProvider = NotifierProvider<PushController, String?>(
  PushController.new,
);
