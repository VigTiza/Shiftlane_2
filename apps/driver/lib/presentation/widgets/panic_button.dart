import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../application/trips/trips_controller.dart';
import '../../core/theme/app_theme.dart';

/// Botón de pánico, siempre visible. Pide confirmación para evitar toques por error y
/// funciona sin señal (queda guardado y se envía en cuanto haya conexión).
class PanicButton extends ConsumerWidget {
  const PanicButton({super.key, this.tripId});

  final String? tripId;

  Future<void> _confirm(BuildContext context, WidgetRef ref) async {
    final send = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('¿Enviar alerta de pánico?'),
        content: const Text(
          'El despachador recibe tu ubicación de inmediato y te llamará.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            key: const Key('panic-confirm'),
            style: FilledButton.styleFrom(backgroundColor: ShiftlaneColors.red),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Sí, enviar'),
          ),
        ],
      ),
    );
    if (send != true || !context.mounted) return;
    unawaited(HapticFeedback.heavyImpact());
    await ref.read(tripsControllerProvider.notifier).panic(tripId: tripId);
    if (!context.mounted) return;
    // La confirmación del pánico no espera a que se cierren otros avisos.
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        const SnackBar(
          content: Text('Alerta enviada. El despachador te llamará.'),
          backgroundColor: ShiftlaneColors.red,
        ),
      );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return FloatingActionButton.extended(
      key: const Key('panic-button'),
      heroTag: 'panic',
      backgroundColor: ShiftlaneColors.red,
      foregroundColor: Colors.white,
      onPressed: () => _confirm(context, ref),
      icon: const Icon(Icons.sos_rounded, size: 30),
      label: const Text(
        'Pánico',
        style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
      ),
    );
  }
}
