import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/auth/api_auth_repository.dart';
import '../../data/auth/secure_credential_store.dart';
import '../../domain/auth/auth_models.dart';
import '../../presentation/widgets/qr_scanner_view.dart';
import '../providers.dart';
import 'auth_controller.dart';

final credentialStoreProvider = Provider<CredentialStore>(
  (ref) => SecureCredentialStore(),
);

final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => ApiAuthRepository(
    ref.watch(apiClientProvider),
    deviceInfo: const {'platform': 'android', 'appVersion': '0.1.0'},
  ),
);

final authControllerProvider = NotifierProvider<AuthController, AuthState>(
  AuthController.new,
);

/// Lector de códigos QR (la cámara en el celular; en pruebas se reemplaza).
typedef QrScannerBuilder = Widget Function(
  BuildContext context,
  ValueChanged<String> onCode,
);

final qrScannerProvider = Provider<QrScannerBuilder>(
  (ref) =>
      (context, onCode) => QrScannerView(onCode: onCode),
);
