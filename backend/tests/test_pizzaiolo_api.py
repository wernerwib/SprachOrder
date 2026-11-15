# Pizzaiolo restaurant API regression tests (auth, menu, tables, orders, status flow, voice notes)
import io
import math
import os
import struct
import wave

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"


def login(u, p):
    r = requests.post(f"{API}/auth/login", json={"username": u, "password": p}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def H(t):
    return {"Authorization": f"Bearer {t}"}


def sine_wav(seconds=1.5):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
        frames = b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * 440 * i / 16000)))
                          for i in range(int(16000 * seconds)))
        w.writeframes(frames)
    return buf.getvalue()


@pytest.fixture(scope="module")
def waiter():
    return login("kellner1", "Kellner123!")


@pytest.fixture(scope="module")
def kitchen():
    return login("kueche", "Kueche123!")


# --- Auth ---
class TestAuth:
    def test_login_all_users(self):
        for u, p, role in [("kellner1", "Kellner123!", "waiter"), ("kellner2", "Kellner123!", "waiter"),
                           ("kueche", "Kueche123!", "kitchen")]:
            r = requests.post(f"{API}/auth/login", json={"username": u, "password": p})
            assert r.status_code == 200
            d = r.json()
            assert d["user"]["role"] == role and d["user"]["username"] == u and d["access_token"]

    def test_wrong_password(self):
        r = requests.post(f"{API}/auth/login", json={"username": "kellner1", "password": "x"})
        assert r.status_code == 401

    def test_me(self, waiter):
        r = requests.get(f"{API}/auth/me", headers=H(waiter))
        assert r.status_code == 200 and r.json()["username"] == "kellner1"

    def test_me_no_token(self):
        assert requests.get(f"{API}/auth/me").status_code == 401


# --- Menu & tables ---
class TestMenuTables:
    def test_menu(self, waiter):
        r = requests.get(f"{API}/menu", headers=H(waiter))
        assert r.status_code == 200
        m = r.json()
        # menu is owner-editable (prices may change): only check the seeded items exist with a valid price
        seeded = {i["id"]: i for i in m if i["id"] <= 3}
        assert set(seeded) == {1, 2, 3}
        assert all(i["price"] > 0 and i["name"] for i in seeded.values())

    def test_tables_waiter(self, waiter):
        r = requests.get(f"{API}/tables", headers=H(waiter))
        assert r.status_code == 200
        t = r.json()
        assert len(t) == 10 and [x["table"] for x in t] == list(range(1, 11))

    def test_tables_kitchen_forbidden(self, kitchen):
        assert requests.get(f"{API}/tables", headers=H(kitchen)).status_code == 403


# --- Orders + status flow ---
class TestOrders:
    def test_create_and_flow(self, waiter, kitchen):
        r = requests.post(f"{API}/orders", headers=H(waiter), json={"table": 7, "items": [
            {"menu_id": 1, "note_text": "TEST_ ohne Basilikum"}, {"menu_id": 3}]})
        assert r.status_code == 200, r.text
        o = r.json()
        assert o["total"] == 27.0 and o["status"] == "new" and o["table"] == 7 and "_id" not in o
        oid = o["id"]
        # GET by table
        lst = requests.get(f"{API}/orders?table=7", headers=H(waiter)).json()
        assert any(x["id"] == oid for x in lst)
        # GET active (kitchen)
        lst = requests.get(f"{API}/orders", headers=H(kitchen)).json()
        assert any(x["id"] == oid for x in lst)
        # tables reflect
        t7 = requests.get(f"{API}/tables", headers=H(waiter)).json()[6]
        assert t7["status"] in ("new", "preparing", "ready") and t7["open_orders"] >= 1
        # illegal: waiter new->preparing
        assert requests.patch(f"{API}/orders/{oid}/status", headers=H(waiter), json={"status": "preparing"}).status_code == 400
        # illegal: kitchen new->ready
        assert requests.patch(f"{API}/orders/{oid}/status", headers=H(kitchen), json={"status": "ready"}).status_code == 400
        r = requests.patch(f"{API}/orders/{oid}/status", headers=H(kitchen), json={"status": "preparing"})
        assert r.status_code == 200 and r.json()["status"] == "preparing"
        r = requests.patch(f"{API}/orders/{oid}/status", headers=H(kitchen), json={"status": "ready"})
        assert r.status_code == 200 and r.json()["status"] == "ready"
        # kitchen cannot serve
        assert requests.patch(f"{API}/orders/{oid}/status", headers=H(kitchen), json={"status": "served"}).status_code == 400
        r = requests.patch(f"{API}/orders/{oid}/status", headers=H(waiter), json={"status": "served"})
        assert r.status_code == 200 and r.json()["status"] == "served"
        lst = requests.get(f"{API}/orders?table=7", headers=H(waiter)).json()
        assert not any(x["id"] == oid for x in lst)
        lst = requests.get(f"{API}/orders?table=7&active=false", headers=H(waiter)).json()
        assert any(x["id"] == oid and x["status"] == "served" for x in lst)
        # cleanup: close table 7 so it doesn't stay in 'billing'
        requests.post(f"{API}/tables/7/close", headers=H(waiter))

    def test_kitchen_cannot_create(self, kitchen):
        r = requests.post(f"{API}/orders", headers=H(kitchen), json={"table": 1, "items": [{"menu_id": 1}]})
        assert r.status_code == 403

    def test_invalid_inputs(self, waiter):
        assert requests.post(f"{API}/orders", headers=H(waiter), json={"table": 11, "items": [{"menu_id": 1}]}).status_code == 422
        assert requests.post(f"{API}/orders", headers=H(waiter), json={"table": 1, "items": []}).status_code == 422
        assert requests.post(f"{API}/orders", headers=H(waiter), json={"table": 1, "items": [{"menu_id": 9}]}).status_code == 400
        assert requests.post(f"{API}/orders", headers=H(waiter), json={"table": 1, "items": [{"menu_id": 1, "voice_note_id": "nope"}]}).status_code == 400

    def test_patch_unknown(self, kitchen):
        assert requests.patch(f"{API}/orders/nope/status", headers=H(kitchen), json={"status": "preparing"}).status_code == 404


# --- Voice notes ---
class TestVoice:
    def test_small_rejected(self, waiter):
        r = requests.post(f"{API}/voice-notes", headers=H(waiter), files={"audio": ("a.wav", b"x" * 200, "audio/wav")})
        assert r.status_code == 400 and "kein Ton" in r.json()["detail"]

    def test_kitchen_cannot_upload(self, kitchen):
        r = requests.post(f"{API}/voice-notes", headers=H(kitchen), files={"audio": ("a.wav", sine_wav(), "audio/wav")})
        assert r.status_code == 403

    def test_upload_and_fetch(self, waiter, kitchen):
        data = sine_wav()
        r = requests.post(f"{API}/voice-notes", headers=H(waiter), files={"audio": ("TEST_a.wav", data, "audio/wav")}, timeout=90)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["id"] and isinstance(d["transcript"], str)
        print("sine transcript:", repr(d["transcript"]))
        nid = d["id"]
        r = requests.get(f"{API}/voice-notes/{nid}/audio", params={"token": kitchen}, timeout=60)
        assert r.status_code == 200 and r.content == data and "audio/wav" in r.headers["content-type"]
        r = requests.get(f"{API}/voice-notes/{nid}/audio", headers=H(kitchen), timeout=60)
        assert r.status_code == 200 and len(r.content) == len(data)
        assert requests.get(f"{API}/voice-notes/{nid}/audio").status_code == 401
        assert requests.get(f"{API}/voice-notes/nope/audio", params={"token": kitchen}).status_code == 404
        # order with voice note for table 9 (left active for kitchen UI test)
        r = requests.post(f"{API}/orders", headers=H(waiter), json={"table": 9, "items": [
            {"menu_id": 2, "note_text": "TEST_ extra Pilze", "voice_note_id": nid}]})
        assert r.status_code == 200 and r.json()["items"][0]["voice_note_id"] == nid
        oid = r.json()["id"]
        # cleanup: serve + close table 9
        for st, tok in (("preparing", kitchen), ("ready", kitchen), ("served", waiter)):
            requests.patch(f"{API}/orders/{oid}/status", headers=H(tok), json={"status": st})
        requests.post(f"{API}/tables/9/close", headers=H(waiter))

    def test_sine_transcript_empty(self, waiter):
        r = requests.post(f"{API}/voice-notes", headers=H(waiter), files={"audio": ("TEST_b.wav", sine_wav(), "audio/wav")}, timeout=90)
        assert r.status_code == 200
        assert r.json()["transcript"] == "", f"non-speech returned transcript {r.json()['transcript']!r}"
