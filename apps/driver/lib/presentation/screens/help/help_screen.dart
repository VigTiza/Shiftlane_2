import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../application/auth/auth_providers.dart';
import '../../../application/device_check/device_check_controller.dart';
import '../../../application/sync/sync_coordinator.dart';
import '../../../application/trips/trips_controller.dart';
import '../../../core/router/app_routes.dart';
import '../../../domain/trips/trip_models.dart';

/// «Tengo un problema»: los problemas comunes con su solución a un toque, y el diagnóstico
/// para el despachador.
class HelpScreen extends ConsumerStatefulWidget {
  const HelpScreen({super.key});

  @override
  ConsumerState<HelpScreen> createState() => _HelpScreenState();
}

class _HelpScreenState extends ConsumerState<HelpScreen> {
  bool _busy = false;

  /// El aviso nuevo reemplaza al anterior (no se forman en fila).
  void _tell(String message) => ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message)));

  Future<void> _run(Future<String> Function() action) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final message = await action();
      if (mounted) _tell(message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<String> _sync() async {
    final report = await ref.read(syncCoordinatorProvider.notifier).syncNow();
    if (report.offline) {
      return 'Sigue sin señal. Tus datos están guardados y se envían solos.';
    }
    return report.pending == 0
        ? 'Todo quedó enviado.'
        : 'Faltan ${report.pending} registros; se reintenta solo.';
  }

  Future<String> _refreshTrips() async {
    await ref.read(tripsControllerProvider.notifier).refresh();
    final trips = ref.read(tripsControllerProvider).value ?? const [];
    return trips.isEmpty
        ? 'No tienes viajes asignados hoy. Avisa al despachador.'
        : 'Viajes actualizados.';
  }

  /// Revisa el celular (y lo reporta al servidor) y envía lo pendiente: el despachador ve el
  /// resultado en el panel de celulares.
  Future<String> _diagnostic() async {
    await ref.read(deviceCheckProvider.notifier).run();
    final report = await ref.read(syncCoordinatorProvider.notifier).syncNow();
    return report.offline
        ? 'Sin señal: el diagnóstico se envía al recuperar la conexión.'
        : 'Diagnóstico enviado al despachador.';
  }

  @override
  Widget build(BuildContext context) {
    final pending = ref.watch(syncCoordinatorProvider).pending;
    final inTrip =
        ref.watch(currentTripProvider)?.status == TripStatus.inProgress;
    return Scaffold(
      appBar: AppBar(title: const Text('Tengo un problema')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          if (_busy) const LinearProgressIndicator(),
          _Problem(
            id: 'signal',
            icon: Icons.cloud_off,
            title: 'No tengo señal',
            solution:
                'No pasa nada: lo que haces se guarda en el celular y se envía solo al '
                'recuperar la señal. ${pending > 0 ? 'Ahora hay $pending registros por enviar.' : 'No hay nada pendiente.'}',
            action: 'Enviar ahora',
            onAction: () => _run(_sync),
          ),
          _Problem(
            id: 'gps',
            icon: Icons.location_off,
            title: 'El GPS no me ubica',
            solution:
                'Revisa que la ubicación esté encendida y con permiso «Todo el tiempo», '
                'y que la app no esté en ahorro de batería.',
            action: 'Revisar el celular',
            onAction: () => context.push(AppRoutes.deviceCheck),
          ),
          _Problem(
            id: 'camera',
            icon: Icons.qr_code_scanner,
            title: 'La cámara no lee el código',
            solution:
                'Limpia la cámara, busca luz y acerca el código a unos 15 cm. Si no '
                'lee, registra al pasajero con su número de empleado.',
            action: inTrip ? 'Registrar por número de empleado' : null,
            onAction: () => context.push(AppRoutes.scan),
          ),
          _Problem(
            id: 'trips',
            icon: Icons.event_busy,
            title: 'No aparece mi viaje',
            solution:
                'Actualiza la lista. Si sigue sin aparecer, el despachador debe '
                'asignártelo en el panel.',
            action: 'Actualizar viajes',
            onAction: () => _run(_refreshTrips),
          ),
          _Problem(
            id: 'pin',
            icon: Icons.password,
            title: 'Olvidé mi PIN',
            solution:
                'El despachador lo restablece desde el panel. Después elige tu nombre y '
                'crea un PIN nuevo.',
            action: 'Cambiar de chofer',
            onAction: () =>
                ref.read(authControllerProvider.notifier).switchDriver(),
          ),
          _Problem(
            id: 'slow',
            icon: Icons.battery_alert,
            title: 'La app se cierra o va lenta',
            solution:
                'Quita el ahorro de batería para Shiftlane y cierra otras apps. La '
                'revisión del celular te lleva al ajuste.',
            action: 'Revisar el celular',
            onAction: () => context.push(AppRoutes.deviceCheck),
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            key: const Key('help-diagnostic'),
            onPressed: _busy ? null : () => _run(_diagnostic),
            icon: const Icon(Icons.send),
            label: const Text('Enviar diagnóstico al despachador'),
          ),
        ],
      ),
    );
  }
}

class _Problem extends StatelessWidget {
  const _Problem({
    required this.id,
    required this.icon,
    required this.title,
    required this.solution,
    required this.onAction,
    this.action,
  });

  final String id;
  final IconData icon;
  final String title;
  final String solution;
  final String? action;
  final VoidCallback onAction;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ExpansionTile(
        key: Key('help-$id'),
        leading: Icon(icon, size: 32),
        title: Text(
          title,
          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
        ),
        childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        expandedCrossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(solution, style: const TextStyle(fontSize: 17)),
          if (action != null) ...[
            const SizedBox(height: 12),
            OutlinedButton(
              key: Key('help-$id-action'),
              onPressed: onAction,
              child: Text(action!),
            ),
          ],
        ],
      ),
    );
  }
}
