"""Genera los sonidos del escaneo de pasajeros de la app del chofer (WAV, 16 bits, mono).

Cada resultado suena distinto para que el chofer no tenga que ver la pantalla:
  - ok: dos tonos que suben (correcto)
  - other_route: dos tonos iguales a media altura (otra ruta o turno)
  - unregistered: dos tonos que bajan (gafete no registrado)
  - already_scanned: tres golpes cortos (ya escaneado)
  - rejected: zumbido grave (no válido)

Uso: python infra/scripts/generar-sonidos-chofer.py
"""

import math
import struct
import wave
from pathlib import Path

RATE = 22050
OUT = Path(__file__).resolve().parents[2] / "apps" / "driver" / "assets" / "sounds"

# (frecuencia en Hz o None para silencio, duración en ms)
SOUNDS = {
    "scan_ok": [(880, 90), (None, 40), (1320, 130)],
    "scan_other_route": [(660, 150), (None, 80), (660, 150)],
    "scan_unregistered": [(520, 180), (None, 40), (390, 260)],
    "scan_already_scanned": [(1000, 50), (None, 60), (1000, 50), (None, 60), (1000, 50)],
    "scan_rejected": [(220, 450)],
}


def tone(freq, ms, square=False):
    count = int(RATE * ms / 1000)
    fade = min(count // 4, int(RATE * 0.008))
    samples = []
    for i in range(count):
        if freq is None:
            samples.append(0.0)
            continue
        value = math.sin(2 * math.pi * freq * i / RATE)
        if square:
            # Onda casi cuadrada: más áspera, para el rechazo.
            value = max(-1.0, min(1.0, value * 3))
        envelope = min(1.0, i / fade if fade else 1.0, (count - i) / fade if fade else 1.0)
        samples.append(value * envelope * 0.8)
    return samples


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, parts in SOUNDS.items():
        samples = []
        for freq, ms in parts:
            samples.extend(tone(freq, ms, square=name == "scan_rejected"))
        path = OUT / f"{name}.wav"
        with wave.open(str(path), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(RATE)
            wav.writeframes(b"".join(struct.pack("<h", int(s * 32767)) for s in samples))
        print(f"{path.relative_to(OUT.parents[2])}: {len(samples) / RATE:.2f} s")


if __name__ == "__main__":
    main()
