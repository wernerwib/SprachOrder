import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import Animated, { FadeIn, FadeInDown, LinearTransition } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, euro, HOME, MENU_IMAGES, MenuItem, Order, STATUS_LABEL, TableInfo } from "@/src/api";
import { useAuth } from "@/src/auth";
import Icon from "@/src/components/Icon";
import PlayVoiceButton from "@/src/components/PlayVoiceButton";
import VoiceRecorderModal from "@/src/components/VoiceRecorderModal";
import { useToast } from "@/src/toast";
import { makeStyles, useTheme } from "@/src/theme";

type Draft = { key: string; menu_id: number; name: string; price: number; qty: number; note_text?: string; voice_note_id?: string | null };

export default function TableOrder() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const table = Number(id);
  const { user, loading } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const [draft, setDraft] = useState<Draft[]>([]);
  const [recordFor, setRecordFor] = useState<Draft | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);

  const menuQ = useQuery({ queryKey: ["menu"], queryFn: () => api<MenuItem[]>("/menu"), refetchInterval: 15000 });
  const tablesQ = useQuery({ queryKey: ["tables"], queryFn: () => api<TableInfo[]>("/tables"), refetchInterval: 3000 });
  const thisTable = tablesQ.data?.find((t) => t.table === table);

  const move = useMutation({
    mutationFn: (to: number) => api<{ to: number }>(`/tables/${table}/move`, { method: "POST", body: { to } }),
    onSuccess: (r) => {
      setMoveOpen(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast(`Bestellungen auf Tisch ${r.to} umgesetzt`, "success");
      qc.invalidateQueries();
      router.replace(`/waiter/table/${r.to}`);
    },
    onError: (e: any) => toast(e?.message ?? "Umsetzen fehlgeschlagen", "error"),
  });
  const ordersQ = useQuery({
    queryKey: ["orders", table],
    queryFn: () => api<Order[]>(`/orders?table=${table}`),
    refetchInterval: 3000,
  });

  const send = useMutation({
    mutationFn: () =>
      api<Order>("/orders", {
        method: "POST",
        body: {
          table,
          items: draft.map((d) => ({
            menu_id: d.menu_id,
            qty: d.qty,
            note_text: d.note_text || undefined,
            voice_note_id: d.voice_note_id || undefined,
          })),
        },
      }),
    onSuccess: () => {
      setDraft([]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast("Bestellung an die Küche gesendet", "success");
      qc.invalidateQueries({ queryKey: ["orders", table] });
      qc.invalidateQueries({ queryKey: ["tables"] });
    },
    onError: (e: any) => toast(e?.message ?? "Senden fehlgeschlagen", "error"),
  });

  const served = useMutation({
    mutationFn: (orderId: string) => api<Order>(`/orders/${orderId}/status`, { method: "PATCH", body: { status: "served" } }),
    onSuccess: () => {
      toast("Als serviert markiert", "success");
      qc.invalidateQueries({ queryKey: ["orders", table] });
      qc.invalidateQueries({ queryKey: ["tables"] });
    },
    onError: (e: any) => toast(e?.message ?? "Fehler", "error"),
  });

  if (loading) return null;
  if (!user) return <Redirect href="/login" />;
  if (user.role !== "waiter") return <Redirect href={HOME[user.role]} />;

  const add = (m: MenuItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setDraft((d) => {
      const plain = d.find((x) => x.menu_id === m.id && !x.note_text && !x.voice_note_id);
      if (plain) return d.map((x) => (x.key === plain.key ? { ...x, qty: Math.min(50, x.qty + 1) } : x));
      return [...d, { key: `${Date.now()}-${Math.random()}`, menu_id: m.id, name: m.name, price: m.price, qty: 1 }];
    });
  };
  const changeQty = (key: string, delta: number) =>
    setDraft((d) => d.map((x) => (x.key === key ? { ...x, qty: Math.max(1, Math.min(50, x.qty + delta)) } : x)));
  const remove = (key: string) => setDraft((d) => d.filter((x) => x.key !== key));
  const total = draft.reduce((s, d) => s + d.price * d.qty, 0);
  const count = draft.reduce((s, d) => s + d.qty, 0);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable testID="table-back-button" onPress={() => router.back()} style={styles.iconBtn} accessibilityLabel="Zurück">
          <Icon name="arrow-left" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title} testID="table-title">
          Tisch {table}
        </Text>
        <View style={{ flex: 1 }} />
        {thisTable && thisTable.status !== "free" && (
          <Pressable
            testID="table-move-button"
            onPress={() => setMoveOpen(true)}
            style={[styles.iconBtn, { backgroundColor: colors.surfaceTertiary }]}
            accessibilityLabel="Tisch umsetzen"
          >
            <Icon name="swap-horizontal" size={22} color={colors.onSurface} />
          </Pressable>
        )}
        <Pressable testID="table-bill-button" onPress={() => router.push(`/waiter/bill/${table}`)} style={styles.billBtn}>
          <Icon name="receipt-text-outline" size={20} color={colors.onBrandSecondary} />
          <Text style={styles.billText}>Rechnung</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 140 + insets.bottom }}>
        <Text style={styles.section}>Speisekarte</Text>
        {menuQ.isLoading && <ActivityIndicator color={colors.brandPrimary} />}
        {menuQ.data?.filter((m) => m.available).map((m, i) => (
          <Animated.View key={m.id} entering={FadeInDown.delay(i * 60)} style={styles.menuRow}>
            {m.image && MENU_IMAGES[m.image] ? (
              <Image source={{ uri: MENU_IMAGES[m.image] }} style={styles.thumb} contentFit="cover" transition={200} />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder]}>
                <Icon name="pizza" size={30} color={colors.onBrandTertiary} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.menuName}>
                <Text style={styles.menuNo}>{m.id}  </Text>
                {m.name}
              </Text>
              <Text style={styles.menuPrice}>{euro(m.price)}</Text>
            </View>
            <Pressable testID={`menu-add-${m.id}`} onPress={() => add(m)} style={styles.addBtn} accessibilityLabel={`${m.name} hinzufügen`}>
              <Icon name="plus" size={26} color={colors.onBrandPrimary} />
            </Pressable>
          </Animated.View>
        ))}

        <Text style={[styles.section, { marginTop: 24 }]}>Neue Bestellung</Text>
        {draft.length === 0 ? (
          <View style={styles.empty} testID="draft-empty">
            <Icon name="pizza" size={36} color={colors.borderStrong} />
            <Text style={styles.emptyText}>Noch keine Gerichte hinzugefügt</Text>
          </View>
        ) : (
          draft.map((d, i) => (
            <Animated.View key={d.key} entering={FadeIn} layout={LinearTransition} style={styles.draftRow} testID={`draft-item-${i}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.draftName}>{d.name}</Text>
                <Text style={styles.draftPrice}>
                  {d.qty} × {euro(d.price)} = {euro(d.qty * d.price)}
                </Text>
                <View style={styles.stepper}>
                  <Pressable
                    testID={`draft-minus-${i}`}
                    onPress={() => changeQty(d.key, -1)}
                    disabled={d.qty <= 1}
                    style={[styles.stepBtn, d.qty <= 1 && { opacity: 0.4 }]}
                    accessibilityLabel="Menge verringern"
                  >
                    <Icon name="minus" size={20} color={colors.onSurface} />
                  </Pressable>
                  <Text style={styles.stepQty} testID={`draft-qty-${i}`}>
                    {d.qty}
                  </Text>
                  <Pressable
                    testID={`draft-plus-${i}`}
                    onPress={() => changeQty(d.key, 1)}
                    style={styles.stepBtn}
                    accessibilityLabel="Menge erhöhen"
                  >
                    <Icon name="plus" size={20} color={colors.onSurface} />
                  </Pressable>
                </View>
                {(d.voice_note_id || !!d.note_text) && (
                  <View style={styles.noteChip}>
                    <Icon name={d.voice_note_id ? "microphone" : "text"} size={14} color={colors.onBrandTertiary} />
                    <Text style={styles.noteText} testID={`draft-note-${i}`} numberOfLines={3}>
                      {d.note_text || "Sprachnotiz (ohne Text)"}
                    </Text>
                  </View>
                )}
              </View>
              <Pressable
                testID={`draft-mic-${i}`}
                onPress={() => setRecordFor(d)}
                style={[styles.micBtn, (d.voice_note_id || !!d.note_text) && { backgroundColor: colors.brandPrimary }]}
                accessibilityLabel="Ergänzung hinzufügen"
              >
                <Icon
                  name={d.voice_note_id || d.note_text ? "microphone-message" : "microphone-plus"}
                  size={24}
                  color={d.voice_note_id || d.note_text ? colors.onBrandPrimary : colors.onBrandTertiary}
                />
              </Pressable>
              <Pressable testID={`draft-remove-${i}`} onPress={() => remove(d.key)} style={styles.removeBtn} accessibilityLabel="Entfernen">
                <Icon name="close" size={20} color={colors.muted} />
              </Pressable>
            </Animated.View>
          ))
        )}

        {!!ordersQ.data?.length && (
          <>
            <Text style={[styles.section, { marginTop: 24 }]}>Laufende Bestellungen</Text>
            {ordersQ.data.map((o) => (
              <View key={o.id} style={styles.orderCard} testID={`active-order-${o.id}`}>
                <View style={styles.orderHead}>
                  <Text style={styles.orderTime}>
                    {new Date(o.created_at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} · {euro(o.total)}
                  </Text>
                  <View style={[styles.badge, o.status === "ready" && { backgroundColor: colors.success }]}>
                    <Text style={[styles.badgeText, o.status === "ready" && { color: colors.onSuccess }]} testID={`active-order-status-${o.id}`}>
                      {STATUS_LABEL[o.status]}
                    </Text>
                  </View>
                </View>
                {o.items.map((it) => (
                  <View key={it.id} style={{ marginTop: 8 }}>
                    <Text style={styles.orderItem}>
                      {it.qty ?? 1}× {it.name}
                    </Text>
                    {(it.voice_note_id || !!it.note_text) && (
                      <View style={styles.orderNoteRow}>
                        <Text style={styles.orderNote} numberOfLines={2}>
                          „{it.note_text || "Sprachnotiz"}“
                        </Text>
                        {it.voice_note_id && <PlayVoiceButton voiceNoteId={it.voice_note_id} testID={`waiter-play-${it.id}`} />}
                      </View>
                    )}
                  </View>
                ))}
                {o.status === "ready" && (
                  <Pressable
                    testID={`mark-served-${o.id}`}
                    onPress={() => served.mutate(o.id)}
                    disabled={served.isPending}
                    style={styles.servedBtn}
                  >
                    <Icon name="check-all" size={20} color={colors.onSuccess} />
                    <Text style={styles.servedText}>Als serviert markieren</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <View>
          <Text style={styles.footerLabel}>{count} Gericht(e)</Text>
          <Text style={styles.footerTotal} testID="draft-total">
            {euro(total)}
          </Text>
        </View>
        <Pressable
          testID="send-to-kitchen-button"
          disabled={draft.length === 0 || send.isPending}
          onPress={() => send.mutate()}
          style={({ pressed }) => [styles.sendBtn, (draft.length === 0 || send.isPending) && { opacity: 0.45 }, pressed && { opacity: 0.85 }]}
        >
          {send.isPending ? (
            <ActivityIndicator color={colors.onBrandPrimary} />
          ) : (
            <>
              <Icon name="send" size={20} color={colors.onBrandPrimary} />
              <Text style={styles.sendText}>An Küche senden</Text>
            </>
          )}
        </Pressable>
      </View>

      <VoiceRecorderModal
        visible={!!recordFor}
        dishName={recordFor?.name ?? ""}
        initialText={recordFor?.note_text ?? ""}
        initialVoiceId={recordFor?.voice_note_id ?? null}
        onClose={() => setRecordFor(null)}
        onSaved={(note) => {
          const key = recordFor?.key;
          setDraft((d) =>
            d.map((x) => (x.key === key ? { ...x, voice_note_id: note.voice_note_id, note_text: note.note_text } : x)),
          );
        }}
      />

      <Modal visible={moveOpen} transparent animationType="fade" onRequestClose={() => setMoveOpen(false)}>
        <View style={styles.scrim}>
          <Pressable style={{ flex: 1 }} onPress={() => setMoveOpen(false)} testID="move-modal-backdrop" />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} testID="move-table-sheet">
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Tisch {table} umsetzen</Text>
            <Text style={styles.sheetSub}>Alle offenen Bestellungen und die Rechnung ziehen mit um.</Text>
            <View style={styles.moveGrid}>
              {tablesQ.data
                ?.filter((t) => t.table !== table)
                .map((t) => (
                  <Pressable
                    key={t.table}
                    testID={`move-to-table-${t.table}`}
                    disabled={move.isPending}
                    onPress={() => move.mutate(t.table)}
                    style={({ pressed }) => [styles.moveTile, t.status !== "free" && styles.moveTileBusy, pressed && { opacity: 0.7 }]}
                  >
                    <Text style={styles.moveNum}>{t.table}</Text>
                    <Text style={styles.moveStatus}>{t.status === "free" ? "Frei" : "Zusammenlegen"}</Text>
                  </Pressable>
                ))}
            </View>
            {move.isPending && <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 12 }} />}
            <Pressable testID="move-cancel-button" onPress={() => setMoveOpen(false)} style={styles.sheetCancel}>
              <Text style={styles.sheetCancelText}>Abbrechen</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  scrim: { flex: 1, backgroundColor: c.scrim },
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 12 },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: c.borderStrong, marginBottom: 16 },
  sheetTitle: { fontSize: 22, fontWeight: "800", color: c.onSurface },
  sheetSub: { fontSize: 14, color: c.muted, marginTop: 4, marginBottom: 16 },
  moveGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  moveTile: {
    width: "31%",
    flexGrow: 1,
    minHeight: 72,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: c.border,
    backgroundColor: c.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  moveTileBusy: { borderColor: c.brandPrimary, backgroundColor: c.brandTertiary },
  moveNum: { fontSize: 24, fontWeight: "800", color: c.onSurface },
  moveStatus: { fontSize: 12, color: c.muted, fontWeight: "600" },
  sheetCancel: { minHeight: 52, borderRadius: 12, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center", marginTop: 16 },
  sheetCancelText: { color: c.onSurfaceTertiary, fontSize: 16, fontWeight: "700" },
  thumbPlaceholder: { backgroundColor: c.brandTertiary, alignItems: "center", justifyContent: "center" },
  root: { flex: 1, backgroundColor: c.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: c.divider,
    backgroundColor: c.surface,
  },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 24, fontWeight: "800", color: c.onSurface },
  billBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: c.brandSecondary,
  },
  billText: { color: c.onBrandSecondary, fontWeight: "700", fontSize: 14 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: c.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  stepQty: { minWidth: 32, textAlign: "center", fontSize: 18, fontWeight: "800", color: c.onSurface },
  section: { fontSize: 13, fontWeight: "800", color: c.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: c.surfaceSecondary,
    borderRadius: 20,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: c.border,
  },
  thumb: { width: 64, height: 64, borderRadius: 12 },
  menuNo: { color: c.brandPrimary, fontWeight: "800" },
  menuName: { fontSize: 17, fontWeight: "700", color: c.onSurface },
  menuPrice: { fontSize: 15, color: c.onSurfaceTertiary, marginTop: 2 },
  addBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", padding: 24, gap: 8, borderRadius: 20, borderWidth: 1.5, borderStyle: "dashed", borderColor: c.border },
  emptyText: { color: c.muted, fontSize: 15 },
  draftRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: c.surfaceSecondary,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: c.border,
  },
  draftName: { fontSize: 16, fontWeight: "700", color: c.onSurface },
  draftPrice: { fontSize: 14, color: c.muted },
  noteChip: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    backgroundColor: c.brandTertiary,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginTop: 6,
  },
  noteText: { color: c.onBrandTertiary, fontSize: 14, flex: 1, fontStyle: "italic" },
  micBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: c.brandTertiary, alignItems: "center", justifyContent: "center" },
  removeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  orderCard: { backgroundColor: c.surfaceSecondary, borderRadius: 20, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: c.border },
  orderHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  orderTime: { fontSize: 14, color: c.muted, fontWeight: "600" },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: c.surfaceTertiary },
  badgeText: { fontSize: 12, fontWeight: "800", color: c.onSurfaceTertiary },
  orderItem: { fontSize: 16, fontWeight: "700", color: c.onSurface },
  orderNoteRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  orderNote: { flex: 1, fontSize: 14, color: c.onSurfaceTertiary, fontStyle: "italic" },
  servedBtn: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: c.success,
    alignItems: "center",
    justifyContent: "center",
  },
  servedText: { color: c.onSuccess, fontWeight: "800", fontSize: 15 },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    paddingHorizontal: 16,
    paddingTop: 16,
    backgroundColor: c.surfaceSecondary,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  footerLabel: { fontSize: 13, color: c.muted },
  footerTotal: { fontSize: 24, fontWeight: "800", color: c.onSurface },
  sendBtn: {
    flex: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 56,
    borderRadius: 12,
    backgroundColor: c.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendText: { color: c.onBrandPrimary, fontSize: 17, fontWeight: "800" },
}));
