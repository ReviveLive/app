"""Single database connection helper."""
import psycopg

from .config import DATABASE_URL


def connect():
    return psycopg.connect(DATABASE_URL)
