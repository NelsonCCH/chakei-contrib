"""sRGB to CIELAB (D65), used by keycut.py and inspect_parts.py for colour distances (dE76)."""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

FloatArr = NDArray[np.float64]


def srgb_to_lab(rgb: FloatArr) -> FloatArr:
    """rgb in 0..255, shape (..., 3) -> CIELAB (D65)."""
    c = rgb / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = lin @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    lab_l = 116 * f[..., 1] - 16
    lab_a = 500 * (f[..., 0] - f[..., 1])
    lab_b = 200 * (f[..., 1] - f[..., 2])
    return np.stack([lab_l, lab_a, lab_b], axis=-1)
