import asyncio
import logging
import os
import tempfile
import uuid
from contextlib import suppress
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
from typing import Annotated, List, Literal, Optional

import bcrypt
import jwt
import requests
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, BeforeValidator, Field
from pymongo import ASCENDING, DESCENDING, IndexModel
from pymongo.errors import DuplicateKeyError
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from emergentintegrations.llm.openai import OpenAISpeechToText  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]
JWT_SECRET = os.environ["JWT_SECRET"]
EMERGENT_KEY = os.environ["EMERGENT_LLM_KEY"]
JWT_HOURS = 24 * 7
TABLE_COUNT = 10

STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
APP_NAME = "pizzaiolo-sprachbestellung"
storage_key: Optional[str] = None

MENU = [
    {"id": 1, "name": "Pizza Margherita", "price": 12.0, "image": "pizza_margherita"},
    {"id": 2, "name": "Pizza Funghi", "price": 12.0, "image": "pizza_funghi"},
    {"id": 3, "name": "Pizza al Casa", "price": 15.0, "image": "pizza_al_casa"},
]

SEED_USERS = [
    ("kellner1", "Kellner123!", "waiter", "Kellner 1"),
    ("kellner2", "Kellner123!", "waiter", "Kellner 2"),
    ("kueche", "Kueche123!", "kitchen", "Küche"),
    ("inhaber", "Inhaber123!", "owner", "Inhaber"),
]

INDEXES: dict[str, list[IndexModel]] = {
    "users": [IndexModel([("username", ASCENDING)], name="username", unique=True)],
    "orders": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("status", ASCENDING), ("created_at", ASCENDING)], name="status_created"),
        IndexModel([("table", ASCENDING), ("status", ASCENDING)], name="table_status"),
        IndexModel([("table", ASCENDING), ("paid", ASCENDING)], name="table_paid"),
        IndexModel([("created_at", DESCENDING)], name="created_desc"),
    ],
    "voice_notes": [IndexModel([("id", ASCENDING)], name="id", unique=True)],
    "menu": [IndexModel([("id", ASCENDING)], name="id", unique=True)],
    "payments": [IndexModel([("created_at", DESCENDING)], name="created_desc")],
}


async def ensure_indexes() -> None:
    for collection, models in INDEXES.items():
        for model in models:
            try:
                await db[collection].create_indexes([model])
            except Exception as exc:
                logger.error("ensure_indexes(%s.%s): %s", collection, model.document["name"], exc)


# ---------- Models ----------
PyObjectId = Annotated[str, BeforeValidator(str)]


class BaseDocument(BaseModel):
    mongo_id: Optional[PyObjectId] = Field(default=None, alias="_id", exclude=True)

    model_config = {"populate_by_name": True}

    @classmethod
    def from_mongo(cls, doc: dict):
        return cls.model_validate(doc)

    def to_mongo(self) -> dict:
        return self.model_dump(exclude={"mongo_id"})


class UserDoc(BaseDocument):
    username: str
    password_hash: str
    role: Literal["waiter", "kitchen", "owner"]
    display_name: str
    must_change_password: bool = False
    password_version: int = 0


class PasswordChangeIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str


class SettingsIn(BaseModel):
    restaurant_name: Annotated[str, BeforeValidator(lambda v: v.strip() if isinstance(v, str) else v)] = Field(min_length=1, max_length=60)
    address: Annotated[str, BeforeValidator(lambda v: v.strip() if isinstance(v, str) else v)] = Field("", max_length=120)
    review_url: Annotated[str, BeforeValidator(lambda v: v.strip() if isinstance(v, str) else v)] = Field(
        "", max_length=300, pattern=r"^(https://\S+)?$"
    )


DEFAULT_SETTINGS = {"restaurant_name": "Pizzaiolo", "address": "", "review_url": ""}


class MenuItemDoc(BaseDocument):
    id: int
    name: str
    price: float
    image: Optional[str] = None
    available: bool = True


class MenuCreateIn(BaseModel):
    name: Annotated[str, BeforeValidator(lambda v: v.strip() if isinstance(v, str) else v)] = Field(min_length=1, max_length=60)
    price: float = Field(gt=0, le=999)


class MenuUpdateIn(BaseModel):
    name: Optional[Annotated[str, BeforeValidator(lambda v: v.strip() if isinstance(v, str) else v)]] = Field(None, min_length=1, max_length=60)
    price: Optional[float] = Field(None, gt=0, le=999)
    available: Optional[bool] = None


class PayLine(BaseModel):
    menu_id: int
    qty: int = Field(ge=1, le=500)


class PayIn(BaseModel):
    lines: List[PayLine] = Field(min_length=1)


class MoveIn(BaseModel):
    to: int = Field(ge=1, le=TABLE_COUNT)


def _pw_ok(v: str) -> str:
    v = v.strip()
    if len(v) < 8:
        raise ValueError("Passwort muss mindestens 8 Zeichen haben")
    if len(v.encode()) > 72:
        raise ValueError("Passwort ist zu lang")
    return v


StaffPassword = Annotated[str, BeforeValidator(lambda v: _pw_ok(v) if isinstance(v, str) else v)]


class StaffCreateIn(BaseModel):
    username: Annotated[str, BeforeValidator(lambda v: v.strip().lower() if isinstance(v, str) else v)] = Field(
        pattern=r"^[a-z0-9_.-]{3,32}$"
    )
    display_name: Annotated[str, BeforeValidator(lambda v: v.strip() if isinstance(v, str) else v)] = Field(min_length=1, max_length=40)
    role: Literal["waiter", "kitchen"]
    password: StaffPassword


class StaffPasswordIn(BaseModel):
    password: StaffPassword


class OrderItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    menu_id: int
    name: str
    price: float
    qty: int = 1
    paid_qty: int = 0
    note_text: Optional[str] = None
    voice_note_id: Optional[str] = None


OrderStatus = Literal["new", "preparing", "ready", "served"]


class OrderDoc(BaseDocument):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    table: int
    status: OrderStatus = "new"
    items: List[OrderItem]
    total: float
    waiter: str
    waiter_name: str
    paid: bool = False
    paid_at: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class VoiceNoteDoc(BaseDocument):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    storage_path: str
    content_type: str
    transcript: str
    owner: str
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class LoginIn(BaseModel):
    username: str
    password: str


class OrderItemIn(BaseModel):
    menu_id: int
    qty: int = Field(1, ge=1, le=50)
    note_text: Optional[str] = None
    voice_note_id: Optional[str] = None


class OrderIn(BaseModel):
    table: int = Field(ge=1, le=TABLE_COUNT)
    items: List[OrderItemIn] = Field(min_length=1)


class StatusIn(BaseModel):
    status: OrderStatus


# ---------- Auth ----------
bearer = HTTPBearer(auto_error=False)


def make_token(user: UserDoc) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=JWT_HOURS)
    return jwt.encode(
        {"sub": user.username, "role": user.role, "ver": user.password_version, "exp": exp}, JWT_SECRET, algorithm="HS256"
    )


async def user_from_token(token: Optional[str]) -> UserDoc:
    if not token:
        raise HTTPException(401, "Nicht angemeldet")
    try:
        data = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Sitzung abgelaufen")
    doc = await db.users.find_one({"username": data.get("sub")})
    if not doc:
        raise HTTPException(401, "Benutzer unbekannt")
    user = UserDoc.from_mongo(doc)
    # password changed since this token was issued -> token revoked
    if data.get("ver", 0) != user.password_version:
        raise HTTPException(401, "Passwort wurde geändert – bitte neu anmelden")
    return user


async def current_user(cred: Optional[HTTPAuthorizationCredentials] = Depends(bearer)) -> UserDoc:
    return await user_from_token(cred.credentials if cred else None)


def require_role(role: str):
    async def dep(user: UserDoc = Depends(current_user)) -> UserDoc:
        if user.role != role:
            raise HTTPException(403, "Keine Berechtigung")
        return user
    return dep


def public_user(u: UserDoc) -> dict:
    return {
        "username": u.username,
        "role": u.role,
        "display_name": u.display_name,
        "must_change_password": u.must_change_password,
    }


# ---------- Storage ----------
def init_storage() -> str:
    global storage_key
    if storage_key:
        return storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    storage_key = resp.json()["storage_key"]
    return storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    global storage_key
    for attempt in range(2):
        key = init_storage()
        resp = requests.put(f"{STORAGE_URL}/objects/{path}",
                            headers={"X-Storage-Key": key, "Content-Type": content_type}, data=data, timeout=120)
        if resp.status_code == 503 and attempt == 0:
            storage_key = None
            continue
        resp.raise_for_status()
        return resp.json()


def get_object(path: str) -> tuple[bytes, str]:
    key = init_storage()
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


stt = OpenAISpeechToText(api_key=EMERGENT_KEY)


async def transcribe_bytes(data: bytes, ext: str) -> str:
    with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=True) as tmp:
        tmp.write(data)
        tmp.flush()
        with open(tmp.name, "rb") as f:
            resp = await stt.transcribe(
                file=f,
                model="gpt-4o-mini-transcribe",
                response_format="json",
                language="de",
                temperature=0.0,
            )
    return (getattr(resp, "text", "") or "").strip()


# ---------- App ----------
app = FastAPI()


@app.get("/health", include_in_schema=False)
@app.head("/health", include_in_schema=False)
async def health():
    return {"status": "ok"}


api = APIRouter(prefix="/api")


@api.get("/")
async def root():
    return {"message": "Pizzaiolo API"}


@api.post("/auth/login")
async def login(body: LoginIn):
    doc = await db.users.find_one({"username": body.username.strip().lower()})
    if not doc or not bcrypt.checkpw(body.password.strip().encode(), doc["password_hash"].encode()):
        raise HTTPException(401, "Benutzername oder Passwort falsch")
    user = UserDoc.from_mongo(doc)
    return {"access_token": make_token(user), "token_type": "bearer", "user": public_user(user)}


class DemoLoginIn(BaseModel):
    role: Literal["waiter", "kitchen", "owner"]


@api.post("/auth/demo-login")
async def demo_login(body: DemoLoginIn):
    """Test login per role without password (disable via DEMO_LOGIN_ENABLED=false)."""
    if os.environ.get("DEMO_LOGIN_ENABLED", "true").lower() != "true":
        raise HTTPException(404, "Test-Anmeldung ist deaktiviert")
    seed = next(s for s in SEED_USERS if s[2] == body.role)
    doc = await db.users.find_one({"username": seed[0]}) or await db.users.find_one({"role": body.role})
    if not doc:
        hashed = await run_in_threadpool(lambda: bcrypt.hashpw(seed[1].encode(), bcrypt.gensalt()).decode())
        user = UserDoc(username=seed[0], password_hash=hashed, role=body.role, display_name=seed[3])
        await db.users.insert_one(user.to_mongo())
    else:
        user = UserDoc.from_mongo(doc)
    return {"access_token": make_token(user), "token_type": "bearer", "user": public_user(user)}


@api.get("/auth/me")
async def me(user: UserDoc = Depends(current_user)):
    return public_user(user)


@api.post("/auth/change-password")
async def change_password(body: PasswordChangeIn, user: UserDoc = Depends(current_user)):
    doc = await db.users.find_one({"username": user.username})
    ok = await run_in_threadpool(lambda: bcrypt.checkpw(body.current_password.strip().encode(), doc["password_hash"].encode()))
    if not ok:
        raise HTTPException(400, "Aktuelles Passwort ist falsch")
    try:
        new_pw = _pw_ok(body.new_password)
    except ValueError as e:
        raise HTTPException(422, str(e))
    if new_pw == body.current_password.strip():
        raise HTTPException(422, "Das neue Passwort muss sich vom alten unterscheiden")
    hashed = await run_in_threadpool(lambda: bcrypt.hashpw(new_pw.encode(), bcrypt.gensalt()).decode())
    res = await db.users.update_one(
        # legacy/seeded docs have no password_version field yet (treated as 0)
        {"username": user.username,
         "password_version": {"$in": [0, None]} if user.password_version == 0 else user.password_version},
        {"$set": {"password_hash": hashed, "must_change_password": False}, "$inc": {"password_version": 1}},
    )
    if res.modified_count != 1:
        raise HTTPException(409, "Passwort wurde gerade schon geändert – bitte neu anmelden")
    fresh = UserDoc.from_mongo(await db.users.find_one({"username": user.username}))
    return {"access_token": make_token(fresh), "token_type": "bearer", "user": public_user(fresh)}


@api.get("/security/status")
async def security_status(_: UserDoc = Depends(require_role("owner"))):
    docs = await db.users.find({"must_change_password": True}, {"_id": 0, "username": 1, "role": 1, "display_name": 1}).to_list(100)
    return {"default_password_users": docs}


@api.get("/settings")
async def get_settings(_: UserDoc = Depends(current_user)):
    doc = await db.meta.find_one({"_id": "settings"}) or {}
    return {k: doc.get(k, v) for k, v in DEFAULT_SETTINGS.items()}


@api.put("/settings")
async def put_settings(body: SettingsIn, _: UserDoc = Depends(require_role("owner"))):
    await db.meta.update_one({"_id": "settings"}, {"$set": body.model_dump()}, upsert=True)
    return body.model_dump()


@api.get("/menu")
async def menu(_: UserDoc = Depends(current_user)):
    docs = await db.menu.find({}).sort("id", ASCENDING).to_list(500)
    return [MenuItemDoc.from_mongo(d).to_mongo() for d in docs]


@api.post("/menu")
async def create_menu_item(body: MenuCreateIn, _: UserDoc = Depends(require_role("owner"))):
    last = await db.menu.find_one({}, sort=[("id", DESCENDING)])
    item = MenuItemDoc(id=(last["id"] + 1) if last else 1, name=body.name.strip(), price=round(body.price, 2))
    await db.menu.insert_one(item.to_mongo())
    return item.to_mongo()


@api.patch("/menu/{item_id}")
async def update_menu_item(item_id: int, body: MenuUpdateIn, _: UserDoc = Depends(require_role("owner"))):
    changes = body.model_dump(exclude_none=True)
    if "name" in changes:
        changes["name"] = changes["name"].strip()
    if "price" in changes:
        changes["price"] = round(changes["price"], 2)
    if not changes:
        raise HTTPException(400, "Keine Änderungen")
    res = await db.menu.update_one({"id": item_id}, {"$set": changes})
    if res.matched_count == 0:
        raise HTTPException(404, "Gericht nicht gefunden")
    return MenuItemDoc.from_mongo(await db.menu.find_one({"id": item_id})).to_mongo()


@api.get("/staff")
async def list_staff(_: UserDoc = Depends(require_role("owner"))):
    docs = await db.users.find({"role": {"$in": ["waiter", "kitchen"]}}).sort([("role", ASCENDING), ("username", ASCENDING)]).to_list(500)
    return [public_user(UserDoc.from_mongo(d)) for d in docs]


@api.post("/staff", status_code=201)
async def create_staff(body: StaffCreateIn, _: UserDoc = Depends(require_role("owner"))):
    hashed = await run_in_threadpool(lambda: bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode())
    user = UserDoc(username=body.username, password_hash=hashed, role=body.role, display_name=body.display_name)
    try:
        await db.users.insert_one(user.to_mongo())
    except DuplicateKeyError:
        raise HTTPException(409, "Benutzername ist schon vergeben")
    return public_user(user)


@api.patch("/staff/{username}/password")
async def reset_staff_password(username: str, body: StaffPasswordIn, _: UserDoc = Depends(require_role("owner"))):
    hashed = await run_in_threadpool(lambda: bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode())
    res = await db.users.update_one(
        {"username": username.lower(), "role": {"$in": ["waiter", "kitchen"]}},
        {"$set": {"password_hash": hashed, "must_change_password": False}, "$inc": {"password_version": 1}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Konto nicht gefunden")
    return {"ok": True}


@api.delete("/staff/{username}")
async def delete_staff(username: str, _: UserDoc = Depends(require_role("owner"))):
    res = await db.users.delete_one({"username": username.lower(), "role": {"$in": ["waiter", "kitchen"]}})
    if res.deleted_count == 0:
        raise HTTPException(404, "Konto nicht gefunden")
    return {"ok": True}


@api.get("/tables")
async def tables(_: UserDoc = Depends(require_role("waiter"))):
    unpaid = await db.orders.find({"paid": {"$ne": True}}).to_list(1000)
    orders = [OrderDoc.from_mongo(d) for d in unpaid]
    rank = {"ready": 4, "preparing": 3, "new": 2, "served": 1}
    result = []
    for t in range(1, TABLE_COUNT + 1):
        t_orders = [o for o in orders if o.table == t]
        status = "free"
        if t_orders:
            top = max((o.status for o in t_orders), key=lambda s: rank[s])
            status = "billing" if top == "served" else top
        result.append({
            "table": t,
            "status": status,
            "open_orders": len([o for o in t_orders if o.status != "served"]),
            "total": round(sum(o.total - paid_amount(o) for o in t_orders), 2),
        })
    return result


def order_total(items: List[OrderItem]) -> float:
    return round(sum(i.price * i.qty for i in items), 2)


def paid_amount(o: OrderDoc) -> float:
    if o.paid:
        return o.total
    return round(sum(i.price * i.paid_qty for i in o.items), 2)


def check_table(table: int):
    if not 1 <= table <= TABLE_COUNT:
        raise HTTPException(404, "Tisch nicht gefunden")


async def unpaid_orders(table: int) -> List[OrderDoc]:
    docs = await db.orders.find({"table": table, "paid": {"$ne": True}}).sort("created_at", ASCENDING).to_list(500)
    return [OrderDoc.from_mongo(d) for d in docs]


@api.get("/tables/{table}/bill")
async def table_bill(table: int, _: UserDoc = Depends(require_role("waiter"))):
    check_table(table)
    orders = await unpaid_orders(table)
    lines: dict[int, dict] = {}
    for o in orders:
        for it in o.items:
            line = lines.setdefault(it.menu_id, {"menu_id": it.menu_id, "name": it.name, "price": it.price, "qty": 0, "paid_qty": 0})
            line["qty"] += it.qty
            line["paid_qty"] += it.paid_qty
    out = sorted(lines.values(), key=lambda x: x["menu_id"])
    for line in out:
        line["open_qty"] = line["qty"] - line["paid_qty"]
        line["amount"] = round(line["price"] * line["qty"], 2)
        line["open_amount"] = round(line["price"] * line["open_qty"], 2)
    total = round(sum(o.total for o in orders), 2)
    paid = round(sum(paid_amount(o) for o in orders), 2)
    return {
        "table": table,
        "lines": out,
        "total": total,
        "paid_total": paid,
        "open_total": round(total - paid, 2),
        "orders": len(orders),
        "all_served": all(o.status == "served" for o in orders),
    }


TABLE_LOCKS: dict[int, asyncio.Lock] = {}


async def settle(table: int, wanted: dict[int, int], user: UserDoc) -> dict:
    """Mark `wanted` units (menu_id -> qty) as paid; serialised per table so units are never paid twice."""
    lock = TABLE_LOCKS.setdefault(table, asyncio.Lock())
    async with lock:
        return await _settle(table, wanted, user)


async def _settle(table: int, wanted: dict[int, int], user: UserDoc) -> dict:
    orders = await unpaid_orders(table)
    if not orders:
        raise HTTPException(400, "Keine offene Rechnung für diesen Tisch")
    if any(o.status != "served" for o in orders):
        raise HTTPException(400, "Noch nicht alle Gerichte serviert")
    amount = 0.0
    paid_lines = []
    for menu_id, qty in wanted.items():
        remaining = qty
        for o in orders:
            for it in o.items:
                if it.menu_id != menu_id or remaining == 0:
                    continue
                take = min(remaining, it.qty - it.paid_qty)
                if take > 0:
                    it.paid_qty += take
                    remaining -= take
                    amount += it.price * take
        if remaining > 0:
            raise HTTPException(400, "Mehr ausgewählt als offen")
        name = next((it.name for o in orders for it in o.items if it.menu_id == menu_id), "")
        paid_lines.append({"menu_id": menu_id, "name": name, "qty": qty})
    now = datetime.now(timezone.utc).isoformat()
    for o in orders:
        full = all(it.paid_qty >= it.qty for it in o.items)
        update = {"items": [it.model_dump() for it in o.items], "updated_at": now}
        if full:
            update.update({"paid": True, "paid_at": now})
        # status guard: only touch orders that are still served & unpaid
        await db.orders.update_one({"id": o.id, "status": "served", "paid": {"$ne": True}}, {"$set": update})
        o.paid = full
    amount = round(amount, 2)
    await db.payments.insert_one({
        "id": str(uuid.uuid4()), "table": table, "amount": amount, "lines": paid_lines,
        "waiter": user.username, "created_at": now,
    })
    return {"table": table, "amount": amount, "closed": all(o.paid for o in orders)}


@api.post("/tables/{table}/pay")
async def pay_part(table: int, body: PayIn, user: UserDoc = Depends(require_role("waiter"))):
    check_table(table)
    wanted: dict[int, int] = {}
    for line in body.lines:
        wanted[line.menu_id] = wanted.get(line.menu_id, 0) + line.qty
    return await settle(table, wanted, user)


@api.post("/tables/{table}/close")
async def close_table(table: int, user: UserDoc = Depends(require_role("waiter"))):
    check_table(table)
    orders = await unpaid_orders(table)
    if not orders:
        raise HTTPException(400, "Keine offene Rechnung für diesen Tisch")
    wanted: dict[int, int] = {}
    for o in orders:
        for it in o.items:
            if it.qty > it.paid_qty:
                wanted[it.menu_id] = wanted.get(it.menu_id, 0) + it.qty - it.paid_qty
    res = await settle(table, wanted, user)
    return {**res, "total": res["amount"], "orders": len(orders)}


@api.post("/tables/{table}/move")
async def move_table(table: int, body: MoveIn, _: UserDoc = Depends(require_role("waiter"))):
    check_table(table)
    if body.to == table:
        raise HTTPException(400, "Bitte einen anderen Tisch wählen")
    now = datetime.now(timezone.utc).isoformat()
    res = await db.orders.update_many(
        {"table": table, "paid": {"$ne": True}}, {"$set": {"table": body.to, "updated_at": now}}
    )
    if res.modified_count == 0:
        raise HTTPException(400, "Keine offenen Bestellungen an diesem Tisch")
    return {"from": table, "to": body.to, "moved": res.modified_count}


LOCAL_TZ = ZoneInfo("Europe/Berlin")


@api.get("/reports/today")
async def report_today(_: UserDoc = Depends(current_user)):
    now_local = datetime.now(LOCAL_TZ)
    start = now_local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).isoformat()
    docs = await db.orders.find({"created_at": {"$gte": start}}).to_list(5000)
    orders = [OrderDoc.from_mongo(d) for d in docs]
    by_waiter: dict[str, dict] = {}
    dishes: dict[int, dict] = {}
    for o in orders:
        w = by_waiter.setdefault(o.waiter, {"username": o.waiter, "waiter_name": o.waiter_name, "orders": 0, "revenue": 0.0})
        w["orders"] += 1
        w["revenue"] += o.total
        for it in o.items:
            d = dishes.setdefault(it.menu_id, {"menu_id": it.menu_id, "name": it.name, "qty": 0, "revenue": 0.0})
            d["qty"] += it.qty
            d["revenue"] += it.price * it.qty
    for w in by_waiter.values():
        w["revenue"] = round(w["revenue"], 2)
    for d in dishes.values():
        d["revenue"] = round(d["revenue"], 2)
    top = sorted(dishes.values(), key=lambda d: (-d["qty"], d["menu_id"]))
    payments = await db.payments.find({"created_at": {"$gte": start}}, {"_id": 0, "amount": 1}).to_list(10000)
    paid = round(sum(p["amount"] for p in payments), 2)
    total = round(sum(o.total for o in orders), 2)
    open_amount = round(sum(o.total - paid_amount(o) for o in orders), 2)
    return {
        "date": now_local.date().isoformat(),
        "revenue_total": total,
        "revenue_paid": paid,
        "revenue_open": open_amount,
        "orders_count": len(orders),
        "items_count": sum(d["qty"] for d in dishes.values()),
        "by_waiter": sorted(by_waiter.values(), key=lambda w: -w["revenue"]),
        "top_dishes": top,
    }


@api.get("/orders")
async def list_orders(
    table: Optional[int] = Query(None, ge=1, le=TABLE_COUNT),
    active: bool = True,
    _: UserDoc = Depends(current_user),
):
    q: dict = {}
    if table is not None:
        q["table"] = table
    if active:
        q["status"] = {"$ne": "served"}
    docs = await db.orders.find(q).sort("created_at", ASCENDING).to_list(500)
    return [OrderDoc.from_mongo(d).to_mongo() for d in docs]


@api.post("/orders")
async def create_order(body: OrderIn, user: UserDoc = Depends(require_role("waiter"))):
    items: List[OrderItem] = []
    menu_docs = await db.menu.find({"id": {"$in": [it.menu_id for it in body.items]}}).to_list(100)
    menu_by_id = {d["id"]: MenuItemDoc.from_mongo(d) for d in menu_docs}
    for it in body.items:
        m = menu_by_id.get(it.menu_id)
        if not m:
            raise HTTPException(400, f"Unbekanntes Gericht {it.menu_id}")
        if not m.available:
            raise HTTPException(400, f"{m.name} ist derzeit nicht verfügbar")
        if it.voice_note_id and not await db.voice_notes.find_one({"id": it.voice_note_id}):
            raise HTTPException(400, "Sprachnotiz nicht gefunden")
        items.append(OrderItem(menu_id=m.id, name=m.name, price=m.price, qty=it.qty,
                               note_text=(it.note_text or "").strip() or None, voice_note_id=it.voice_note_id))
    order = OrderDoc(table=body.table, items=items, total=order_total(items),
                     waiter=user.username, waiter_name=user.display_name)
    await db.orders.insert_one(order.to_mongo())
    return order.to_mongo()


ALLOWED = {
    "kitchen": {"new": "preparing", "preparing": "ready"},
    "waiter": {"ready": "served"},
    "owner": {},
}


@api.patch("/orders/{order_id}/status")
async def update_status(order_id: str, body: StatusIn, user: UserDoc = Depends(current_user)):
    doc = await db.orders.find_one({"id": order_id})
    if not doc:
        raise HTTPException(404, "Bestellung nicht gefunden")
    order = OrderDoc.from_mongo(doc)
    if ALLOWED[user.role].get(order.status) != body.status:
        raise HTTPException(400, "Statuswechsel nicht erlaubt")
    now = datetime.now(timezone.utc).isoformat()
    await db.orders.update_one({"id": order_id}, {"$set": {"status": body.status, "updated_at": now}})
    order.status = body.status
    order.updated_at = now
    return order.to_mongo()


AUDIO_TYPES = {"m4a": "audio/mp4", "mp4": "audio/mp4", "webm": "audio/webm", "wav": "audio/wav",
               "mp3": "audio/mpeg", "aac": "audio/aac", "caf": "audio/x-caf", "3gp": "audio/3gpp"}


@api.post("/voice-notes")
async def upload_voice(
    audio: UploadFile = File(...),
    duration_ms: Optional[int] = Form(None),
    user: UserDoc = Depends(require_role("waiter")),
):
    data = await audio.read()
    logger.info("voice upload from %s: %d bytes, name=%s, type=%s, duration_ms=%s",
                user.username, len(data), audio.filename, audio.content_type, duration_ms)
    if len(data) < 300:
        raise HTTPException(
            400,
            "Es kam kein Ton an – die Aufnahme ist leer. Bitte Mikrofon prüfen "
            "(im Android-Emulator: ⋯ → Microphone → „Virtual microphone uses host audio input“ einschalten).",
        )
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(400, "Aufnahme zu groß")
    ext = (audio.filename or "aufnahme.m4a").rsplit(".", 1)[-1].lower()
    ctype = (audio.content_type or "").split(";")[0]
    if ext not in AUDIO_TYPES:
        ext = "webm" if "webm" in ctype else "m4a"
    content_type = AUDIO_TYPES[ext]
    path = f"{APP_NAME}/uploads/{user.username}/{uuid.uuid4()}.{ext}"
    try:
        result = await run_in_threadpool(put_object, path, data, content_type)
    except requests.HTTPError as e:
        logger.error("storage upload failed: %s", e)
        code = e.response.status_code if e.response is not None else 500
        raise HTTPException(502, "Speicher voll – Guthaben aufladen" if code == 402 else "Audio konnte nicht gespeichert werden")
    try:
        transcript = await transcribe_bytes(data, ext)
    except Exception as e:
        logger.error("transcription failed: %s", e)
        transcript = ""
    note = VoiceNoteDoc(storage_path=result["path"], content_type=content_type, transcript=transcript, owner=user.username)
    await db.voice_notes.insert_one(note.to_mongo())
    return {"id": note.id, "transcript": transcript}


@api.get("/voice-notes/{note_id}/audio")
async def voice_audio(note_id: str, token: Optional[str] = None,
                      cred: Optional[HTTPAuthorizationCredentials] = Depends(bearer)):
    await user_from_token(cred.credentials if cred else token)
    doc = await db.voice_notes.find_one({"id": note_id})
    if not doc:
        raise HTTPException(404, "Sprachnotiz nicht gefunden")
    note = VoiceNoteDoc.from_mongo(doc)
    try:
        data, _ = await run_in_threadpool(get_object, note.storage_path)
    except requests.RequestException as e:
        logger.error("storage download failed: %s", e)
        raise HTTPException(502, "Audio konnte nicht geladen werden")
    return Response(content=data, media_type=note.content_type, headers={"Cache-Control": "private, max-age=86400"})


WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]


@api.get("/reports/history")
async def report_history(
    period: Literal["7d", "30d", "12w"] = Query("7d", alias="range"),
    _: UserDoc = Depends(require_role("owner")),
):
    today = datetime.now(LOCAL_TZ).date()
    if period == "12w":
        monday = today - timedelta(days=today.weekday())
        keys = [monday - timedelta(weeks=i) for i in reversed(range(12))]
    else:
        n = 7 if period == "7d" else 30
        keys = [today - timedelta(days=i) for i in reversed(range(n))]
    start_local = datetime.combine(keys[0], datetime.min.time(), tzinfo=LOCAL_TZ)
    docs = await db.orders.find(
        {"created_at": {"$gte": start_local.astimezone(timezone.utc).isoformat()}}
    ).to_list(50000)
    buckets = {k: {"key": k.isoformat(), "revenue": 0.0, "orders": 0, "items": 0} for k in keys}
    weekday = [{"weekday": WEEKDAYS[i], "revenue": 0.0, "days": 0} for i in range(7)]
    per_day: dict = {}
    for d in docs:
        o = OrderDoc.from_mongo(d)
        local_day = datetime.fromisoformat(o.created_at).astimezone(LOCAL_TZ).date()
        key = local_day - timedelta(days=local_day.weekday()) if period == "12w" else local_day
        b = buckets.get(key)
        if b is None:
            continue
        b["revenue"] += o.total
        b["orders"] += 1
        b["items"] += sum(i.qty for i in o.items)
        per_day[local_day] = per_day.get(local_day, 0.0) + o.total
    # weekday averages over every calendar day in the range (quiet days count as 0)
    day = start_local.date()
    while day <= today:
        w = weekday[day.weekday()]
        w["revenue"] += per_day.get(day, 0.0)
        w["days"] += 1
        day += timedelta(days=1)
    out = []
    for k in keys:
        b = buckets[k]
        b["revenue"] = round(b["revenue"], 2)
        b["label"] = f"KW {k.isocalendar()[1]}" if period == "12w" else f"{WEEKDAYS[k.weekday()]} {k.day:02d}.{k.month:02d}."
        b["short"] = f"KW{k.isocalendar()[1]}" if period == "12w" else (WEEKDAYS[k.weekday()] if period == "7d" else f"{k.day}.")
        out.append(b)
    total = round(sum(b["revenue"] for b in out), 2)
    best = max(out, key=lambda b: b["revenue"]) if out else None
    return {
        "range": period,
        "buckets": out,
        "total": total,
        "orders": sum(b["orders"] for b in out),
        "average": round(total / len(out), 2) if out else 0,
        "best": best if best and best["revenue"] > 0 else None,
        "weekday_avg": [
            {"weekday": w["weekday"], "revenue": round(w["revenue"] / w["days"], 2) if w["days"] else 0.0}
            for w in weekday
        ],
    }


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


async def seed_users():
    """One-time seeding: once done, owner deletions/password changes are never undone on restart."""
    if await db.meta.find_one({"_id": "seed_users_v1"}):
        if not await db.users.find_one({"role": "owner"}):
            # safety net: the app must always have an owner account
            username, pw, role, name = SEED_USERS[-1]
            hashed = bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()
            await db.users.insert_one(UserDoc(username=username, password_hash=hashed, role=role, display_name=name, must_change_password=True).to_mongo())
        return
    for username, pw, role, name in SEED_USERS:
        if await db.users.find_one({"username": username}):
            continue
        hashed = bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()
        user = UserDoc(username=username, password_hash=hashed, role=role, display_name=name, must_change_password=True)
        await db.users.insert_one(user.to_mongo())
    await db.meta.update_one({"_id": "seed_users_v1"}, {"$set": {"done_at": datetime.now(timezone.utc).isoformat()}}, upsert=True)


async def flag_default_passwords():
    """One-time per account: mark seeded accounts that still use their published demo password."""
    for username, pw, _role, _name in SEED_USERS:
        doc = await db.users.find_one({"username": username, "must_change_password": {"$exists": False}})
        if not doc:
            continue
        still_default = await run_in_threadpool(lambda: bcrypt.checkpw(pw.encode(), doc["password_hash"].encode()))
        await db.users.update_one({"username": username}, {"$set": {"must_change_password": still_default}})


@app.on_event("startup")
async def startup():
    app.state.index_task = asyncio.create_task(ensure_indexes())
    await seed_users()
    await flag_default_passwords()
    # older accounts predate password_version; give them the field once
    await db.users.update_many({"password_version": {"$exists": False}}, {"$set": {"password_version": 0}})
    if await db.menu.count_documents({}) == 0:
        await db.menu.insert_many([MenuItemDoc(**m).to_mongo() for m in MENU])
    # earlier served orders (before billing existed) count as paid
    await db.orders.update_many({"status": "served", "paid": {"$exists": False}}, {"$set": {"paid": True}})
    try:
        await run_in_threadpool(init_storage)
    except Exception as e:
        logger.error("storage init failed: %s", e)


@app.on_event("shutdown")
async def shutdown():
    app.state.index_task.cancel()
    with suppress(asyncio.CancelledError):
        await app.state.index_task
    client.close()
