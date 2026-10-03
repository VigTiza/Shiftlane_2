import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../application/auth/auth_providers.dart';
import '../../../application/trips/trips_controller.dart';
import '../../../core/router/app_routes.dart';
import '../../../core/theme/app_theme.dart';

/// Llegada: el chofer escanea el QR fijo de la puerta de la planta y termina el viaje.
class ArrivalScreen extends ConsumerStatefulWidget {
  const ArrivalScreen({super.key});

  @override
  ConsumerState<ArrivalScreen> createState() => _ArrivalScreenState();
}

class _ArrivalScreenState extends ConsumerState<ArrivalScreen> {
  bool _busy = false;
  String? _error;

  Future<void> _finish(String tripId) async {
    final result = await ref
        .read(tripsControllerProvider.notifier)
        .finish(tripId);
    if (!mounted) return;
    if (!result.accepted) {
      setState(() {
        _busy = false;
        _error = result.message;
      });
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Viaje terminado. ¡Buen trabajo!'),
        backgroundColor: ShiftlaneColors.green,
      ),
    );
    context.go(AppRoutes.home);
  }

  Future<void> _gate(String tripId, String code) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final result = await ref
        .read(tripsControllerProvider.notifier)
        .gate(tripId, code);
    if (!mounted) return;
    if (!result.accepted) {
      setState(() {
        _busy = false;
        _error = result.message;
      });
      return;
    }
    await _finish(tripId);
  }

  Future<void> _finishWithoutGate(String tripId) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('¿Terminar sin escanear la puerta?'),
        content: const Text(
          'El QR de la puerta es la prueba de que llegaste. Úsalo siempre que puedas.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Volver'),
          ),
          FilledButton(
            key: const Key('finish-confirm'),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Terminar'),
          ),
        ],
      ),
    );
    if (confirm != true) return;
    setState(() => _busy = true);
    await _finish(tripId);
  }

  @override
  Widget build(BuildContext context) {
    final trip = ref.watch(currentTripProvider);
    final scanner = ref.watch(qrScannerProvider);
    if (trip == null) {
      return const Scaffold(
        body: Center(child: Text('No hay un viaje en curso.')),
      );
    }
    return Scaffold(
      appBar: AppBar(title: Text('Llegada a ${trip.plantName}')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Escanea el QR de la puerta de la planta.',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 12),
              Expanded(child: scanner(context, (code) => _gate(trip.id, code))),
              if (_busy) const LinearProgressIndicator(),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Text(
                    _error!,
                    key: const Key('arrival-error'),
                    style: const TextStyle(
                      color: ShiftlaneColors.red,
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              const SizedBox(height: 8),
              TextButton(
                key: const Key('finish-without-gate'),
                onPressed: _busy ? null : () => _finishWithoutGate(trip.id),
                child: const Text('Terminar sin escanear la puerta'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
