import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../application/update/update_controller.dart';
import '../../../core/theme/app_theme.dart';

/// Actualización obligatoria: el servidor ya no acepta esta versión.
class UpdateScreen extends ConsumerWidget {
  const UpdateScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final update = ref.watch(updateControllerProvider);
    final url = update.info?.downloadUrl;
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Icon(
                Icons.system_update,
                size: 96,
                color: ShiftlaneColors.blue,
              ),
              const SizedBox(height: 24),
              Text(
                'Actualiza la app',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              const SizedBox(height: 12),
              Text(
                'Tienes la versión ${update.current ?? '?'} y se necesita la '
                '${update.info?.minVersion ?? 'nueva'} para seguir trabajando.',
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 18),
              ),
              const SizedBox(height: 32),
              if (url != null)
                FilledButton.icon(
                  key: const Key('update-download'),
                  onPressed: () => ref.read(urlOpenerProvider)(Uri.parse(url)),
                  icon: const Icon(Icons.download),
                  label: const Text('Descargar la versión nueva'),
                )
              else
                const Text(
                  'Pide al despachador la versión nueva de la app.',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                ),
              const SizedBox(height: 12),
              TextButton(
                key: const Key('update-retry'),
                onPressed: () =>
                    ref.read(updateControllerProvider.notifier).check(),
                child: const Text('Ya la actualicé'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
