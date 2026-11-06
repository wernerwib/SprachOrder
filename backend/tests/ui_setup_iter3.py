# helper for UI test: creates a served order on a free table, prints "A B FREE"
import os, requests, sys
API = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"
def tok(u, p): return requests.post(f"{API}/auth/login", json={"username": u, "password": p}).json()["access_token"]
w, k = tok("kellner1", "Kellner123!"), tok("kueche", "Kueche123!")
H = lambda t: {"Authorization": f"Bearer {t}"}
free = [t["table"] for t in requests.get(f"{API}/tables", headers=H(w)).json() if t["status"] == "free"]
a, b, c = free[0], free[1], free[2]
o = requests.post(f"{API}/orders", headers=H(w), json={"table": a, "items": [{"menu_id": 1, "qty": 2}, {"menu_id": 2, "qty": 1, "note_text": "TEST_ui"}]}).json()
if "served" in sys.argv:
    for t, s in ((k, "preparing"), (k, "ready"), (w, "served")):
        requests.patch(f"{API}/orders/{o['id']}/status", headers=H(t), json={"status": s})
print(a, b, c)
