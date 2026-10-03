import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../application/trips/trip_providers.dart';
import '../../../application/trips/trips_controller.dart';
import '../../../core/errors/app_failure.dart';
import '../../../core/router/app_routes.dart';
import '../../../core/theme/app_theme.dart';
import '../../../domain/trips/trip_models.dart';

class _Answer {
  bool? ok;
  String note = '';
  String? photoId;
}

/// Revisión de la unidad antes de salir, con fotos obligatorias donde la empresa lo pidió.
/// Si todo está bien, inicia el viaje.
class ChecklistScreen extends ConsumerStatefulWidget {
  const ChecklistScreen({super.key, required this.tripId});

  final String tripId;

  @override
  ConsumerState<ChecklistScreen> createState() => _ChecklistScreenState();
}

class _ChecklistScreenState extends ConsumerState<ChecklistScreen> {
  late final Future<List<ChecklistPoint>> _template = ref
      .read(tripsControllerProvider.notifier)
      .checklistTemplate();
  final _answers = <String, _Answer>{};
  bool _busy = false;
  String? _error;

  _Answer _answer(String key) => _answers.putIfAbsent(key, _Answer.new);

  bool _complete(List<ChecklistPoint> points) => points.every((p) {
    final a = _answer(p.key);
    return a.ok != null && (!p.photoRequired || a.photoId != null);
  });

  Future<void> _takePhoto(ChecklistPoint point) async {
    final photo = await ref.read(photoCaptureProvider)();
    if (photo == null) return;
    setState(() => _busy = true);
    try {
      final id = await ref
          .read(tripsControllerProvider.notifier)
          .uploadPhoto(widget.tripId, 'checklist', photo.bytes, photo.name);
      setState(() => _answer(point.key).photoId = id);
    } on AppFailure catch (failure) {
      setState(() => _error = failure.message);
    } finally {
      setState(() => _busy = false);
    }
  }

  Future<void> _submit(List<ChecklistPoint> points) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final controller = ref.read(tripsControllerProvider.notifier);
    final result = await controller.submitChecklist(widget.tripId, [
      for (final p in points)
        (
          key: p.key,
          ok: _answer(p.key).ok!,
          note: _answer(p.key).note.trim().isEmpty
              ? null
              : _answer(p.key).note.trim(),
          photoId: _answer(p.key).photoId,
        ),
    ]);
    if (!mounted) return;
    if (!result.accepted) {
      setState(() {
        _busy = false;
        _error = result.message;
      });
      return;
    }
    final trip = ref
        .read(tripsControllerProvider)
        .value
        ?.firstWhere((t) => t.id == widget.tripId);
    if (trip == null || !trip.checklistAllowsStart) {
      setState(() => _busy = false);
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Hay puntos sin aprobar'),
          content: const Text(
            'Ya avisamos al despachador. Podrás salir cuando autorice la salida o se arregle la unidad.',
          ),
          actions: [
            FilledButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Entendido'),
            ),
          ],
        ),
      );
      if (mounted) context.go(AppRoutes.home);
      return;
    }
    final started = await controller.start(widget.tripId);
    if (!mounted) return;
    if (started.accepted) {
      context.go(AppRoutes.trip);
    } else {
      setState(() {
        _busy = false;
        _error = started.message;
      });
    }
  }

  Widget _point(ChecklistPoint point) {
    final answer = _answer(point.key);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              point.photoRequired
                  ? '${point.label} (foto obligatoria)'
                  : point.label,
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: ChoiceChip(
                    key: Key('ok-${point.key}'),
                    label: const Text('Bien'),
                    selected: answer.ok == true,
                    selectedColor: ShiftlaneColors.green.withValues(
                      alpha: 0.25,
                    ),
                    onSelected: (_) => setState(() => answer.ok = true),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: ChoiceChip(
                    key: Key('bad-${point.key}'),
                    label: const Text('Mal'),
                    selected: answer.ok == false,
                    selectedColor: ShiftlaneColors.red.withValues(alpha: 0.25),
                    onSelected: (_) => setState(() => answer.ok = false),
                  ),
                ),
              ],
            ),
            if (answer.ok == false)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: TextField(
                  key: Key('note-${point.key}'),
                  decoration: const InputDecoration(
                    labelText: '¿Qué está mal?',
                  ),
                  onChanged: (value) => answer.note = value,
                ),
              ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              key: Key('photo-${point.key}'),
              onPressed: _busy ? null : () => _takePhoto(point),
              icon: Icon(
                answer.photoId == null ? Icons.photo_camera : Icons.check,
              ),
              label: Text(answer.photoId == null ? 'Tomar foto' : 'Foto lista'),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Revisión de la unidad')),
      body: SafeArea(
        child: FutureBuilder<List<ChecklistPoint>>(
          future: _template,
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const Center(child: CircularProgressIndicator());
            }
            final points = snapshot.data ?? const <ChecklistPoint>[];
            if (snapshot.hasError || points.isEmpty) {
              return const Center(
                child: Padding(
                  padding: EdgeInsets.all(20),
                  child: Text(
                    'No se pudo cargar el checklist. Revisa tu señal e intenta de nuevo.',
                    textAlign: TextAlign.center,
                  ),
                ),
              );
            }
            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                for (final point in points) _point(point),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: Text(
                      _error!,
                      key: const Key('checklist-error'),
                      style: const TextStyle(
                        color: ShiftlaneColors.red,
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                const SizedBox(height: 8),
                if (_busy) const LinearProgressIndicator(),
                FilledButton(
                  key: const Key('checklist-submit'),
                  onPressed: _busy || !_complete(points)
                      ? null
                      : () => _submit(points),
                  child: const Text('Enviar e iniciar viaje'),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}
