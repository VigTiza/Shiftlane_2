import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../application/device_check/device_check_controller.dart';
import '../../../core/router/app_routes.dart';
import '../../../core/theme/app_theme.dart';
import '../../../domain/device_check/brand_guides.dart';
import '../../../domain/device_check/device_check.dart';
import '../../widgets/settings_path_illustration.dart';

/// Revisión del celular antes del turno: todo en verde para poder iniciar viajes.
class DeviceCheckScreen extends ConsumerStatefulWidget {
  const DeviceCheckScreen({super.key});

  @override
  ConsumerState<DeviceCheckScreen> createState() => _DeviceCheckScreenState();
}

class _DeviceCheckScreenState extends ConsumerState<DeviceCheckScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(_run);
  }

  Future<void> _run() async {
    final report = await ref.read(deviceCheckProvider.notifier).run();
    if (!mounted) return;
    // Todo en verde: sigue solo a la pantalla principal.
    if (report.status == CheckStatus.ok) _continue();
  }

  void _continue() {
    ref.read(deviceCheckProvider.notifier).acknowledge();
    context.go(AppRoutes.home);
  }

  Future<void> _showGuide(CheckResult result, PhoneBrand brand) async {
    final guide = guideFor(brand, result.item);
    final fix = result.fix;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (context) => SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                checkLabel(result.item),
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 4),
              Text('En ${brandLabel(brand)}:'),
              const SizedBox(height: 12),
              SettingsPathIllustration(brand: brand, path: guide.path),
              const SizedBox(height: 12),
              for (final (index, step) in guide.steps.indexed)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text(
                    '${index + 1}. $step',
                    style: const TextStyle(fontSize: 18),
                  ),
                ),
              if (fix != null && guide.buttonLabel != null) ...[
                const SizedBox(height: 8),
                FilledButton(
                  key: const Key('guide-fix'),
                  onPressed: () async {
                    Navigator.pop(context);
                    await ref.read(deviceCheckProvider.notifier).fix(fix);
                  },
                  child: Text(guide.buttonLabel!),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(deviceCheckProvider);
    final report = state.report;
    return Scaffold(
      appBar: AppBar(title: const Text('Revisión del celular')),
      body: SafeArea(
        child: report == null
            ? const Center(child: CircularProgressIndicator())
            : ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  _Summary(report: report),
                  const SizedBox(height: 12),
                  for (final result in report.results)
                    _CheckTile(
                      result: result,
                      onFix: result.status == CheckStatus.ok
                          ? null
                          : () => _showGuide(result, report.brand),
                    ),
                  const SizedBox(height: 16),
                  if (state.running) const LinearProgressIndicator(),
                  OutlinedButton.icon(
                    key: const Key('check-again'),
                    onPressed: state.running ? null : _run,
                    icon: const Icon(Icons.refresh),
                    label: const Text('Volver a revisar'),
                  ),
                  const SizedBox(height: 12),
                  FilledButton(
                    key: const Key('check-continue'),
                    onPressed: state.running ? null : _continue,
                    child: Text(
                      report.canStartTrip
                          ? 'Continuar'
                          : 'Ir al inicio sin iniciar viajes',
                    ),
                  ),
                  if (!report.canStartTrip)
                    const Padding(
                      padding: EdgeInsets.only(top: 12),
                      child: Text(
                        'Si no puedes resolverlo, pide al despachador que autorice la salida.',
                        textAlign: TextAlign.center,
                      ),
                    ),
                ],
              ),
      ),
    );
  }
}

class _Summary extends StatelessWidget {
  const _Summary({required this.report});

  final DeviceCheckReport report;

  @override
  Widget build(BuildContext context) {
    final (color, text) = switch (report.status) {
      CheckStatus.ok => (ShiftlaneColors.green, 'Todo en orden'),
      CheckStatus.warning => (
        ShiftlaneColors.amber,
        'Puedes iniciar, pero revisa los avisos',
      ),
      CheckStatus.problem => (
        ShiftlaneColors.red,
        'Arregla lo que está en rojo para iniciar viajes',
      ),
    };
    return Container(
      key: const Key('check-summary'),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        border: Border.all(color: color, width: 2),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Text(
        text,
        style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
      ),
    );
  }
}

class _CheckTile extends StatelessWidget {
  const _CheckTile({required this.result, this.onFix});

  final CheckResult result;
  final VoidCallback? onFix;

  @override
  Widget build(BuildContext context) {
    final (icon, color) = switch (result.status) {
      CheckStatus.ok => (Icons.check_circle, ShiftlaneColors.green),
      CheckStatus.warning => (Icons.warning_rounded, ShiftlaneColors.amber),
      CheckStatus.problem => (Icons.cancel, ShiftlaneColors.red),
    };
    return Card(
      child: ListTile(
        key: Key('check-${result.item.name}'),
        minVerticalPadding: 14,
        leading: Icon(icon, color: color, size: 34),
        title: Text(
          checkLabel(result.item),
          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
        ),
        subtitle: result.status == CheckStatus.ok ? null : Text(result.message),
        trailing: onFix == null
            ? null
            : TextButton(onPressed: onFix, child: const Text('Arreglar')),
        onTap: onFix,
      ),
    );
  }
}
