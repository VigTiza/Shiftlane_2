import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../application/tutorial/tutorial_controller.dart';
import '../../../core/router/app_routes.dart';
import '../../../core/theme/app_theme.dart';

class _Step {
  const _Step(this.icon, this.color, this.title, this.points);

  final IconData icon;
  final Color color;
  final String title;
  final List<String> points;
}

/// Lo esencial de la app en unos 2 minutos.
const _steps = [
  _Step(Icons.waving_hand, ShiftlaneColors.blue, 'Bienvenido a Shiftlane', [
    'Con esta app haces tus viajes del día: iniciar, escanear pasajeros y terminar.',
    'Los botones son grandes para usarlos rápido. Nunca la uses mientras manejas.',
  ]),
  _Step(Icons.phone_android, ShiftlaneColors.green, 'Revisión del celular', [
    'Al entrar, la app revisa ubicación, batería, datos y cámara.',
    'Si algo está en rojo, toca el punto y la app te lleva al ajuste exacto.',
  ]),
  _Step(Icons.play_arrow_rounded, ShiftlaneColors.green, 'Iniciar el viaje', [
    'Toca «Iniciar viaje». Si es el primero del día, haz el checklist de la unidad.',
    'Algunos puntos piden foto: tómala con la cámara desde el checklist.',
  ]),
  _Step(Icons.qr_code_scanner, ShiftlaneColors.navy, 'Escanear pasajeros', [
    'Apunta la cámara a la credencial o al gafete. Cada resultado suena distinto.',
    'Si no trae credencial, toca «Escribir número de empleado».',
  ]),
  _Step(Icons.cloud_off, ShiftlaneColors.amber, 'Sin señal no pasa nada', [
    'Todo se guarda en el celular y se envía solo al recuperar la señal.',
    'Verás la franja «Sin señal — tus datos están guardados».',
  ]),
  _Step(Icons.sos, ShiftlaneColors.red, 'Pánico y ayuda', [
    'El botón rojo de pánico avisa al despachador con tu ubicación.',
    'Si algo no funciona, toca «Tengo un problema» en el inicio.',
  ]),
];

class TutorialScreen extends ConsumerStatefulWidget {
  const TutorialScreen({super.key});

  @override
  ConsumerState<TutorialScreen> createState() => _TutorialScreenState();
}

class _TutorialScreenState extends ConsumerState<TutorialScreen> {
  final _pages = PageController();
  int _page = 0;

  @override
  void dispose() {
    _pages.dispose();
    super.dispose();
  }

  Future<void> _finish() async {
    await ref.read(tutorialControllerProvider.notifier).markSeen();
    if (mounted) context.go(AppRoutes.home);
  }

  @override
  Widget build(BuildContext context) {
    final last = _page == _steps.length - 1;
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                key: const Key('tutorial-skip'),
                onPressed: _finish,
                child: const Text('Saltar'),
              ),
            ),
            Expanded(
              child: PageView(
                controller: _pages,
                onPageChanged: (page) => setState(() => _page = page),
                children: [
                  for (final step in _steps)
                    Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          CircleAvatar(
                            radius: 64,
                            backgroundColor: step.color.withValues(alpha: 0.15),
                            child: Icon(step.icon, size: 72, color: step.color),
                          ),
                          const SizedBox(height: 32),
                          Text(
                            step.title,
                            textAlign: TextAlign.center,
                            style: Theme.of(context).textTheme.headlineSmall
                                ?.copyWith(fontWeight: FontWeight.w800),
                          ),
                          const SizedBox(height: 20),
                          for (final point in step.points)
                            Padding(
                              padding: const EdgeInsets.only(bottom: 12),
                              child: Text(
                                point,
                                textAlign: TextAlign.center,
                                style: const TextStyle(fontSize: 19),
                              ),
                            ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                for (var i = 0; i < _steps.length; i++)
                  Container(
                    width: 10,
                    height: 10,
                    margin: const EdgeInsets.all(4),
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: i == _page ? ShiftlaneColors.blue : Colors.grey,
                    ),
                  ),
              ],
            ),
            Padding(
              padding: const EdgeInsets.all(20),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton(
                  key: Key(last ? 'tutorial-done' : 'tutorial-next'),
                  onPressed: last
                      ? _finish
                      : () => _pages.nextPage(
                          duration: const Duration(milliseconds: 300),
                          curve: Curves.easeOut,
                        ),
                  child: Text(last ? 'Empezar' : 'Siguiente'),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
