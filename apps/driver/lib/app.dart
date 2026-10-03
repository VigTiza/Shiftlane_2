import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'application/auth/auth_controller.dart';
import 'application/auth/auth_providers.dart';
import 'application/realtime/realtime_providers.dart';
import 'application/sync/sync_coordinator.dart';
import 'application/tracking/trip_tracking.dart';
import 'application/trips/trips_controller.dart';
import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';
import 'data/realtime/socket_realtime_client.dart';
import 'presentation/widgets/offline_banner.dart';

class ShiftlaneDriverApp extends ConsumerStatefulWidget {
  const ShiftlaneDriverApp({super.key});

  @override
  ConsumerState<ShiftlaneDriverApp> createState() => _ShiftlaneDriverAppState();
}

class _ShiftlaneDriverAppState extends ConsumerState<ShiftlaneDriverApp> {
  late final SyncCoordinator _sync;
  late final AppLifecycleListener _lifecycle;

  @override
  void initState() {
    super.initState();
    _sync = ref.read(syncCoordinatorProvider.notifier);
    // Al volver a la app se envía lo pendiente.
    _lifecycle = AppLifecycleListener(
      onResume: () => unawaited(_sync.syncNow()),
    );
    // Vigilar la red para la cola. ¿Celular vinculado? ¿Sesión que se pueda renovar?
    Future.microtask(() async {
      await _sync.start();
      await ref.read(authControllerProvider.notifier).bootstrap();
    });
  }

  @override
  void dispose() {
    _lifecycle.dispose();
    _sync.stop();
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
      if (next is AuthSignedIn && wasOut) unawaited(_sync.syncNow());
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
