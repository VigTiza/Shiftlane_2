import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';

/// Teclado de PIN con números grandes. Avisa al completar los 4 dígitos.
class PinPad extends StatefulWidget {
  const PinPad({
    super.key,
    required this.onCompleted,
    this.errorText,
    this.busy = false,
  });

  final ValueChanged<String> onCompleted;
  final String? errorText;
  final bool busy;

  static const length = 4;

  @override
  State<PinPad> createState() => PinPadState();
}

class PinPadState extends State<PinPad> {
  String _digits = '';

  /// Borra lo escrito (por ejemplo, después de un PIN incorrecto).
  void clear() => setState(() => _digits = '');

  void _press(String digit) {
    if (widget.busy || _digits.length >= PinPad.length) return;
    setState(() => _digits += digit);
    if (_digits.length == PinPad.length) widget.onCompleted(_digits);
  }

  void _delete() {
    if (widget.busy || _digits.isEmpty) return;
    setState(() => _digits = _digits.substring(0, _digits.length - 1));
  }

  Widget _key(String label, {VoidCallback? onTap, Widget? child}) {
    return Padding(
      padding: const EdgeInsets.all(6),
      child: SizedBox(
        height: kMinButtonHeight + 12,
        child: OutlinedButton(
          key: Key('pin-$label'),
          onPressed: onTap,
          child: child ?? Text(label, style: const TextStyle(fontSize: 28)),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final rows = [
      ['1', '2', '3'],
      ['4', '5', '6'],
      ['7', '8', '9'],
    ];
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: List.generate(
            PinPad.length,
            (i) => Container(
              key: Key('pin-dot-$i'),
              margin: const EdgeInsets.all(10),
              width: 22,
              height: 22,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: ShiftlaneColors.navy, width: 2),
                color: i < _digits.length ? ShiftlaneColors.navy : null,
              ),
            ),
          ),
        ),
        SizedBox(
          height: 32,
          child: widget.errorText == null
              ? null
              : Text(
                  widget.errorText!,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: ShiftlaneColors.red,
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
        ),
        for (final row in rows)
          Row(
            children: [
              for (final digit in row)
                Expanded(child: _key(digit, onTap: () => _press(digit))),
            ],
          ),
        Row(
          children: [
            const Expanded(child: SizedBox()),
            Expanded(child: _key('0', onTap: () => _press('0'))),
            Expanded(
              child: _key(
                'borrar',
                onTap: _delete,
                child: const Icon(Icons.backspace_outlined, size: 28),
              ),
            ),
          ],
        ),
        if (widget.busy)
          const Padding(
            padding: EdgeInsets.only(top: 12),
            child: CircularProgressIndicator(),
          ),
      ],
    );
  }
}
