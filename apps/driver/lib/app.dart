import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'application/auth/auth_controller.dart';
import 'application/auth/auth_providers.dart';
import 'application/push/push_controller.dart';
import 'application/realtime/realtime_providers.dart';
import 'application/sync/sync_coordinator.dart';
import 'application/tracking/trip_tracking.dart';
import 'application/trips/trips_controller.dart';
import 'application/update/update_controller.dart';
import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';
import 'data/realtime/socket_realtime_client.dart';
import 'domain/trips/trip_models.dart';
import 'presentation/widgets/offline_banner.dart';

class ShiftlaneDriverApp extends ConsumerStatefulWidget {
  const ShiftlaneDriverApp({super.key});

  @override
  ConsumerState<ShiftlaneDriverApp> createState() => _ShiftlaneDriverAppState();
}

class _ShiftlaneDriverAppState extends ConsumerState<ShiftlaneDriverApp> {
  late final SyncCoordinator _sync;
  late final UpdateController _update;
  late final AppLifecycleListener _lifecycle;
  StreamSubscription<DriverMessage>? _openedMessages;

  @override
  void initState() {
    super.initState();
    _sync = ref.read(syncCoordinatorProvider.notifier);
    _update = ref.read(updateControllerProvider.notifier);
    // Al volver a la app se envía lo pendiente y se revisa la versión.
    _lifecycle = AppLifecycleListener(
      onResume: () {
        unawaited(_sync.syncNow());
        unawaited(_update.check());
      },
    );
    // Mensajes que el chofer abrió desde una notificación.
    _openedMessages = ref
        .read(pushControllerProvider.notifier)
        .openedMessages
        .listen((message) => _onRealtime(DispatcherMessageEvent(message)));
    // Vigilar la red para la cola, revisar la versión. ¿Celular vinculado? ¿Sesión vigente?
    Future.microtask(() async {
      await _sync.start();
      unawaited(_update.check());
      await ref.read(authControllerProvider.notifier).bootstrap();
    });
  }

  @override
  void dispose() {
    _lifecycle.dispose();
    _sync.stop();
    _openedMessages?.cancel();
    super.dispose();
  }

  /// Avisos del despachador en pantalla, con sonido y vibración.
  Future<void> _onRealtime(RealtimeEvent event) async {
    final context = rootNavigatorKey.currentContext;
    if (context == null) return;
    switch (event) {
      case DispatcherMessageEvent(:final message):
        // Sonido y vibración sin esperar: el aviso sale de inmediato.
        unawaited(SystemSound.play(SystemSoundType.alert));
        unawaited(HapticFeedback.vibrate());
        await showDialog<void>(
          context: context,
          builder: (context) => AlertDialog(
            key: const Key('dispatcher-message'),
            title: const Text('Mensaje del despachador'),
            content: Text(message.text, style: const TextStyle(fontSize: 20)),
            actions: [
              FilledButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Enterado'),
              ),
            ],
          ),
        );
      case TripCancelledEvent(:final reason):
        unawaited(HapticFeedback.vibrate());
        await ref.read(tripsControllerProvider.notifier).refresh();
        if (!context.mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Se canceló un viaje${reason != null ? ': $reason' : '.'}',
            ),
            backgroundColor: ShiftlaneColors.red,
          ),
        );
      case RouteChangedEvent(:final code):
        await ref.read(tripsControllerProvider.notifier).refresh();
        if (!context.mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Cambió la ruta${code != null ? ' $code' : ''}: revisa las paradas.',
            ),
          ),
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(realtimeEventsProvider, (_, next) {
      final event = next.value;
      if (event != null) _onRealtime(event);
    });
    // Al entrar (o al renovar una sesión que abrió sin señal) se envía lo guardado.
    ref.listen(authControllerProvider, (previous, next) {
      final wasOut = previous is! AuthSignedIn || previous.offline;
      if (next is AuthSignedIn && wasOut) {
        unawaited(_sync.syncNow());
        // Avisos con la app cerrada para este chofer en este celular.
        unawaited(ref.read(pushControllerProvider.notifier).register());
      }
    });
    // El GPS sigue al viaje en curso (se enciende y apaga solo).
    ref.listen(tripTrackingProvider, (_, _) {});
    return MaterialApp.router(
      title: 'Shiftlane Chofer',
      debugShowCheckedModeBanner: false,
      theme: buildShiftlaneTheme(),
      routerConfig: ref.watch(routerProvider),
      locale: const Locale('es', 'MX'),
      builder: (context, child) =>
          OfflineBanner(child: child ?? const SizedBox.shrink()),
    );
  }
}
