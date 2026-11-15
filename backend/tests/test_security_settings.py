# Iteration 11: password security (must_change_password, change-password, token revocation) + receipt settings
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", os.environ.get("EXPO_BACKEND_URL", "")).rstrip("/")
API = f"{BASE_URL}/api"

CREDS = {
    "owner": ("inhaber", "Inhaber123!"),
    "waiter": ("kellner1", "Kellner123!"),
    "kitchen": ("kueche", "Kueche123!"),
}


def login(u, p):
    r = requests.post(f"{API}/auth/login", json={"username": u, "password": p}, timeout=20)
    return r


def hdr(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def tokens():
    out = {}
    for role, (u, p) in CREDS.items():
        r = login(u, p)
        if r.status_code != 200:
            pytest.skip(f"login failed for {u}")
        out[role] = r.json()["access_token"]
    return out


@pytest.fixture(scope="module")
def test_user(tokens):
    uname = f"test_{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{API}/staff", headers=hdr(tokens["owner"]),
                      json={"username": uname, "display_name": "TEST_User", "role": "waiter", "password": "TestPass123"})
    assert r.status_code == 201, r.text
    assert r.json()["must_change_password"] is False
    yield uname
    requests.delete(f"{API}/staff/{uname}", headers=hdr(tokens["owner"]))


@pytest.fixture(scope="module")
def original_settings(tokens):
    s = requests.get(f"{API}/settings", headers=hdr(tokens["owner"])).json()
    yield s
    requests.put(f"{API}/settings", headers=hdr(tokens["owner"]), json=s)


# --- must_change_password flags ---
class TestSecurityStatus:
    def test_seeded_login_flag(self):
        r = login("kellner1", "Kellner123!")
        assert r.status_code == 200
        assert r.json()["user"]["must_change_password"] is True

    def test_status_owner(self, tokens):
        r = requests.get(f"{API}/security/status", headers=hdr(tokens["owner"]))
        assert r.status_code == 200
        names = {u["username"] for u in r.json()["default_password_users"]}
        assert {"kellner1", "kellner2", "kueche"} <= names  # inhaber may be cleared after UI tests
        assert "alf12345678" not in names
        assert all("_id" not in u and "password_hash" not in u for u in r.json()["default_password_users"])

    def test_status_forbidden_non_owner(self, tokens):
        assert requests.get(f"{API}/security/status", headers=hdr(tokens["waiter"])).status_code == 403
        assert requests.get(f"{API}/security/status", headers=hdr(tokens["kitchen"])).status_code == 403
        assert requests.get(f"{API}/security/status").status_code == 401

    def test_new_staff_not_flagged(self, tokens, test_user):
        r = login(test_user, "TestPass123")
        assert r.status_code == 200 and r.json()["user"]["must_change_password"] is False
        st = requests.get(f"{API}/security/status", headers=hdr(tokens["owner"])).json()
        assert test_user not in {u["username"] for u in st["default_password_users"]}


# --- change-password ---
class TestChangePassword:
    def test_flow(self, tokens, test_user):
        old_tok = login(test_user, "TestPass123").json()["access_token"]
        r = requests.post(f"{API}/auth/change-password", headers=hdr(old_tok),
                          json={"current_password": "WRONGpass1", "new_password": "NewPass12345"})
        assert r.status_code == 400, r.text
        r = requests.post(f"{API}/auth/change-password", headers=hdr(old_tok),
                          json={"current_password": "TestPass123", "new_password": "short"})
        assert r.status_code == 422, r.text
        r = requests.post(f"{API}/auth/change-password", headers=hdr(old_tok),
                          json={"current_password": "TestPass123", "new_password": "TestPass123"})
        assert r.status_code == 422, r.text
        r = requests.post(f"{API}/auth/change-password", headers=hdr(old_tok),
                          json={"current_password": "TestPass123", "new_password": "NewPass12345"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["access_token"] and body["user"]["username"] == test_user
        assert body["user"]["must_change_password"] is False
        new_tok = body["access_token"]
        # old token revoked, new works
        assert requests.get(f"{API}/auth/me", headers=hdr(old_tok)).status_code == 401
        assert requests.get(f"{API}/auth/me", headers=hdr(new_tok)).status_code == 200
        # login old pw fails, new pw ok
        assert login(test_user, "TestPass123").status_code == 401
        assert login(test_user, "NewPass12345").status_code == 200

    def test_unauth(self):
        r = requests.post(f"{API}/auth/change-password", json={"current_password": "x", "new_password": "yyyyyyyyy"})
        assert r.status_code == 401

    def test_owner_reset_revokes(self, tokens, test_user):
        tok = login(test_user, "NewPass12345").json()["access_token"]
        r = requests.patch(f"{API}/staff/{test_user}/password", headers=hdr(tokens["owner"]), json={"password": "Reset12345"})
        assert r.status_code == 200
        assert requests.get(f"{API}/auth/me", headers=hdr(tok)).status_code == 401
        assert login(test_user, "Reset12345").status_code == 200


# --- settings ---
class TestSettings:
    def test_get_any_role(self, tokens, original_settings):
        for role in ("owner", "waiter", "kitchen"):
            r = requests.get(f"{API}/settings", headers=hdr(tokens[role]))
            assert r.status_code == 200
            assert set(r.json().keys()) == {"restaurant_name", "address", "review_url"}
        assert requests.get(f"{API}/settings").status_code == 401

    def test_put_forbidden(self, tokens, original_settings):
        payload = {"restaurant_name": "TEST_X", "address": "", "review_url": ""}
        assert requests.put(f"{API}/settings", headers=hdr(tokens["waiter"]), json=payload).status_code == 403
        assert requests.put(f"{API}/settings", headers=hdr(tokens["kitchen"]), json=payload).status_code == 403

    @pytest.mark.parametrize("url", ["http://g.page/r/abc", "g.page/r/abc", "https://", "javascript:alert(1)", "https://a b"])
    def test_put_invalid_url(self, tokens, original_settings, url):
        r = requests.put(f"{API}/settings", headers=hdr(tokens["owner"]),
                         json={"restaurant_name": "TEST_Pizz", "address": "", "review_url": url})
        assert r.status_code == 422, r.text

    def test_put_empty_name(self, tokens, original_settings):
        r = requests.put(f"{API}/settings", headers=hdr(tokens["owner"]),
                         json={"restaurant_name": "  ", "address": "", "review_url": ""})
        assert r.status_code == 422

    def test_put_and_get(self, tokens, original_settings):
        payload = {"restaurant_name": " TEST_Pizzeria ", "address": "Hauptstr. 1, Berlin",
                   "review_url": "https://g.page/r/TESTreview/review"}
        r = requests.put(f"{API}/settings", headers=hdr(tokens["owner"]), json=payload)
        assert r.status_code == 200, r.text
        assert r.json()["restaurant_name"] == "TEST_Pizzeria"
        g = requests.get(f"{API}/settings", headers=hdr(tokens["waiter"])).json()
        assert g == {"restaurant_name": "TEST_Pizzeria", "address": "Hauptstr. 1, Berlin",
                     "review_url": "https://g.page/r/TESTreview/review"}
        # empty review_url allowed
        r = requests.put(f"{API}/settings", headers=hdr(tokens["owner"]),
                         json={"restaurant_name": "Pizzaiolo", "address": "", "review_url": ""})
        assert r.status_code == 200


# --- regression: legacy user docs without password_version (seeded accounts) must be able to change password ---
class TestLegacyDocChangePassword:
    def test_change_without_version_field(self, tokens):
        from dotenv import load_dotenv
        from pymongo import MongoClient
        load_dotenv("/app/backend/.env")
        coll = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]].users
        uname = f"test_l{uuid.uuid4().hex[:8]}"
        r = requests.post(f"{API}/staff", headers=hdr(tokens["owner"]),
                          json={"username": uname, "display_name": "TEST_Legacy", "role": "kitchen", "password": "Legacy12345"})
        assert r.status_code == 201
        try:
            coll.update_one({"username": uname}, {"$unset": {"password_version": ""}})
            tok = login(uname, "Legacy12345").json()["access_token"]
            r = requests.post(f"{API}/auth/change-password", headers=hdr(tok),
                              json={"current_password": "Legacy12345", "new_password": "Legacy67890"})
            assert r.status_code == 200, r.text
            assert requests.get(f"{API}/auth/me", headers=hdr(tok)).status_code == 401
        finally:
            requests.delete(f"{API}/staff/{uname}", headers=hdr(tokens["owner"]))
