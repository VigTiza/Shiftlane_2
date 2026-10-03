import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../application/sync/sync_coordinator.dart';
import '../../core/theme/app_theme.dart';

/// Franja «Sin señal» arriba de todas las pantallas: el chofer sabe que lo que hace queda
/// guardado y se envía solo al recuperar la conexión.
class OfflineBanner extends ConsumerWidget {
  const OfflineBanner({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sync = ref.watch(syncCoordinatorProvider);
    return Column(
      children: [
        if (sync.offline)
          Material(
            key: const Key('offline-banner'),
            color: ShiftlaneColors.amber,
            child: SafeArea(
              bottom: false,
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 10,
                ),
                child: Row(
                  children: [
                    const Icon(Icons.cloud_off, color: ShiftlaneColors.navy),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Sin señal — tus datos están guardados',
                            style: TextStyle(
                              color: ShiftlaneColors.navy,
                              fontSize: 17,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          if (sync.pending > 0)
                            Text(
                              sync.pending == 1
                                  ? '1 registro por enviar'
                                  : '${sync.pending} registros por enviar',
                              style: const TextStyle(
                                color: ShiftlaneColors.navy,
                                fontSize: 15,
                              ),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        Expanded(
          key: const ValueKey('app-content'),
          child: MediaQuery.removePadding(
            context: context,
            removeTop: sync.offline,
            child: child,
          ),
        ),
      ],
    );
  }
}
