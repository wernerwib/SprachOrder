# Iteration 5: helper for the restart persistence check (phase=before|after)
import os
import sys

import requests

API = os.environ.get("EXPO_PUBLIC_BACKEND_URL").rstrip("/") + "/api"
U, PW, PW2 = "test_restart5", "Restart1234", "Changed9876"


def login(u, p):
    return requests.post(f"{API}/auth/login", json={"username": u, "password": p}, timeout=20)


owner = login("inhaber", "Inhaber123!").json()["access_token"]
H = {"Authorization": f"Bearer {owner}"}
if sys.argv[1] == "before":
    r = requests.post(f"{API}/staff", headers=H, json={"username": U, "display_name": "TEST Restart", "role": "waiter", "password": PW}, timeout=20)
    print("create", r.status_code)
    r = requests.patch(f"{API}/staff/{U}/password", headers=H, json={"password": PW2}, timeout=20)
    print("pw change", r.status_code)
else:
    print("old pw after restart (expect 401):", login(U, PW).status_code)
    print("new pw after restart (expect 200):", login(U, PW2).status_code)
    for u, p in [("kellner1", "Kellner123!"), ("kellner2", "Kellner123!"), ("kueche", "Kueche123!"), ("inhaber", "Inhaber123!")]:
        print(u, login(u, p).status_code)
    print("delete", requests.delete(f"{API}/staff/{U}", headers=H, timeout=20).status_code)
