"""Bounded feature modules that plug into the read-only API.

Each module here is self-contained: a pure calculation core, its own SQL, and a
`create_router(get_conn)` factory that api.py mounts with app.include_router.
There is no plugin engine or dynamic loader (out of scope for the demo); this is
just a tidy home for feature code so it stays decoupled from the core endpoints.
"""
