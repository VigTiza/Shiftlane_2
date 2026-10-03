import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../application/auth/auth_controller.dart';
import '../../../application/auth/auth_providers.dart';
import '../../../core/errors/app_failure.dart';
import '../../../core/router/app_routes.dart';
import '../../../domain/auth/auth_models.dart';
import '../../widgets/pin_pad.dart';

class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Shiftlane',
              style: TextStyle(fontSize: 36, fontWeight: FontWeight.w800),
            ),
            SizedBox(height: 24),
            CircularProgressIndicator(),
          ],
        ),
      ),
    );
  }
}

/// Vinculación del celular: el chofer escanea el QR que le muestra el despachador.
class EnrollScreen extends ConsumerStatefulWidget {
  const EnrollScreen({super.key});

  @override
  ConsumerState<EnrollScreen> createState() => _EnrollScreenState();
}

class _EnrollScreenState extends ConsumerState<EnrollScreen> {
  bool _busy = false;
  String? _error;

  Future<void> _submit(String raw) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final outcome = await ref.read(authControllerProvider.notifier).enroll(raw);
    if (!mounted) return;
    setState(() => _busy = false);
    switch (outcome) {
      case EnrollSucceeded():
        break; // La redirección lleva a la pantalla principal.
      case EnrollNeedsPin(:final code):
        unawaited(context.push(AppRoutes.enrollPin, extra: code));
      case EnrollFailed(:final message):
        setState(() => _error = message);
    }
  }

  Future<void> _typeCode() async {
    final controller = TextEditingController();
    final code = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Escribe el código'),
        content: TextField(
          key: const Key('enroll-code-field'),
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(
            hintText: 'Código que aparece debajo del QR',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text),
            child: const Text('Vincular'),
          ),
        ],
      ),
    );
    if (code != null && code.trim().isNotEmpty) await _submit(code);
  }

  @override
  Widget build(BuildContext context) {
    final scanner = ref.watch(qrScannerProvider);
    final canGoBack = context.canPop();
    return Scaffold(
      appBar: AppBar(
        title: const Text('Vincular celular'),
        automaticallyImplyLeading: canGoBack,
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Escanea el código QR que te muestra el despachador.',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 16),
              Expanded(child: scanner(context, _submit)),
              const SizedBox(height: 12),
              if (_busy) const LinearProgressIndicator(),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Text(
                    _error!,
                    key: const Key('enroll-error'),
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              OutlinedButton.icon(
                onPressed: _busy ? null : _typeCode,
                icon: const Icon(Icons.keyboard),
                label: const Text('Escribir el código'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Crear el PIN: se escribe dos veces para no equivocarse.
class CreatePinScreen extends StatefulWidget {
  const CreatePinScreen({super.key, required this.onSubmit, this.title});

  /// Devuelve un mensaje de error o null si todo salió bien.
  final Future<String?> Function(String pin) onSubmit;
  final String? title;

  @override
  State<CreatePinScreen> createState() => _CreatePinScreenState();
}

class _CreatePinScreenState extends State<CreatePinScreen> {
  final _pad = GlobalKey<PinPadState>();
  String? _first;
  String? _error;
  bool _busy = false;

  Future<void> _onCompleted(String pin) async {
    if (_first == null) {
      setState(() {
        _first = pin;
        _error = null;
      });
      _pad.currentState?.clear();
      return;
    }
    if (pin != _first) {
      setState(() {
        _first = null;
        _error = 'Los PIN no coinciden. Escríbelo de nuevo.';
      });
      _pad.currentState?.clear();
      return;
    }
    setState(() => _busy = true);
    final error = await widget.onSubmit(pin);
    if (!mounted) return;
    setState(() {
      _busy = false;
      _error = error;
      if (error != null) _first = null;
    });
    if (error != null) _pad.currentState?.clear();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.title ?? 'Crea tu PIN')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Column(
            children: [
              Text(
                _first == null
                    ? 'Escribe un PIN de 4 dígitos que solo tú sepas.'
                    : 'Escríbelo otra vez para confirmar.',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 16),
              PinPad(
                key: _pad,
                onCompleted: _onCompleted,
                errorText: _error,
                busy: _busy,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Celular compartido: ¿quién maneja hoy?
class DriverSelectScreen extends ConsumerStatefulWidget {
  const DriverSelectScreen({super.key});

  @override
  ConsumerState<DriverSelectScreen> createState() => _DriverSelectScreenState();
}

class _DriverSelectScreenState extends ConsumerState<DriverSelectScreen> {
  late Future<List<LinkedDriver>> _drivers = _load();

  Future<List<LinkedDriver>> _load() =>
      ref.read(authControllerProvider.notifier).linkedDrivers();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('¿Quién maneja hoy?')),
      body: SafeArea(
        child: FutureBuilder<List<LinkedDriver>>(
          future: _drivers,
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snapshot.hasError) {
              final message = snapshot.error is AppFailure
                  ? (snapshot.error! as AppFailure).message
                  : 'No se pudo cargar la lista de choferes.';
              return Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(message, textAlign: TextAlign.center),
                    const SizedBox(height: 16),
                    FilledButton(
                      onPressed: () => setState(() => _drivers = _load()),
                      child: const Text('Reintentar'),
                    ),
                  ],
                ),
              );
            }
            final drivers = snapshot.data ?? const [];
            return ListView(
              padding: const EdgeInsets.all(20),
              children: [
                for (final driver in drivers)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: SizedBox(
                      height: 72,
                      child: OutlinedButton.icon(
                        onPressed: () => context.push(
                          driver.pinSet ? AppRoutes.pin : AppRoutes.newPin,
                          extra: driver,
                        ),
                        icon: const Icon(Icons.person, size: 32),
                        label: Text(driver.fullName),
                      ),
                    ),
                  ),
                const SizedBox(height: 12),
                TextButton.icon(
                  onPressed: () => context.push(AppRoutes.enroll),
                  icon: const Icon(Icons.qr_code),
                  label: const Text('Vincular otro chofer'),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

/// Entrada con PIN.
class PinScreen extends ConsumerStatefulWidget {
  const PinScreen({super.key, required this.driver});

  final LinkedDriver driver;

  @override
  ConsumerState<PinScreen> createState() => _PinScreenState();
}

class _PinScreenState extends ConsumerState<PinScreen> {
  final _pad = GlobalKey<PinPadState>();
  String? _error;
  bool _busy = false;

  Future<void> _onCompleted(String pin) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final outcome = await ref
        .read(authControllerProvider.notifier)
        .login(widget.driver, pin);
    if (!mounted) return;
    setState(() => _busy = false);
    switch (outcome) {
      case PinAccepted():
        break;
      case PinMustBeCreated():
        context.pushReplacement(AppRoutes.newPin, extra: widget.driver);
      case PinRejected(:final message):
        setState(() => _error = message);
        _pad.currentState?.clear();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Hola, ${widget.driver.fullName}')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Column(
            children: [
              Text(
                'Escribe tu PIN',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 16),
              PinPad(
                key: _pad,
                onCompleted: _onCompleted,
                errorText: _error,
                busy: _busy,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Mensaje de error de un resultado de PIN, o null si se aceptó.
String? pinError(PinOutcome outcome) =>
    outcome is PinRejected ? outcome.message : null;
