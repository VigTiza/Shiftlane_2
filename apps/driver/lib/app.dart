import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'application/auth/auth_providers.dart';
import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';

class ShiftlaneDriverApp extends ConsumerStatefulWidget {
  const ShiftlaneDriverApp({super.key});

  @override
  ConsumerState<ShiftlaneDriverApp> createState() => _ShiftlaneDriverAppState();
}

class _ShiftlaneDriverAppState extends ConsumerState<ShiftlaneDriverApp> {
  @override
  void initState() {
    super.initState();
    // ¿Celular vinculado? ¿Sesión que se pueda renovar?
    Future.microtask(
      () => ref.read(authControllerProvider.notifier).bootstrap(),
    );
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'Shiftlane Chofer',
      debugShowCheckedModeBanner: false,
      theme: buildShiftlaneTheme(),
      routerConfig: ref.watch(routerProvider),
      locale: const Locale('es', 'MX'),
    );
  }
}
