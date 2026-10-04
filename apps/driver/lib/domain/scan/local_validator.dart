import 'dart:convert';

import 'package:crypto/crypto.dart';

import 'scan_models.dart';

/// Resultado del escaneo calculado en el celular (sin esperar al servidor).
class LocalScanResult {
  const LocalScanResult({
    required this.outcome,
    required this.message,
    this.passenger,
  });

  final ScanOutcome outcome;
  final String message;
  final ManifestPassenger? passenger;
}

String _sha256(String value) => sha256.convert(utf8.encode(value)).toString();

/// Valor aleatorio de una credencial QR de Shiftlane (`SL1.<datos>.<firma>`), o null si el
/// código no tiene esa forma. El valor solo lo tienen las credenciales auténticas: su huella
/// en la lista de la planta confirma la credencial sin señal.
String? shiftlaneCredentialValue(String code) {
  final parts = code.trim().split('.');
  if (parts.length != 3 || parts[0] != 'SL1') return null;
  try {
    final claims = jsonDecode(
      utf8.decode(base64Url.decode(base64Url.normalize(parts[1]))),
    );
    final value = claims is Map ? claims['v'] : null;
    return value is String && value.length >= 8 ? value : null;
  } on FormatException {
    return null;
  }
}

/// Valida un escaneo contra la lista descargada. Usa los mismos criterios y mensajes que el
/// servidor, que después confirma (o corrige) el resultado.
LocalScanResult validateLocally(
  TripManifest manifest, {
  String? code,
  String? employeeNumber,
  Set<String> scannedHere = const {},
}) {
  ManifestPassenger? passenger;
  if (code != null) {
    final trimmed = code.trim();
    if (trimmed.startsWith('SL1.')) {
      final value = shiftlaneCredentialValue(trimmed);
      if (value == null) {
        return const LocalScanResult(
          outcome: ScanOutcome.rejected,
          message: 'El código QR no es una credencial válida de Shiftlane.',
        );
      }
      passenger = manifest.byCredentialHash(_sha256(value));
      if (passenger == null) {
        return const LocalScanResult(
          outcome: ScanOutcome.rejected,
          message: 'La credencial no está vigente en esta planta.',
        );
      }
    } else {
      passenger = manifest.byCredentialHash(_sha256(trimmed));
      if (passenger == null) {
        return const LocalScanResult(
          outcome: ScanOutcome.unregistered,
          message: 'Gafete no registrado: queda como provisional y la planta lo revisará.',
        );
      }
    }
  } else if (employeeNumber != null) {
    passenger = manifest.byEmployeeNumber(employeeNumber.trim());
    if (passenger == null) {
      return const LocalScanResult(
        outcome: ScanOutcome.rejected,
        message: 'No se encontró el número de empleado en esta planta.',
      );
    }
  } else {
    return const LocalScanResult(
      outcome: ScanOutcome.rejected,
      message: 'Escanea un código o escribe el número de empleado.',
    );
  }

  if (manifest.boarded.contains(passenger.id) ||
      scannedHere.contains(passenger.id)) {
    return LocalScanResult(
      outcome: ScanOutcome.alreadyScanned,
      message: 'Ya se había escaneado en este viaje.',
      passenger: passenger,
    );
  }
  if (!passenger.onRoute) {
    return LocalScanResult(
      outcome: ScanOutcome.otherRoute,
      message: 'Pasajero de otra ruta o turno.',
      passenger: passenger,
    );
  }
  return LocalScanResult(
    outcome: ScanOutcome.ok,
    message: 'Bienvenido, ${passenger.firstName}.',
    passenger: passenger,
  );
}
