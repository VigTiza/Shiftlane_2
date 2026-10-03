import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors/app_failure.dart';
import '../../core/logging/app_logger.dart';
import '../../domain/auth/auth_models.dart';
import '../providers.dart';
import 'auth_providers.dart';

/// En qué punto del acceso está el celular.
sealed class AuthState {
  const AuthState();
}

class AuthLoading extends AuthState {
  const AuthLoading();
}

/// El celular no está vinculado: hay que escanear el QR de alta.
class AuthNeedsEnrollment extends AuthState {
  const AuthNeedsEnrollment();
}

/// Celular vinculado sin nadie adentro: el chofer elige su nombre y escribe su PIN.
class AuthNeedsDriver extends AuthState {
  const AuthNeedsDriver();
}

class AuthSignedIn extends AuthState {
  const AuthSignedIn(this.session, {this.offline = false});

  final DriverSession session;

  /// Se abrió sin señal: el token se renueva al recuperar la conexión.
  final bool offline;
}

/// Resultado de escanear el QR de alta.
sealed class EnrollOutcome {
  const EnrollOutcome();
}

class EnrollSucceeded extends EnrollOutcome {
  const EnrollSucceeded();
}

/// Primer celular del chofer: debe crear su PIN antes de terminar la vinculación.
class EnrollNeedsPin extends EnrollOutcome {
  const EnrollNeedsPin(this.code);

  final String code;
}

class EnrollFailed extends EnrollOutcome {
  const EnrollFailed(this.message);

  final String message;
}

/// Resultado de escribir el PIN.
sealed class PinOutcome {
  const PinOutcome();
}

class PinAccepted extends PinOutcome {
  const PinAccepted();
}

/// El despachador restableció el PIN: hay que crear uno nuevo.
class PinMustBeCreated extends PinOutcome {
  const PinMustBeCreated();
}

class PinRejected extends PinOutcome {
  const PinRejected(this.message);

  final String message;
}

class AuthController extends Notifier<AuthState> {
  final _log = appLogger('auth');
  Future<String?>? _refreshing;

  AuthRepository get _repository => ref.read(authRepositoryProvider);
  CredentialStore get _store => ref.read(credentialStoreProvider);

  @override
  AuthState build() => const AuthLoading();

  /// Al abrir la app: ¿celular vinculado? ¿sesión que se pueda renovar?
  Future<void> bootstrap() async {
    final device = await _store.readDevice();
    if (device == null) {
      state = const AuthNeedsEnrollment();
      return;
    }
    final saved = await _store.readSession();
    if (saved == null) {
      state = const AuthNeedsDriver();
      return;
    }
    try {
      final tokens = await _repository.refresh(saved.refreshToken);
      await _signIn(
        DriverSession(
          driverId: saved.driverId,
          fullName: saved.fullName,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        ),
      );
    } on NetworkFailure {
      // Sin señal al abrir: el chofer sigue trabajando y se renueva después.
      state = AuthSignedIn(
        DriverSession(
          driverId: saved.driverId,
          fullName: saved.fullName,
          accessToken: '',
          refreshToken: saved.refreshToken,
        ),
        offline: true,
      );
    } on AppFailure catch (failure) {
      _log.info('No se pudo renovar la sesión: ${failure.message}');
      await _store.clearSession();
      state = const AuthNeedsDriver();
    }
  }

  /// Renueva el token cuando venció (o si la app se abrió sin señal). Una sola renovación
  /// aunque fallen varias peticiones a la vez. Sin señal devuelve null y se sigue adentro;
  /// si el servidor rechaza la sesión, el chofer vuelve a escribir su PIN.
  Future<String?> refreshAccessToken() =>
      _refreshing ??= _refresh().whenComplete(() => _refreshing = null);

  Future<String?> _refresh() async {
    final saved = await _store.readSession();
    if (saved == null) return null;
    try {
      final tokens = await _repository.refresh(saved.refreshToken);
      await _signIn(
        DriverSession(
          driverId: saved.driverId,
          fullName: saved.fullName,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        ),
      );
      return tokens.accessToken;
    } on NetworkFailure {
      return null;
    } on AppFailure catch (failure) {
      _log.info('La sesión ya no es válida: ${failure.message}');
      await _store.clearSession();
      ref.read(accessTokenProvider.notifier).set(null);
      state = const AuthNeedsDriver();
      return null;
    }
  }

  Future<void> _signIn(DriverSession session) async {
    await _store.writeSession(
      driverId: session.driverId,
      fullName: session.fullName,
      refreshToken: session.refreshToken,
    );
    ref.read(accessTokenProvider.notifier).set(session.accessToken);
    state = AuthSignedIn(session);
  }

  /// Vincula el celular con el QR del despachador (o el código escrito a mano).
  Future<EnrollOutcome> enroll(String raw, {String? pin}) async {
    final code = enrollmentCodeFrom(raw);
    if (code == null) {
      return const EnrollFailed(
        'Ese código no es de Shiftlane. Pide al despachador el QR de alta.',
      );
    }
    final device = await _store.readDevice();
    try {
      final result = await _repository.enroll(
        code: code,
        pin: pin,
        device: device,
      );
      if (result.newDeviceSecret != null) {
        await _store.writeDevice(
          DeviceCredentials(
            deviceId: result.deviceId,
            secret: result.newDeviceSecret!,
          ),
        );
      }
      await _signIn(
        DriverSession(
          driverId: result.driverId,
          fullName: result.fullName,
          accessToken: result.tokens.accessToken,
          refreshToken: result.tokens.refreshToken,
        ),
      );
      return const EnrollSucceeded();
    } on ValidationFailure catch (failure) {
      if (failure.code == 'PIN_REQUIRED') return EnrollNeedsPin(code);
      return EnrollFailed(failure.message);
    } on AppFailure catch (failure) {
      return EnrollFailed(failure.message);
    }
  }

  Future<List<LinkedDriver>> linkedDrivers() async {
    final device = await _store.readDevice();
    if (device == null) {
      state = const AuthNeedsEnrollment();
      return const [];
    }
    return _repository.linkedDrivers(device);
  }

  Future<PinOutcome> login(LinkedDriver driver, String pin) async {
    final device = await _store.readDevice();
    if (device == null) {
      return const PinRejected('El celular no está vinculado.');
    }
    try {
      final tokens = await _repository.login(
        device,
        driverId: driver.id,
        pin: pin,
      );
      await _signIn(
        DriverSession(
          driverId: driver.id,
          fullName: driver.fullName,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        ),
      );
      return const PinAccepted();
    } on ConflictFailure catch (failure) {
      if (failure.code == 'PIN_NOT_SET') return const PinMustBeCreated();
      return PinRejected(failure.message);
    } on AppFailure catch (failure) {
      return PinRejected(failure.message);
    }
  }

  /// Crea el PIN nuevo después de que el despachador lo restableció.
  Future<PinOutcome> createPin(LinkedDriver driver, String pin) async {
    final device = await _store.readDevice();
    if (device == null) {
      return const PinRejected('El celular no está vinculado.');
    }
    try {
      final tokens = await _repository.createPin(
        device,
        driverId: driver.id,
        pin: pin,
      );
      await _signIn(
        DriverSession(
          driverId: driver.id,
          fullName: driver.fullName,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        ),
      );
      return const PinAccepted();
    } on AppFailure catch (failure) {
      return PinRejected(failure.message);
    }
  }

  /// Celular compartido: sale el chofer actual y entra otro con su PIN.
  Future<void> switchDriver() async {
    final current = state;
    if (current is AuthSignedIn && current.session.accessToken.isNotEmpty) {
      try {
        await _repository.logout(current.session.accessToken);
      } on AppFailure catch (failure) {
        _log.info(
          'No se pudo cerrar la sesión en el servidor: ${failure.message}',
        );
      }
    }
    await _store.clearSession();
    ref.read(accessTokenProvider.notifier).set(null);
    state = const AuthNeedsDriver();
  }
}
