import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';

class ShiftlaneDriverApp extends ConsumerWidget {
  const ShiftlaneDriverApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp.router(
      title: 'Shiftlane Chofer',
      debugShowCheckedModeBanner: false,
      theme: buildShiftlaneTheme(),
      routerConfig: ref.watch(routerProvider),
      locale: const Locale('es', 'MX'),
    );
  }
}
