#!/usr/bin/env python3
"""Checks if admin user exists; creates one with a random password if not."""
import os, sys, secrets, string

_HERE = os.path.dirname(os.path.abspath(__file__))
if os.path.dirname(_HERE) not in sys.path:
    sys.path.insert(0, os.path.dirname(_HERE))

from server.auth import load_users, save_users, hash_password


def _gen_password(n: int = 16) -> str:
    chars = string.ascii_letters + string.digits + "!@#$%"
    return "".join(secrets.choice(chars) for _ in range(n))


def init_admin() -> bool:
    users = load_users()
    if "admin" in users:
        print("[✓] Usuario admin ya existe.")
        return False

    pwd = _gen_password()
    users["admin"] = {
        "username": "admin",
        "password": hash_password(pwd),
        "role": "admin",
        "must_change_password": True,
    }
    save_users(users)

    print("\n" + "═" * 50)
    print("  [✓] Usuario admin creado")
    print(f"      Username : admin")
    print(f"      Password : {pwd}")
    print("  [!] Cambia la contraseña en el primer acceso")
    print("═" * 50 + "\n")
    return True


if __name__ == "__main__":
    init_admin()
