"""
Disk-backed store for enrolled speaker x-vectors.
One .npy file per customer_id under bioprints/.

In production this would be a DuckDB BLOB or Redis — for the demo, disk is fine.
"""

import logging
import os
from pathlib import Path
import numpy as np

logger = logging.getLogger(__name__)

BIOPRINTS_DIR = Path(os.environ.get("BIOPRINTS_DIR", "bioprints"))


def _path(customer_id: str) -> Path:
    safe = customer_id.replace("/", "_").replace("..", "_")
    return BIOPRINTS_DIR / f"{safe}.npy"


def save_bioprint(customer_id: str, embedding: np.ndarray) -> None:
    BIOPRINTS_DIR.mkdir(exist_ok=True)
    np.save(_path(customer_id), embedding)
    logger.info("Enrolled bioprint for %s", customer_id)


def load_bioprint(customer_id: str):
    p = _path(customer_id)
    if not p.exists():
        return None
    return np.load(p).astype(np.float32)


def has_bioprint(customer_id: str) -> bool:
    return _path(customer_id).exists()


def delete_bioprint(customer_id: str) -> bool:
    p = _path(customer_id)
    if p.exists():
        p.unlink()
        return True
    return False


def list_enrolled():
    if not BIOPRINTS_DIR.exists():
        return []
    return [p.stem for p in BIOPRINTS_DIR.glob("*.npy")]
