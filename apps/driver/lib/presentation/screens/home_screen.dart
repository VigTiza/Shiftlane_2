import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../application/auth/auth_controller.dart';
import '../../application/auth/auth_providers.dart';
import '../../application/providers.dart';
import '../../core/theme/app_theme.dart';
import '../widgets/big_button.dart';

/// Pantalla principal: tres botones y nada más (los viajes llegan en F07-P04).
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final config = ref.watch(appConfigProvider);
    final auth = ref.watch(authControllerProvider);
    final driverName = auth is AuthSignedIn ? auth.session.fullName : null;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Shiftlane Chofer'),
        actions: [
          if (config.label.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Chip(label: Text(config.label)),
            ),
          PopupMenuButton<String>(
            key: const Key('home-menu'),
            onSelected: (value) {
              if (value == 'switch') {
                ref.read(authControllerProvider.notifier).switchDriver();
              }
            },
            itemBuilder: (context) => const [
              PopupMenuItem(value: 'switch', child: Text('Cambiar de chofer')),
            ],
          ),
        ],
        bottom: driverName == null
            ? null
            : PreferredSize(
                preferredSize: const Size.fromHeight(32),
                child: Padding(
                  padding: const EdgeInsets.only(left: 16, bottom: 8),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      driverName,
                      style: const TextStyle(color: Colors.white, fontSize: 18),
                    ),
                  ),
                ),
              ),
      ),
      body: const SafeArea(
        child: Padding(
          padding: EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              BigButton(
                label: 'Iniciar viaje',
                icon: Icons.play_arrow_rounded,
                onPressed: null,
                color: ShiftlaneColors.green,
              ),
              SizedBox(height: 16),
              BigButton(
                label: 'Escanear pasajero',
                icon: Icons.qr_code_scanner_rounded,
                onPressed: null,
              ),
              SizedBox(height: 16),
              BigButton(
                label: 'Terminar viaje',
                icon: Icons.flag_rounded,
                onPressed: null,
                color: ShiftlaneColors.red,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
