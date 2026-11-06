# Login robustness tests: whitespace trimming, case-insensitive username, wrong pw still 401
import os
import pytest
import requests

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")).rstrip("/")

ACCOUNTS = [
    ("kellner1", "Kellner123!", "waiter"),
    ("kellner2", "Kellner123!", "waiter"),
    ("kueche", "Kueche123!", "kitchen"),
    ("inhaber", "Inhaber123!", "owner"),
]


def _login(u, p):
    return requests.post(f"{BASE_URL}/api/auth/login", json={"username": u, "password": p}, timeout=20)


@pytest.mark.parametrize("u,p,role", ACCOUNTS)
def test_all_accounts_login(u, p, role):
    r = _login(u, p)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["access_token"]
    assert d["user"]["username"] == u
    assert d["user"]["role"] == role
    # token works
    me = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {d['access_token']}"}, timeout=20)
    assert me.status_code in (200, 404)


def test_login_with_spaces_and_capital():
    r = _login(" Kellner1 ", "Kellner123! ")
    assert r.status_code == 200, r.text
    assert r.json()["user"]["username"] == "kellner1"


def test_login_leading_space_password():
    r = _login("kueche", "  Kueche123!")
    assert r.status_code == 200, r.text


def test_wrong_password_401():
    r = _login("kellner1", "wrong")
    assert r.status_code == 401
    assert "falsch" in r.text


def test_wrong_case_password_401():
    r = _login("kellner1", "kellner123!")
    assert r.status_code == 401


def test_unknown_user_401():
    r = _login("TEST_nobody", "Kellner123!")
    assert r.status_code == 401
