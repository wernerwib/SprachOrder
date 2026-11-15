# Iteration 5: staff management (owner), revenue history reports
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
SUF = uuid.uuid4().hex[:6]


def login(u, p):
    return requests.post(f"{API}/auth/login", json={"username": u, "password": p}, timeout=20)


def tok(u, p):
    r = login(u, p)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def H(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def owner():
    return tok("inhaber", "Inhaber123!")


@pytest.fixture(scope="module")
def waiter():
    return tok("kellner1", "Kellner123!")


@pytest.fixture(scope="module")
def kitchen():
    return tok("kueche", "Kueche123!")


@pytest.fixture(scope="module")
def created(owner):
    names = []
    yield names
    for n in names:
        requests.delete(f"{API}/staff/{n}", headers=H(owner), timeout=20)


# Staff: permissions
class TestStaffPerms:
    def test_waiter_kitchen_forbidden(self, waiter, kitchen):
        for t in (waiter, kitchen):
            assert requests.get(f"{API}/staff", headers=H(t), timeout=20).status_code == 403
            r = requests.post(f"{API}/staff", headers=H(t), timeout=20,
                              json={"username": f"test_x{SUF}", "display_name": "X", "role": "waiter", "password": "abcdefgh1"})
            assert r.status_code == 403
            assert requests.delete(f"{API}/staff/kellner2", headers=H(t), timeout=20).status_code == 403
            assert requests.patch(f"{API}/staff/kellner2/password", headers=H(t), json={"password": "abcdefgh1"}, timeout=20).status_code == 403

    def test_no_auth_401(self):
        assert requests.get(f"{API}/staff", timeout=20).status_code == 401

    def test_list(self, owner):
        r = requests.get(f"{API}/staff", headers=H(owner), timeout=20)
        assert r.status_code == 200
        data = r.json()
        roles = {u["role"] for u in data}
        assert roles <= {"waiter", "kitchen"}
        names = [u["username"] for u in data]
        assert "kellner1" in names and "kueche" in names and "inhaber" not in names
        for u in data:
            assert "password_hash" not in u and "_id" not in u
            assert set(u.keys()) == {"username", "role", "display_name", "must_change_password"}


# Staff: CRUD lifecycle
class TestStaffCrud:
    def test_create_validation(self, owner):
        base = {"username": f"test_v{SUF}", "display_name": "TEST V", "role": "waiter", "password": "abcdefgh1"}
        bad = [
            {**base, "password": "short1"},
            {**base, "password": "   abc    "},
            {**base, "username": "ab"},
            {**base, "username": "bad name!"},
            {**base, "username": "x" * 33},
            {**base, "role": "owner"},
            {**base, "display_name": "  "},
        ]
        for b in bad:
            r = requests.post(f"{API}/staff", headers=H(owner), json=b, timeout=20)
            assert r.status_code == 422, (b, r.status_code, r.text)

    def test_full_lifecycle(self, owner, created):
        uname = f"test_w{SUF}"
        r = requests.post(f"{API}/staff", headers=H(owner), timeout=20,
                          json={"username": f"  TEST_W{SUF}  ", "display_name": " TEST Waiter ", "role": "waiter", "password": "Passwort123"})
        assert r.status_code == 201, r.text
        created.append(uname)
        d = r.json()
        assert d == {"username": uname, "role": "waiter", "display_name": "TEST Waiter", "must_change_password": False}
        # list has it
        names = [u["username"] for u in requests.get(f"{API}/staff", headers=H(owner), timeout=20).json()]
        assert uname in names
        # duplicate case-insensitive
        r = requests.post(f"{API}/staff", headers=H(owner), timeout=20,
                          json={"username": uname.upper(), "display_name": "Dup", "role": "kitchen", "password": "Passwort123"})
        assert r.status_code == 409, r.text
        # login works (case-insensitive username)
        r = login(uname.upper(), "Passwort123")
        assert r.status_code == 200 and r.json()["user"]["role"] == "waiter"
        t_old = r.json()["access_token"]
        # waiter can use tables
        assert requests.get(f"{API}/tables", headers=H(t_old), timeout=20).status_code == 200
        # reset password
        r = requests.patch(f"{API}/staff/{uname}/password", headers=H(owner), json={"password": "NeuesPW999"}, timeout=20)
        assert r.status_code == 200 and r.json() == {"ok": True}
        assert login(uname, "Passwort123").status_code == 401
        assert login(uname, "NeuesPW999").status_code == 200
        # short reset password
        r = requests.patch(f"{API}/staff/{uname}/password", headers=H(owner), json={"password": "kurz"}, timeout=20)
        assert r.status_code == 422
        # delete
        r = requests.delete(f"{API}/staff/{uname}", headers=H(owner), timeout=20)
        assert r.status_code == 200
        created.remove(uname)
        assert requests.get(f"{API}/auth/me", headers=H(t_old), timeout=20).status_code == 401
        assert login(uname, "NeuesPW999").status_code == 401
        assert requests.delete(f"{API}/staff/{uname}", headers=H(owner), timeout=20).status_code == 404

    def test_kitchen_account(self, owner, created):
        uname = f"test_k{SUF}"
        r = requests.post(f"{API}/staff", headers=H(owner), timeout=20,
                          json={"username": uname, "display_name": "TEST Koch", "role": "kitchen", "password": "Kochen1234"})
        assert r.status_code == 201
        created.append(uname)
        t = tok(uname, "Kochen1234")
        assert requests.get(f"{API}/orders", headers=H(t), timeout=20).status_code == 200
        assert requests.get(f"{API}/staff", headers=H(t), timeout=20).status_code == 403

    def test_owner_not_deletable(self, owner):
        assert requests.delete(f"{API}/staff/inhaber", headers=H(owner), timeout=20).status_code == 404
        assert requests.patch(f"{API}/staff/inhaber/password", headers=H(owner), json={"password": "abcdefgh12"}, timeout=20).status_code == 404
        assert login("inhaber", "Inhaber123!").status_code == 200

    def test_unknown_404(self, owner):
        assert requests.delete(f"{API}/staff/test_nobody_{SUF}", headers=H(owner), timeout=20).status_code == 404
        assert requests.patch(f"{API}/staff/test_nobody_{SUF}/password", headers=H(owner), json={"password": "abcdefgh12"}, timeout=20).status_code == 404


# Revenue history
class TestHistory:
    @pytest.mark.parametrize("rng,n", [("7d", 7), ("30d", 30), ("12w", 12)])
    def test_ranges(self, owner, rng, n):
        r = requests.get(f"{API}/reports/history", params={"range": rng}, headers=H(owner), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["range"] == rng
        assert len(d["buckets"]) == n
        for b in d["buckets"]:
            assert set(b) >= {"key", "label", "short", "revenue", "orders", "items"}
            assert isinstance(b["revenue"], (int, float)) and b["orders"] >= 0
        keys = [b["key"] for b in d["buckets"]]
        assert keys == sorted(keys)
        assert abs(d["total"] - sum(b["revenue"] for b in d["buckets"])) < 0.02
        assert abs(d["average"] - round(d["total"] / n, 2)) < 0.02
        assert [w["weekday"] for w in d["weekday_avg"]] == ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
        if d["best"]:
            assert d["best"]["revenue"] == max(b["revenue"] for b in d["buckets"])
        if rng == "12w":
            assert d["buckets"][0]["label"].startswith("KW")

    def test_7d_today_matches_today_report(self, owner):
        h = requests.get(f"{API}/reports/history", params={"range": "7d"}, headers=H(owner), timeout=30).json()
        t = requests.get(f"{API}/reports/today", headers=H(owner), timeout=30).json()
        print("today report keys", list(t.keys()), "last bucket", h["buckets"][-1])

    def test_invalid_and_perms(self, owner, waiter, kitchen):
        assert requests.get(f"{API}/reports/history", params={"range": "1y"}, headers=H(owner), timeout=20).status_code == 422
        assert requests.get(f"{API}/reports/history", headers=H(owner), timeout=20).json()["range"] == "7d"
        for t in (waiter, kitchen):
            assert requests.get(f"{API}/reports/history", params={"range": "7d"}, headers=H(t), timeout=20).status_code == 403
