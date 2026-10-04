import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../domain/scan/scan_models.dart';

/// Cámara para escanear pasajeros: credenciales QR de Shiftlane y gafetes existentes (QR o
/// códigos de barras comunes en las plantas).
class CodeScannerView extends StatefulWidget {
  const CodeScannerView({super.key, required this.onCode});

  final ValueChanged<ScannedCode> onCode;

  @override
  State<CodeScannerView> createState() => _CodeScannerViewState();
}

class _CodeScannerViewState extends State<CodeScannerView> {
  final _controller = MobileScannerController(
    formats: const [
      BarcodeFormat.qrCode,
      BarcodeFormat.code128,
      BarcodeFormat.code39,
      BarcodeFormat.code93,
      BarcodeFormat.codabar,
      BarcodeFormat.ean13,
      BarcodeFormat.ean8,
      BarcodeFormat.itf14,
      BarcodeFormat.upcA,
      BarcodeFormat.dataMatrix,
      BarcodeFormat.pdf417,
    ],
  );
  String? _last;
  DateTime _lastAt = DateTime.fromMillisecondsSinceEpoch(0);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _onDetect(BarcodeCapture capture) {
    final barcode = capture.barcodes
        .where((b) => b.rawValue != null)
        .firstOrNull;
    if (barcode == null) return;
    final value = barcode.rawValue!;
    final now = DateTime.now();
    // La cámara lee el mismo código muchas veces por segundo.
    if (value == _last && now.difference(_lastAt).inSeconds < 3) return;
    _last = value;
    _lastAt = now;
    widget.onCode(
      ScannedCode(value, isQr: barcode.format == BarcodeFormat.qrCode),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(16),
      child: MobileScanner(controller: _controller, onDetect: _onDetect),
    );
  }
}
