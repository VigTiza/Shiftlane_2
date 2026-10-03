import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';

/// Botón grande de la pantalla principal (mínimo 56 px, ícono y texto).
class BigButton extends StatelessWidget {
  const BigButton({
    super.key,
    required this.label,
    required this.icon,
    required this.onPressed,
    this.color,
  });

  final String label;
  final IconData icon;
  final VoidCallback? onPressed;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      height: kMinButtonHeight + 24,
      child: FilledButton.icon(
        onPressed: onPressed,
        icon: Icon(icon, size: 32),
        label: Text(label),
        style: color == null
            ? null
            : FilledButton.styleFrom(backgroundColor: color),
      ),
    );
  }
}
