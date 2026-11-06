# Cleanup for iteration 9 UI test: finish + close the test order on table 7 only
import os
import requests

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"


def tok(u, p):
    r = requests.post(f"{BASE}/auth/login", json={"username": u, "password": p})
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


k = tok("kueche", "Kueche123!")
w = tok("kellner1", "Kellner123!")
orders = requests.get(f"{BASE}/orders", headers=k).json()
mine = [o for o in orders if o.get("table") == 7 and not o.get("paid")]
print("table 7 open orders:", [(o["id"], o["status"], [i.get("note_text") for i in o["items"]]) for o in mine])
for o in mine:
    for st, h in (("preparing", k), ("ready", k), ("served", w)):
        if o["status"] == "new" or (st != "preparing" and True):
            r = requests.patch(f"{BASE}/orders/{o['id']}/status", json={"status": st}, headers=h)
            print(o["id"], st, r.status_code)
r = requests.post(f"{BASE}/tables/7/close", headers=w)
print("close", r.status_code, r.text[:200])
t = requests.get(f"{BASE}/tables", headers=w).json()
print([x for x in t if x["table"] == 7])
