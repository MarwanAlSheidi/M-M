"""The single source of the benchmark's version.

Every other surface — the package's ``__version__``, the runner, the report
document, the manifest builder — reads from here. Before this module the
version was written out in four places and one of them silently fell behind,
so an installed package reported a different release than the runs it produced.
"""

from __future__ import annotations

__version__ = "2.0.5"

VERSION = __version__
