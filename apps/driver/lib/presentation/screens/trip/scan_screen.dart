import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../application/auth/auth_providers.dart';
import '../../../application/trips/trips_controller.dart';
import '../../../core/theme/app_theme.dart';
import '../../../domain/trips/trip_models.dart';

/// Escaneo de pasajeros: credencial QR, gafete o número de empleado.
class ScanScreen extends ConsumerStatefulWidget {
  const ScanScreen({super.key});

  @override
  ConsumerState<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends ConsumerState<ScanScreen> {
  ActionResult? _last;
  bool _busy = false;

  Future<void> _scan(
    String tripId, {
    String? code,
    String? employeeNumber,
  }) async {
    if (_busy) return;
    setState(() => _busy = true);
    final result = await ref
        .read(tripsControllerProvider.notifier)
        .scan(tripId, code: code, employeeNumber: employeeNumber);
    if (mounted) {
      setState(() {
        _busy = false;
        _last = result;
      });
    }
  }

  Future<void> _manual(String tripId) async {
    final controller = TextEditingController();
    final number = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Número de empleado'),
        content: TextField(
          key: const Key('employee-number-field'),
          controller: controller,
          autofocus: true,
          keyboardType: TextInputType.text,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Registrar'),
          ),
        ],
      ),
    );
    if (number != null && number.isNotEmpty) {
      await _scan(tripId, employeeNumber: number);
    }
  }

  @override
  Widget build(BuildContext context) {
    final trip = ref.watch(currentTripProvider);
    final scanner = ref.watch(qrScannerProvider);
    if (trip == null || trip.status != TripStatus.inProgress) {
      return const Scaffold(
        body: Center(child: Text('Primero inicia el viaje.')),
      );
    }
    final last = _last;
    final message =
        last?.result?['message'] as String? ??
        last?.message ??
        (last?.status == SyncStatus.queued
            ? 'Sin señal: el escaneo quedó guardado.'
            : null);
    return Scaffold(
      appBar: AppBar(title: Text('A bordo: ${trip.onboard}')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(
                child: scanner(context, (code) => _scan(trip.id, code: code)),
              ),
              if (_busy) const LinearProgressIndicator(),
              if (message != null)
                Container(
                  key: const Key('scan-result'),
                  margin: const EdgeInsets.symmetric(vertical: 12),
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color:
                        (last?.result?['result'] == 'ok'
                                ? ShiftlaneColors.green
                                : ShiftlaneColors.amber)
                            .withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    message,
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              OutlinedButton.icon(
                key: const Key('scan-manual'),
                onPressed: _busy ? null : () => _manual(trip.id),
                icon: const Icon(Icons.keyboard),
                label: const Text('Escribir número de empleado'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
