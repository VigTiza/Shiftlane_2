import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../application/scan/scan_controller.dart';
import '../../../application/trips/trips_controller.dart';
import '../../../core/theme/app_theme.dart';
import '../../../domain/scan/scan_models.dart';
import '../../../domain/trips/trip_models.dart';

/// Escaneo de pasajeros: credencial QR de Shiftlane, gafete o número de empleado. Valida en el
/// celular (funciona sin señal) y luego confirma con el servidor.
class ScanScreen extends ConsumerStatefulWidget {
  const ScanScreen({super.key});

  @override
  ConsumerState<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends ConsumerState<ScanScreen> {
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    // Cada vez que se abre empieza sin el resultado anterior.
    Future.microtask(() {
      if (mounted) ref.read(scanControllerProvider.notifier).clear();
    });
  }

  Future<void> _scan(
    DriverTrip trip, {
    ScannedCode? code,
    String? employeeNumber,
  }) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await ref
          .read(scanControllerProvider.notifier)
          .scan(trip, code: code, employeeNumber: employeeNumber);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _manual(DriverTrip trip) async {
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
      await _scan(trip, employeeNumber: number);
    }
  }

  @override
  Widget build(BuildContext context) {
    final trip = ref.watch(currentTripProvider);
    final scanner = ref.watch(codeScannerProvider);
    if (trip == null || trip.status != TripStatus.inProgress) {
      return const Scaffold(
        body: Center(child: Text('Primero inicia el viaje.')),
      );
    }
    final view = ref.watch(scanControllerProvider);
    final manifest = ref.watch(manifestProvider(trip.id)).value;
    return Scaffold(
      appBar: AppBar(
        title: Text('A bordo: ${trip.onboard}'),
        actions: [
          if (trip.capacity != null)
            Padding(
              padding: const EdgeInsets.only(right: 16),
              child: Center(
                child: Text(
                  '${trip.capacity} asientos',
                  style: TextStyle(
                    color: trip.overCapacity ? ShiftlaneColors.red : null,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(
                child: scanner(context, (code) => _scan(trip, code: code)),
              ),
              if (_busy) const LinearProgressIndicator(),
              if (view != null) _ResultCard(view: view),
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  manifest == null
                      ? 'Sin lista de pasajeros en el celular: valida el servidor.'
                      : 'Lista de la planta en el celular: ${manifest.passengers.length} pasajeros.',
                  key: const Key('manifest-status'),
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 14),
                ),
              ),
              OutlinedButton.icon(
                key: const Key('scan-manual'),
                onPressed: _busy ? null : () => _manual(trip),
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

class _ResultCard extends StatelessWidget {
  const _ResultCard({required this.view});

  final ScanView view;

  static (Color, IconData) _style(ScanOutcome? outcome) => switch (outcome) {
    ScanOutcome.ok => (ShiftlaneColors.green, Icons.check_circle),
    ScanOutcome.otherRoute => (ShiftlaneColors.amber, Icons.alt_route),
    ScanOutcome.unregistered => (ShiftlaneColors.blue, Icons.help),
    ScanOutcome.alreadyScanned => (Colors.grey, Icons.replay),
    ScanOutcome.rejected => (ShiftlaneColors.red, Icons.block),
    null => (Colors.grey, Icons.cloud_off),
  };

  @override
  Widget build(BuildContext context) {
    final (color, icon) = _style(view.outcome);
    final status = view.confirmed
        ? 'Confirmado por el servidor'
        : view.queued
        ? 'Guardado sin señal; se confirma al sincronizar'
        : 'Validado en el celular';
    return Container(
      key: const Key('scan-result'),
      margin: const EdgeInsets.symmetric(vertical: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        border: Border.all(color: color, width: 2),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Icon(icon, color: color, size: 44),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (view.outcome != null)
                  Text(
                    view.outcome!.title,
                    key: Key('scan-outcome-${view.outcome!.name}'),
                    style: TextStyle(
                      color: color,
                      fontSize: 22,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                Text(
                  view.message,
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                if (view.passengerName != null)
                  Text(
                    view.passengerName!,
                    style: const TextStyle(fontSize: 16),
                  ),
                if (view.stopName != null)
                  Text(
                    'Parada: ${view.stopName}',
                    key: const Key('scan-stop'),
                    style: const TextStyle(fontSize: 16),
                  ),
                Text(status, style: const TextStyle(fontSize: 13)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
