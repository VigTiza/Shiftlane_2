import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

/// Cámara que lee códigos QR y de barras. Avisa una sola vez por código.
class QrScannerView extends StatefulWidget {
  const QrScannerView({super.key, required this.onCode});

  final ValueChanged<String> onCode;

  @override
  State<QrScannerView> createState() => _QrScannerViewState();
}

class _QrScannerViewState extends State<QrScannerView> {
  String? _last;
  DateTime _lastAt = DateTime.fromMillisecondsSinceEpoch(0);

  void _onDetect(BarcodeCapture capture) {
    final value = capture.barcodes
        .map((b) => b.rawValue)
        .whereType<String>()
        .firstOrNull;
    if (value == null) return;
    final now = DateTime.now();
    // La cámara lee el mismo código muchas veces por segundo.
    if (value == _last && now.difference(_lastAt).inSeconds < 3) return;
    _last = value;
    _lastAt = now;
    widget.onCode(value);
  }

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(16),
      child: MobileScanner(onDetect: _onDetect),
    );
  }
}
