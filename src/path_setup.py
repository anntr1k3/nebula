"""Добавить каталог ``src`` в ``sys.path`` перед импортом ``app``."""

from __future__ import annotations

import sys
from pathlib import Path


def ensure_src_path() -> None:
    root = Path(__file__).resolve().parent
    s = str(root)
    if s not in sys.path:
        sys.path.insert(0, s)
