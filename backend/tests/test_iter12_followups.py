# Iteration 12: password_version migration, change-password for seeded kellner2 (reverted), inhaber flag, login regression
import os
import uuid

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/app/backend/.env")
BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", os.environ.get("EXPO_BACKEND_URL", "")).rstrip("/")
API = f"{BASE_URL}/api"
DB = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

SEEDED = [("kellner1", "Kellner123!", "waiter"), ("kellner2", "Kellner123!", "waiter"),
          ("kueche", "Kueche123!", "kitchen"), ("inhaber", "Inhaber123!", "owner")]


def login(u, p):
    return requests.post(f"{API}/auth/login", json={"username": u, "password": p}, timeout=20)


def hdr(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def owner_token():
    r = login("inhaber", "Inhaber123!")
    if r.status_code != 200:
        pytest.skip("owner login failed")
    return r.json()["access_token"]


# --- login regression for all roles ---
@pytest.mark.parametrize("u,p,role", SEEDED)
def test_login_all_roles(u, p, role):
    r = login(u, p)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["user"]["role"] == role
    assert isinstance(d["access_token"], str) and d["access_token"]


def test_login_wrong_password():
    assert login("kellner1", "wrong").status_code == 401


# --- migration: every account has password_version ---
def test_all_users_have_password_version():
    missing = list(DB.users.find({"password_version": {"$exists": False}}, {"_id": 0, "username": 1}))
    assert missing == [], missing


def test_inhaber_flagged_must_change(owner_token):
    r = login("inhaber", "Inhaber123!")
    assert r.json()["user"]["must_change_password"] is True
    s = requests.get(f"{API}/security/status", headers=hdr(owner_token)).json()
    names = [u["username"] for u in s["default_password_users"]]
    assert "inhaber" in names


# --- change-password on a fresh test_ account ---
def test_change_password_new_account(owner_token):
    uname = f"test_{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{API}/staff", headers=hdr(owner_token),
                      json={"username": uname, "display_name": "TEST_Iter12", "role": "waiter", "password": "TestPass123"})
    assert r.status_code == 201, r.text
    try:
        # simulate a legacy doc without password_version
        DB.users.update_one({"username": uname}, {"$unset": {"password_version": ""}})
        t = login(uname, "TestPass123").json()["access_token"]
        r = requests.post(f"{API}/auth/change-password", headers=hdr(t),
                          json={"current_password": "TestPass123", "new_password": "NewPass4567"})
        assert r.status_code == 200, r.text
        new_t = r.json()["access_token"]
        # old token revoked, new token works
        assert requests.get(f"{API}/auth/me", headers=hdr(t)).status_code == 401
        assert requests.get(f"{API}/auth/me", headers=hdr(new_t)).status_code == 200
        assert login(uname, "NewPass4567").status_code == 200
        assert login(uname, "TestPass123").status_code == 401
    finally:
        requests.delete(f"{API}/staff/{uname}", headers=hdr(owner_token))


# --- change-password for seeded kellner2, then revert (flag restored) ---
def test_change_password_kellner2_and_revert():
    before = DB.users.find_one({"username": "kellner2"}, {"_id": 0, "must_change_password": 1})
    t = login("kellner2", "Kellner123!").json()["access_token"]
    try:
        r = requests.post(f"{API}/auth/change-password", headers=hdr(t),
                          json={"current_password": "Kellner123!", "new_password": "TmpKellner987!"})
        assert r.status_code == 200, r.text
        assert r.json()["user"]["must_change_password"] is False
        t2 = r.json()["access_token"]
        r2 = requests.post(f"{API}/auth/change-password", headers=hdr(t2),
                           json={"current_password": "TmpKellner987!", "new_password": "Kellner123!"})
        assert r2.status_code == 200, r2.text
    finally:
        DB.users.update_one({"username": "kellner2"},
                            {"$set": {"must_change_password": before.get("must_change_password", True)}})
    assert login("kellner2", "Kellner123!").status_code == 200


def test_change_password_wrong_current():
    t = login("kellner1", "Kellner123!").json()["access_token"]
    r = requests.post(f"{API}/auth/change-password", headers=hdr(t),
                      json={"current_password": "nope", "new_password": "Whatever123!"})
    assert r.status_code == 400


# --- settings roundtrip (restored to Pizzaiolo) ---
def test_settings_roundtrip(owner_token):
    orig = requests.get(f"{API}/settings", headers=hdr(owner_token)).json()
    try:
        r = requests.put(f"{API}/settings", headers=hdr(owner_token),
                         json={"restaurant_name": "TEST_Trattoria", "address": "", "review_url": ""})
        assert r.status_code == 200
        w = login("kellner1", "Kellner123!").json()["access_token"]
        assert requests.get(f"{API}/settings", headers=hdr(w)).json()["restaurant_name"] == "TEST_Trattoria"
    finally:
        requests.put(f"{API}/settings", headers=hdr(owner_token), json=orig)
    assert requests.get(f"{API}/settings", headers=hdr(owner_token)).json() == orig
