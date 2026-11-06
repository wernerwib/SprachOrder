export const API_URL = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api`;

let authToken: string | null = null;
export const setAuthToken = (t: string | null) => {
  authToken = t;
};
export const getAuthToken = () => authToken;

export type Role = "waiter" | "kitchen";
export type User = { username: string; role: Role; display_name: string };
export type MenuItem = { id: number; name: string; price: number; image: string };
export type OrderStatus = "new" | "preparing" | "ready" | "served";
export type OrderItem = {
  id: string;
  menu_id: number;
  name: string;
  price: number;
  note_text?: string | null;
  voice_note_id?: string | null;
};
export type Order = {
  id: string;
  table: number;
  status: OrderStatus;
  items: OrderItem[];
  total: number;
  waiter: string;
  waiter_name: string;
  created_at: string;
  updated_at: string;
};
export type TableInfo = {
  table: number;
  status: "free" | "new" | "preparing" | "ready";
  open_orders: number;
  total: number;
};

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    let msg = `Fehler ${res.status}`;
    try {
      const j = await res.json();
      if (j?.detail) msg = typeof j.detail === "string" ? j.detail : msg;
    } catch {}
    const err = new Error(msg) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export const voiceAudioUrl = (id: string) =>
  `${API_URL}/voice-notes/${id}/audio?token=${encodeURIComponent(authToken ?? "")}`;

export const euro = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;

export const MENU_IMAGES: Record<string, string> = {
  pizza_margherita:
    "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?crop=entropy&cs=srgb&fm=jpg&w=400&q=70",
  pizza_funghi:
    "https://images.unsplash.com/photo-1620374645310-f9d97e733268?crop=entropy&cs=srgb&fm=jpg&w=400&q=70",
  pizza_al_casa:
    "https://images.unsplash.com/photo-1579751626657-72bc17010498?crop=entropy&cs=srgb&fm=jpg&w=400&q=70",
};
export const HERO_IMAGE =
  "https://images.unsplash.com/photo-1646656352194-7db15ee021bf?crop=entropy&cs=srgb&fm=jpg&w=1000&q=75";

export const STATUS_LABEL: Record<string, string> = {
  free: "Frei",
  new: "Bestellt",
  preparing: "In Zubereitung",
  ready: "Abholbereit",
  served: "Serviert",
};

export const minutesSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
