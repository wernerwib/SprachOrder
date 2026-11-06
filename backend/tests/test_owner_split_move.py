# Iteration 3: owner menu management, split bill (partial pay), move table
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"


def login(u, p):
    r = requests.post(f"{API}/auth/login", json={"username": u, "password": p}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def tokens():
    return {
        "waiter": login("kellner1", "Kellner123!")["access_token"],
        "kitchen": login("kueche", "Kueche123!")["access_token"],
        "owner": login("inhaber", "Inhaber123!")["access_token"],
    }


def free_tables(tokens, n, offset=0):
    # offset keeps xdist workers (one per class) on disjoint tables
    r = requests.get(f"{API}/tables", headers=H(tokens["waiter"]), timeout=20)
    free = [t["table"] for t in r.json() if t["status"] == "free"]
    if len(free) < n + offset:
        pytest.skip("not enough free tables")
    return free[offset:offset + n]


def order(tokens, table, items):
    r = requests.post(f"{API}/orders", headers=H(tokens["waiter"]), json={"table": table, "items": items}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


def serve(tokens, oid):
    for role, st in (("kitchen", "preparing"), ("kitchen", "ready"), ("waiter", "served")):
        r = requests.patch(f"{API}/orders/{oid}/status", headers=H(tokens[role]), json={"status": st}, timeout=20)
        assert r.status_code == 200, r.text


def bill(tokens, t):
    r = requests.get(f"{API}/tables/{t}/bill", headers=H(tokens["waiter"]), timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


def table_status(tokens, t):
    r = requests.get(f"{API}/tables", headers=H(tokens["waiter"]), timeout=20)
    return next(x for x in r.json() if x["table"] == t)["status"]


# ---- Auth: owner ----
def test_owner_login(tokens):
    d = login("inhaber", "Inhaber123!")
    assert d["user"]["role"] == "owner"


# ---- Menu management ----
class TestMenu:
    def test_menu_any_role_has_available(self, tokens):
        for role in ("waiter", "kitchen", "owner"):
            r = requests.get(f"{API}/menu", headers=H(tokens[role]), timeout=20)
            assert r.status_code == 200
            items = r.json()
            assert len(items) >= 3 and all("available" in i for i in items) and "_id" not in items[0]

    def test_create_forbidden_non_owner(self, tokens):
        for role in ("waiter", "kitchen"):
            r = requests.post(f"{API}/menu", headers=H(tokens[role]), json={"name": "TEST_x", "price": 5}, timeout=20)
            assert r.status_code == 403
            r = requests.patch(f"{API}/menu/1", headers=H(tokens[role]), json={"available": True}, timeout=20)
            assert r.status_code == 403

    def test_create_validation(self, tokens):
        for body in ({"name": "", "price": 5}, {"name": "TEST_x", "price": 0}, {"name": "TEST_x", "price": -1}):
            r = requests.post(f"{API}/menu", headers=H(tokens["owner"]), json=body, timeout=20)
            assert r.status_code == 422, body

    def test_create_whitespace_name_rejected(self, tokens):
        r = requests.post(f"{API}/menu", headers=H(tokens["owner"]), json={"name": "   ", "price": 5}, timeout=20)
        if r.status_code == 200:  # cleanup created junk then fail
            requests.patch(f"{API}/menu/{r.json()['id']}", headers=H(tokens["owner"]),
                           json={"name": "TEST_whitespace", "available": False}, timeout=20)
        assert r.status_code in (400, 422), f"whitespace-only name accepted: {r.text}"

    def test_patch_unknown_404(self, tokens):
        r = requests.patch(f"{API}/menu/999999", headers=H(tokens["owner"]), json={"available": True}, timeout=20)
        assert r.status_code == 404

    def test_dish_lifecycle(self, tokens):
        name = f"TEST_Dish_{uuid.uuid4().hex[:5]}"
        r = requests.post(f"{API}/menu", headers=H(tokens["owner"]), json={"name": name, "price": 7.5}, timeout=20)
        assert r.status_code == 200, r.text
        dish = r.json()
        assert dish["name"] == name and dish["price"] == 7.5 and dish["available"] is True
        did = dish["id"]
        try:
            menu = requests.get(f"{API}/menu", headers=H(tokens["waiter"]), timeout=20).json()
            assert any(m["id"] == did for m in menu)
            # edit
            r = requests.patch(f"{API}/menu/{did}", headers=H(tokens["owner"]), json={"name": name + "b", "price": 8.25}, timeout=20)
            assert r.status_code == 200 and r.json()["price"] == 8.25
            # waiter can order it
            t = free_tables(tokens, 1, offset=2)[0]
            o = order(tokens, t, [{"menu_id": did, "qty": 2}])
            assert o["total"] == 16.5 and o["items"][0]["name"] == name + "b"
            # hide -> order 400
            r = requests.patch(f"{API}/menu/{did}", headers=H(tokens["owner"]), json={"available": False}, timeout=20)
            assert r.status_code == 200 and r.json()["available"] is False
            r = requests.post(f"{API}/orders", headers=H(tokens["waiter"]), json={"table": t, "items": [{"menu_id": did}]}, timeout=20)
            assert r.status_code == 400
            # settle the table
            serve(tokens, o["id"])
            r = requests.post(f"{API}/tables/{t}/close", headers=H(tokens["waiter"]), timeout=20)
            assert r.status_code == 200 and r.json()["closed"] is True
        finally:
            requests.patch(f"{API}/menu/{did}", headers=H(tokens["owner"]), json={"available": False}, timeout=20)


# ---- Split bill ----
class TestSplit:
    def test_partial_then_full_pay(self, tokens):
        t = free_tables(tokens, 1)[0]
        rep0 = requests.get(f"{API}/reports/today", headers=H(tokens["waiter"]), timeout=20).json()
        o1 = order(tokens, t, [{"menu_id": 1, "qty": 2}, {"menu_id": 2, "qty": 1}])
        # not served -> 400
        r = requests.post(f"{API}/tables/{t}/pay", headers=H(tokens["waiter"]), json={"lines": [{"menu_id": 1, "qty": 1}]}, timeout=20)
        assert r.status_code == 400
        serve(tokens, o1["id"])
        b = bill(tokens, t)
        l1 = next(l for l in b["lines"] if l["menu_id"] == 1)
        assert l1["qty"] == 2 and l1["paid_qty"] == 0 and l1["open_qty"] == 2
        assert b["paid_total"] == 0 and b["open_total"] == o1["total"]
        price1 = l1["price"]
        # pay 1x dish1
        r = requests.post(f"{API}/tables/{t}/pay", headers=H(tokens["waiter"]), json={"lines": [{"menu_id": 1, "qty": 1}]}, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["closed"] is False and r.json()["amount"] == price1
        b = bill(tokens, t)
        l1 = next(l for l in b["lines"] if l["menu_id"] == 1)
        assert l1["paid_qty"] == 1 and l1["open_qty"] == 1 and l1["open_amount"] == price1
        assert b["paid_total"] == price1 and b["open_total"] == round(o1["total"] - price1, 2)
        # report counts partial payment
        rep1 = requests.get(f"{API}/reports/today", headers=H(tokens["waiter"]), timeout=20).json()
        # >= because parallel test modules may also settle bills meanwhile
        assert round(rep1["revenue_paid"] - rep0["revenue_paid"], 2) >= price1
        # more than open -> 400 and nothing changed
        r = requests.post(f"{API}/tables/{t}/pay", headers=H(tokens["waiter"]), json={"lines": [{"menu_id": 1, "qty": 2}]}, timeout=20)
        assert r.status_code == 400
        assert bill(tokens, t)["paid_total"] == price1
        # dish not on table -> 400
        r = requests.post(f"{API}/tables/{t}/pay", headers=H(tokens["waiter"]), json={"lines": [{"menu_id": 3, "qty": 1}]}, timeout=20)
        assert r.status_code == 400
        # pay remaining -> closed
        r = requests.post(f"{API}/tables/{t}/pay", headers=H(tokens["waiter"]),
                          json={"lines": [{"menu_id": 1, "qty": 1}, {"menu_id": 2, "qty": 1}]}, timeout=20)
        assert r.status_code == 200 and r.json()["closed"] is True
        assert table_status(tokens, t) == "free"

    def test_partial_then_close_rest(self, tokens):
        t = free_tables(tokens, 1, offset=1)[0]
        o = order(tokens, t, [{"menu_id": 1, "qty": 3}])
        serve(tokens, o["id"])
        r = requests.post(f"{API}/tables/{t}/pay", headers=H(tokens["waiter"]), json={"lines": [{"menu_id": 1, "qty": 1}]}, timeout=20)
        assert r.status_code == 200
        price = o["items"][0]["price"]
        r = requests.post(f"{API}/tables/{t}/close", headers=H(tokens["waiter"]), timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["closed"] is True and r.json()["amount"] == round(price * 2, 2)
        assert table_status(tokens, t) == "free"
        assert bill(tokens, t)["lines"] == []

    def test_pay_kitchen_forbidden(self, tokens):
        r = requests.post(f"{API}/tables/1/pay", headers=H(tokens["kitchen"]), json={"lines": [{"menu_id": 1, "qty": 1}]}, timeout=20)
        assert r.status_code == 403


# ---- Move table ----
class TestMove:
    def test_move_validation(self, tokens):
        a, b = free_tables(tokens, 2, offset=4)
        r = requests.post(f"{API}/tables/{a}/move", headers=H(tokens["waiter"]), json={"to": a}, timeout=20)
        assert r.status_code == 400
        r = requests.post(f"{API}/tables/{a}/move", headers=H(tokens["waiter"]), json={"to": b}, timeout=20)
        assert r.status_code == 400  # nothing to move
        r = requests.post(f"{API}/tables/{a}/move", headers=H(tokens["kitchen"]), json={"to": b}, timeout=20)
        assert r.status_code == 403
        r = requests.post(f"{API}/tables/{a}/move", headers=H(tokens["waiter"]), json={"to": 99}, timeout=20)
        assert r.status_code == 422

    def test_move_flow(self, tokens):
        a, b = free_tables(tokens, 2, offset=4)
        o = order(tokens, a, [{"menu_id": 2, "qty": 1, "note_text": "TEST_move"}])
        r = requests.post(f"{API}/tables/{a}/move", headers=H(tokens["waiter"]), json={"to": b}, timeout=20)
        assert r.status_code == 200 and r.json()["moved"] == 1 and r.json()["to"] == b
        assert table_status(tokens, a) == "free"
        assert table_status(tokens, b) == "new"
        kt = requests.get(f"{API}/orders", headers=H(tokens["kitchen"]), timeout=20).json()
        assert next(x for x in kt if x["id"] == o["id"])["table"] == b
        serve(tokens, o["id"])
        r = requests.post(f"{API}/tables/{b}/close", headers=H(tokens["waiter"]), timeout=20)
        assert r.status_code == 200 and r.json()["closed"] is True
