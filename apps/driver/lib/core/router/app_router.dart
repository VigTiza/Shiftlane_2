import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../application/auth/auth_controller.dart';
import '../../application/auth/auth_providers.dart';
import '../../application/device_check/device_check_controller.dart';
import '../../domain/auth/auth_models.dart';
import '../../presentation/screens/auth/auth_screens.dart';
import '../../presentation/screens/device_check/device_check_screen.dart';
import '../../presentation/screens/home_screen.dart';
import 'app_routes.dart';

export 'app_routes.dart';

/// A dónde debe ir el chofer según el estado del acceso (null: se queda). Al entrar, primero
/// se revisa el celular.
String? redirectFor(
  AuthState auth,
  String location, {
  bool deviceChecked = true,
}) {
  final inEnroll = location.startsWith(AppRoutes.enroll);
  final inLogin = location.startsWith(AppRoutes.selectDriver);
  return switch (auth) {
    AuthLoading() => location == AppRoutes.loading ? null : AppRoutes.loading,
    AuthNeedsEnrollment() => inEnroll ? null : AppRoutes.enroll,
    AuthNeedsDriver() => inEnroll || inLogin ? null : AppRoutes.selectDriver,
    AuthSignedIn() when !deviceChecked =>
      location == AppRoutes.deviceCheck ? null : AppRoutes.deviceCheck,
    AuthSignedIn() =>
      inEnroll || inLogin || location == AppRoutes.loading
          ? AppRoutes.home
          : null,
  };
}

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
  final controller = ref.read(authControllerProvider.notifier);

  final router = GoRouter(
    initialLocation: AppRoutes.loading,
    refreshListenable: Listenable.merge([auth, checked]),
    redirect: (context, state) => redirectFor(
      auth.value,
      state.matchedLocation,
      deviceChecked: checked.value,
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
  });
  return router;
});
