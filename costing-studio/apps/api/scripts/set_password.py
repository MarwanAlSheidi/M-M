"""Set a user's login password. Runs as costing_migrator.

    python set_password.py ops@example.om          # prompts for the password
    NEW_PASSWORD=... python set_password.py ops@example.om
"""
from __future__ import annotations
import getpass
import os
import sys

import bcrypt
from sqlalchemy import text

from _db import MigratorSessionLocal

MIN_LEN = 10


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    email = sys.argv[1]
    pw = os.environ.get("NEW_PASSWORD") or getpass.getpass(f"New password for {email}: ")
    if len(pw) < MIN_LEN:
        sys.exit(f"password must be at least {MIN_LEN} characters")
    h = bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()
    with MigratorSessionLocal() as s, s.begin():
        n = s.execute(text("UPDATE users SET password_hash = :h WHERE lower(email) = lower(:e)"),
                      {"h": h, "e": email}).rowcount
    if n != 1:
        sys.exit(f"no user with email {email}")
    print(f"password updated for {email}")


if __name__ == "__main__":
    main()
