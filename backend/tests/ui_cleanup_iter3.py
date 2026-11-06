# cleanup helper: serve + close given tables (only tables created by this test run)
import os, sys, requests
API = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"
def tok(u, p): return requests.post(f"{API}/auth/login", json={"username": u, "password": p}).json()["access_token"]
w, k, o = tok("kellner1", "Kellner123!"), tok("kueche", "Kueche123!"), tok("inhaber", "Inhaber123!")
H = lambda t: {"Authorization": f"Bearer {t}"}
for table in map(int, sys.argv[1:]):
    for od in requests.get(f"{API}/orders", headers=H(w), params={"table": table}).json():
        for t, s in ((k, "preparing"), (k, "ready"), (w, "served")):
            requests.patch(f"{API}/orders/{od['id']}/status", headers=H(t), json={"status": s})
    print(table, requests.post(f"{API}/tables/{table}/close", headers=H(w)).json())
print([(m["id"], m["name"], m["available"]) for m in requests.get(f"{API}/menu", headers=H(o)).json()])
print([(t["table"], t["status"]) for t in requests.get(f"{API}/tables", headers=H(w)).json()])
