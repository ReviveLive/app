"""Fleet fuel-costing and job-pricing feature.

Exposes the pure calculation core (service) and the `create_router(get_conn)`
factory that api.py mounts with app.include_router.

The pure core (service) imports nothing heavy, so it stays unit-testable on its
own. create_router lives in router.py, which does pull in FastAPI and the DB
layer — import it lazily (below) so anything that only needs the maths isn't
forced to load the web stack.
"""
from . import service  # noqa: F401  (re-exported for convenience)
from .router import create_router  # noqa: F401

__all__ = ["service", "create_router"]
