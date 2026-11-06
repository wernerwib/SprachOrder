# Iteration 2: qty per dish, text notes, table bill/close, daily report
import os

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


@pytest.fixture(scope="module")
def waiter():
    return login("kellner1", "Kellner123!")


@pytest.fixture(scope="module")
def waiter2():
    return login("kellner2", "Kellner123!")


@pytest.fixture(scope="module")
def kitchen():
    return login("kueche", "Kueche123!")


@pytest.fixture(scope="module")
def free_table(waiter):
    r = requests.get(f"{API}/tables", headers=H(waiter), timeout=20)
    free = [t["table"] for t in r.json() if t["status"] == "free"]
    if not free:
        pytest.skip("no free table")
    return free[-1]


def serve(order_id, waiter, kitchen):
    for st, tok in (("preparing", kitchen), ("ready", kitchen), ("served", waiter)):
        r = requests.patch(f"{API}/orders/{order_id}/status", json={"status": st}, headers=H(tok), timeout=20)
        assert r.status_code == 200, r.text


# qty + text note on order creation
class TestQty:
    def test_qty_bounds(self, waiter, free_table):
        for q in (0, 51, -1):
            r = requests.post(f"{API}/orders", json={"table": free_table, "items": [{"menu_id": 1, "qty": q}]},
                              headers=H(waiter), timeout=20)
            assert r.status_code == 422, (q, r.status_code)


# Full bill flow: create -> bill (not served) -> close 400 -> serve -> billing -> close -> free
class TestBillFlow:
    def test_flow(self, waiter, waiter2, kitchen, free_table):
        t = free_table
        # nothing open -> 400
        r = requests.post(f"{API}/tables/{t}/close", headers=H(waiter), timeout=20)
        assert r.status_code == 400
        r = requests.post(f"{API}/orders", json={"table": t, "items": [
            {"menu_id": 1, "qty": 2, "note_text": "  TEST_ohne Zwiebeln  "},
            {"menu_id": 3},
        ]}, headers=H(waiter), timeout=20)
        assert r.status_code == 200, r.text
        o1 = r.json()
        assert o1["total"] == 39.0
        assert o1["items"][0]["qty"] == 2 and o1["items"][1]["qty"] == 1
        assert o1["items"][0]["note_text"] == "TEST_ohne Zwiebeln"
        assert o1["items"][0]["voice_note_id"] is None
        r = requests.post(f"{API}/orders", json={"table": t, "items": [{"menu_id": 1, "qty": 3}]},
                          headers=H(waiter2), timeout=20)
        o2 = r.json()
        assert o2["total"] == 36.0
        # kitchen sees note
        r = requests.get(f"{API}/orders", headers=H(kitchen), timeout=20)
        k = [o for o in r.json() if o["id"] == o1["id"]][0]
        assert k["items"][0]["note_text"] == "TEST_ohne Zwiebeln"
        # bill aggregated
        b = requests.get(f"{API}/tables/{t}/bill", headers=H(waiter), timeout=20).json()
        lines = {l["menu_id"]: l for l in b["lines"]}
        assert lines[1]["qty"] == 5 and lines[1]["amount"] == 60.0
        assert lines[3]["qty"] == 1 and lines[3]["amount"] == 15.0
        assert b["total"] == 75.0 and b["orders"] == 2 and b["all_served"] is False
        # kitchen forbidden for bill + close
        assert requests.get(f"{API}/tables/{t}/bill", headers=H(kitchen), timeout=20).status_code == 403
        assert requests.post(f"{API}/tables/{t}/close", headers=H(kitchen), timeout=20).status_code == 403
        # not served -> 400
        assert requests.post(f"{API}/tables/{t}/close", headers=H(waiter), timeout=20).status_code == 400
        # report before close: open revenue includes these
        rep0 = requests.get(f"{API}/reports/today", headers=H(kitchen), timeout=20).json()
        serve(o1["id"], waiter, kitchen)
        tables = {x["table"]: x for x in requests.get(f"{API}/tables", headers=H(waiter), timeout=20).json()}
        assert tables[t]["status"] != "billing"  # o2 still new
        serve(o2["id"], waiter, kitchen)
        tables = {x["table"]: x for x in requests.get(f"{API}/tables", headers=H(waiter), timeout=20).json()}
        assert tables[t]["status"] == "billing" and tables[t]["total"] == 75.0
        b = requests.get(f"{API}/tables/{t}/bill", headers=H(waiter), timeout=20).json()
        assert b["all_served"] is True
        r = requests.post(f"{API}/tables/{t}/close", headers=H(waiter), timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["total"] == 75.0 and r.json()["orders"] == 2
        tables = {x["table"]: x for x in requests.get(f"{API}/tables", headers=H(waiter), timeout=20).json()}
        assert tables[t]["status"] == "free"
        b = requests.get(f"{API}/tables/{t}/bill", headers=H(waiter), timeout=20).json()
        assert b["lines"] == [] and b["total"] == 0
        # second close -> 400
        assert requests.post(f"{API}/tables/{t}/close", headers=H(waiter), timeout=20).status_code == 400
        # report after: paid increased by 75
        rep1 = requests.get(f"{API}/reports/today", headers=H(waiter), timeout=20).json()
        # >= because parallel tests may close other tables at the same time
        assert round(rep1["revenue_paid"] - rep0["revenue_paid"], 2) >= 75.0
        assert rep1["revenue_total"] >= rep0["revenue_total"]
        assert rep1["orders_count"] >= rep0["orders_count"]

    def test_bill_invalid_table(self, waiter):
        assert requests.get(f"{API}/tables/0/bill", headers=H(waiter), timeout=20).status_code == 404
        assert requests.get(f"{API}/tables/11/bill", headers=H(waiter), timeout=20).status_code == 404


# Daily report structure
class TestReport:
    def test_report_shape(self, waiter, kitchen):
        for tok in (waiter, kitchen):
            r = requests.get(f"{API}/reports/today", headers=H(tok), timeout=20)
            assert r.status_code == 200
            d = r.json()
            for k in ("date", "revenue_total", "revenue_paid", "revenue_open", "orders_count",
                      "items_count", "by_waiter", "top_dishes"):
                assert k in d
            # revenue_paid = payments made today; revenue_open = unpaid part of today's orders
            assert d["revenue_open"] >= 0 and d["revenue_paid"] >= 0
            assert d["revenue_open"] <= d["revenue_total"]
            qtys = [x["qty"] for x in d["top_dishes"]]
            assert qtys == sorted(qtys, reverse=True)
            assert sum(qtys) == d["items_count"]
            assert sum(w["orders"] for w in d["by_waiter"]) == d["orders_count"]

    def test_report_noauth(self):
        assert requests.get(f"{API}/reports/today", timeout=20).status_code in (401, 403)
