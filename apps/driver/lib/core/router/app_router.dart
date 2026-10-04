import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../application/auth/auth_controller.dart';
import '../../application/auth/auth_providers.dart';
import '../../application/device_check/device_check_controller.dart';
import '../../application/tutorial/tutorial_controller.dart';
import '../../application/update/update_controller.dart';
import '../../domain/auth/auth_models.dart';
import '../../presentation/screens/auth/auth_screens.dart';
import '../../presentation/screens/device_check/device_check_screen.dart';
import '../../presentation/screens/help/help_screen.dart';
import '../../presentation/screens/home_screen.dart';
import '../../presentation/screens/trip/arrival_screen.dart';
import '../../presentation/screens/trip/checklist_screen.dart';
import '../../presentation/screens/trip/scan_screen.dart';
import '../../presentation/screens/trip/trip_screen.dart';
import '../../presentation/screens/tutorial/tutorial_screen.dart';
import '../../presentation/screens/update/update_screen.dart';
import 'app_routes.dart';

export 'app_routes.dart';

/// A dónde debe ir el chofer según el estado del acceso (null: se queda). Una actualización
/// obligatoria va antes que todo; al entrar, primero se revisa el celular y la primera vez
/// se ve el tutorial.
String? redirectFor(
  AuthState auth,
  String location, {
  bool deviceChecked = true,
  bool tutorialSeen = true,
  bool mustUpdate = false,
}) {
  if (mustUpdate) return location == AppRoutes.update ? null : AppRoutes.update;
  final inEnroll = location.startsWith(AppRoutes.enroll);
  final inLogin = location.startsWith(AppRoutes.selectDriver);
  final inUpdate = location == AppRoutes.update;
  return switch (auth) {
    AuthLoading() => location == AppRoutes.loading ? null : AppRoutes.loading,
    _ when inUpdate => switch (auth) {
      AuthNeedsEnrollment() => AppRoutes.enroll,
      AuthNeedsDriver() => AppRoutes.selectDriver,
      _ => AppRoutes.home,
    },
    AuthNeedsEnrollment() => inEnroll ? null : AppRoutes.enroll,
    AuthNeedsDriver() => inEnroll || inLogin ? null : AppRoutes.selectDriver,
    AuthSignedIn() when !deviceChecked =>
      location == AppRoutes.deviceCheck ? null : AppRoutes.deviceCheck,
    AuthSignedIn() when !tutorialSeen =>
      location == AppRoutes.tutorial ? null : AppRoutes.tutorial,
    AuthSignedIn() =>
      inEnroll || inLogin || location == AppRoutes.loading
          ? AppRoutes.home
          : null,
  };
}

/// Navegador principal: lo usan los avisos que llegan en tiempo real.
final rootNavigatorKey = GlobalKey<NavigatorState>();

final routerProvider = Provider<GoRouter>((ref) {
  final auth = ValueNotifier<AuthState>(ref.read(authControllerProvider));
  ref.listen(authControllerProvider, (_, next) => auth.value = next);
  final checked = ValueNotifier<bool>(
    ref.read(deviceCheckProvider).acknowledged,
  );
  ref.listen(
    deviceCheckProvider,
    (_, next) => checked.value = next.acknowledged,
  );
  // Mientras se lee la marca del tutorial (null) no se redirige.
  final tutorialSeen = ValueNotifier<bool>(
    ref.read(tutorialControllerProvider) ?? true,
  );
  ref.listen(
    tutorialControllerProvider,
    (_, next) => tutorialSeen.value = next ?? true,
  );
  final mustUpdate = ValueNotifier<bool>(ref.read(mustUpdateProvider));
  ref.listen(mustUpdateProvider, (_, next) => mustUpdate.value = next);
  final controller = ref.read(authControllerProvider.notifier);

  final router = GoRouter(
    navigatorKey: rootNavigatorKey,
    initialLocation: AppRoutes.loading,
    refreshListenable: Listenable.merge([
      auth,
      checked,
      tutorialSeen,
      mustUpdate,
    ]),
    redirect: (context, state) => redirectFor(
      auth.value,
      state.matchedLocation,
      deviceChecked: checked.value,
      tutorialSeen: tutorialSeen.value,
      mustUpdate: mustUpdate.value,
    ),
    routes: [
      GoRoute(
        path: AppRoutes.loading,
        builder: (context, state) => const SplashScreen(),
      ),
      GoRoute(
        path: AppRoutes.home,
        builder: (context, state) => const HomeScreen(),
      ),
      GoRoute(
        path: AppRoutes.deviceCheck,
        builder: (context, state) => const DeviceCheckScreen(),
      ),
      GoRoute(
        path: AppRoutes.checklist,
        builder: (context, state) =>
            ChecklistScreen(tripId: state.extra! as String),
      ),
      GoRoute(
        path: AppRoutes.trip,
        builder: (context, state) => const TripScreen(),
      ),
      GoRoute(
        path: AppRoutes.scan,
        builder: (context, state) => const ScanScreen(),
      ),
      GoRoute(
        path: AppRoutes.arrival,
        builder: (context, state) => const ArrivalScreen(),
      ),
      GoRoute(
        path: AppRoutes.update,
        builder: (context, state) => const UpdateScreen(),
      ),
      GoRoute(
        path: AppRoutes.tutorial,
        builder: (context, state) => const TutorialScreen(),
      ),
      GoRoute(
        path: AppRoutes.help,
        builder: (context, state) => const HelpScreen(),
      ),
      GoRoute(
        path: AppRoutes.enroll,
        builder: (context, state) => const EnrollScreen(),
        routes: [
          GoRoute(
            path: 'pin',
            builder: (context, state) {
              final code = state.extra! as String;
              return CreatePinScreen(
                onSubmit: (pin) async {
                  final outcome = await controller.enroll(code, pin: pin);
                  return outcome is EnrollFailed ? outcome.message : null;
                },
              );
            },
          ),
        ],
      ),
      GoRoute(
        path: AppRoutes.selectDriver,
        builder: (context, state) => const DriverSelectScreen(),
        routes: [
          GoRoute(
            path: 'pin',
            builder: (context, state) =>
                PinScreen(driver: state.extra! as LinkedDriver),
          ),
          GoRoute(
            path: 'nuevo-pin',
            builder: (context, state) {
              final driver = state.extra! as LinkedDriver;
              return CreatePinScreen(
                title: 'Crea tu PIN nuevo',
                onSubmit: (pin) async =>
                    pinError(await controller.createPin(driver, pin)),
              );
            },
          ),
        ],
      ),
    ],
  );
  ref.onDispose(() {
    router.dispose();
    auth.dispose();
    checked.dispose();
    tutorialSeen.dispose();
    mustUpdate.dispose();
  });
  return router;
});
