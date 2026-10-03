import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../application/trips/trip_providers.dart';
import '../../../application/trips/trips_controller.dart';
import '../../../core/errors/app_failure.dart';
import '../../../core/router/app_routes.dart';
import '../../../core/theme/app_theme.dart';
import '../../../domain/trips/stop_notice.dart';
import '../../../domain/trips/trip_models.dart';
import '../../widgets/panic_button.dart';
import '../../widgets/trip_map.dart';

/// Viaje en curso: mapa, siguiente parada, pasajeros a bordo, incidentes y llegada.
class TripScreen extends ConsumerWidget {
  const TripScreen({super.key});

  Future<void> _arrive(
    BuildContext context,
    WidgetRef ref,
    DriverTrip trip,
    TripStop stop,
  ) async {
    final result = await ref
        .read(tripsControllerProvider.notifier)
        .arriveStop(trip.id, stop.id);
    if (!context.mounted || result.accepted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(result.message ?? 'No se pudo registrar la parada.'),
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final trip = ref.watch(currentTripProvider);
    if (trip == null || trip.status != TripStatus.inProgress) {
      return Scaffold(
        appBar: AppBar(title: const Text('Viaje')),
        body: const Center(child: Text('No hay un viaje en curso.')),
      );
    }
    final next = trip.nextStop;
    final notice = stopNoticeFor(trip, ref.watch(positionProvider).value);
    // Al entrar al radio de la parada: vibración y sonido.
    ref.listen(positionProvider, (previous, current) {
      final before = stopNoticeFor(trip, previous?.value);
      final now = stopNoticeFor(trip, current.value);
      if (now != null && now.atStop && !(before?.atStop ?? false)) {
        unawaited(HapticFeedback.vibrate());
        unawaited(SystemSound.play(SystemSoundType.alert));
      }
    });
    return Scaffold(
      appBar: AppBar(title: Text(trip.title)),
      floatingActionButton: PanicButton(tripId: trip.id),
      floatingActionButtonLocation: FloatingActionButtonLocation.startFloat,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(child: TripMap(trip: trip)),
              if (notice != null) _StopNoticeBanner(notice: notice),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: _InfoCard(
                      key: const Key('next-stop'),
                      title: 'Siguiente parada',
                      value: next == null
                          ? 'Rumbo a ${trip.plantName}'
                          : '${next.name}${next.time != null ? ' · ${next.time}' : ''}',
                    ),
                  ),
                  const SizedBox(width: 8),
                  _InfoCard(
                    key: const Key('onboard'),
                    title: 'A bordo',
                    value: trip.capacity == null
                        ? '${trip.onboard}'
                        : '${trip.onboard} / ${trip.capacity}',
                    alert: trip.overCapacity,
                  ),
                ],
              ),
              if (trip.overCapacity)
                const Padding(
                  padding: EdgeInsets.only(top: 6),
                  child: Text(
                    'Sobrecupo: avisa al despachador.',
                    style: TextStyle(
                      color: ShiftlaneColors.red,
                      fontWeight: FontWeight.w700,
                      fontSize: 16,
                    ),
                  ),
                ),
              const SizedBox(height: 8),
              if (next != null)
                OutlinedButton.icon(
                  key: const Key('arrive-stop'),
                  onPressed: () => _arrive(context, ref, trip, next),
                  icon: const Icon(Icons.place),
                  label: const Text('Llegué a la parada'),
                ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: FilledButton.icon(
                      key: const Key('trip-scan'),
                      onPressed: () => context.push(AppRoutes.scan),
                      icon: const Icon(Icons.qr_code_scanner),
                      label: const Text('Escanear'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton.icon(
                      key: const Key('trip-incident'),
                      onPressed: () => showModalBottomSheet<void>(
                        context: context,
                        isScrollControlled: true,
                        builder: (_) => IncidentSheet(tripId: trip.id),
                      ),
                      icon: const Icon(Icons.report_problem),
                      label: const Text('Incidente'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              FilledButton.icon(
                key: const Key('trip-arrival'),
                style: FilledButton.styleFrom(
                  backgroundColor: ShiftlaneColors.green,
                ),
                onPressed: () => context.push(AppRoutes.arrival),
                icon: const Icon(Icons.flag),
                label: Text('Llegué a ${trip.plantName}'),
              ),
              const SizedBox(height: 64),
            ],
          ),
        ),
      ),
    );
  }
}

class _StopNoticeBanner extends StatelessWidget {
  const _StopNoticeBanner({required this.notice});

  final StopNotice notice;

  @override
  Widget build(BuildContext context) {
    final color = notice.atStop ? ShiftlaneColors.green : ShiftlaneColors.amber;
    return Container(
      key: const Key('stop-notice'),
      margin: const EdgeInsets.only(top: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.18),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color, width: 2),
      ),
      child: Row(
        children: [
          Icon(notice.atStop ? Icons.where_to_vote : Icons.near_me, size: 30),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              notice.text,
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
            ),
          ),
        ],
      ),
    );
  }
}

class _InfoCard extends StatelessWidget {
  const _InfoCard({
    super.key,
    required this.title,
    required this.value,
    this.alert = false,
  });

  final String title;
  final String value;
  final bool alert;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: alert ? ShiftlaneColors.red.withValues(alpha: 0.12) : null,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: const TextStyle(fontSize: 14)),
            Text(
              value,
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
            ),
          ],
        ),
      ),
    );
  }
}

/// Reporte de incidente: tipo, descripción y foto.
class IncidentSheet extends ConsumerStatefulWidget {
  const IncidentSheet({super.key, required this.tripId});

  final String tripId;

  @override
  ConsumerState<IncidentSheet> createState() => _IncidentSheetState();
}

class _IncidentSheetState extends ConsumerState<IncidentSheet> {
  IncidentType? _type;
  final _description = TextEditingController();
  final _photoIds = <String>[];
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _description.dispose();
    super.dispose();
  }

  Future<void> _photo() async {
    final photo = await ref.read(photoCaptureProvider)();
    if (photo == null) return;
    setState(() => _busy = true);
    try {
      final id = await ref
          .read(tripsControllerProvider.notifier)
          .uploadPhoto(widget.tripId, 'incident', photo.bytes, photo.name);
      setState(() => _photoIds.add(id));
    } on AppFailure catch (failure) {
      setState(() => _error = failure.message);
    } finally {
      setState(() => _busy = false);
    }
  }

  Future<void> _send() async {
    setState(() => _busy = true);
    final result = await ref
        .read(tripsControllerProvider.notifier)
        .reportIncident(
          widget.tripId,
          _type!,
          description: _description.text.trim(),
          photoIds: _photoIds,
        );
    if (!mounted) return;
    if (!result.accepted) {
      setState(() {
        _busy = false;
        _error = result.message;
      });
      return;
    }
    Navigator.pop(context);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Incidente enviado al despachador.')),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('¿Qué pasó?', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final type in IncidentType.values)
                ChoiceChip(
                  key: Key('incident-${type.name}'),
                  label: Text(type.label, style: const TextStyle(fontSize: 18)),
                  selected: _type == type,
                  onSelected: (_) => setState(() => _type = type),
                ),
            ],
          ),
          const SizedBox(height: 12),
          TextField(
            key: const Key('incident-description'),
            controller: _description,
            maxLines: 3,
            decoration: const InputDecoration(
              labelText: 'Descripción (opcional)',
            ),
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: _busy ? null : _photo,
            icon: const Icon(Icons.photo_camera),
            label: Text(
              _photoIds.isEmpty
                  ? 'Agregar foto'
                  : '${_photoIds.length} foto(s)',
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                _error!,
                style: const TextStyle(color: ShiftlaneColors.red),
              ),
            ),
          const SizedBox(height: 12),
          FilledButton(
            key: const Key('incident-send'),
            onPressed: _busy || _type == null ? null : _send,
            child: const Text('Enviar'),
          ),
        ],
      ),
    );
  }
}
