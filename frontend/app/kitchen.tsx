import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { Redirect } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import Animated, { FadeInDown, LinearTransition } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, minutesSince, Order, OrderStatus } from "@/src/api";
import { useAuth } from "@/src/auth";
import Icon from "@/src/components/Icon";
import PlayVoiceButton from "@/src/components/PlayVoiceButton";
import { useToast } from "@/src/toast";
import { makeStyles, useTheme } from "@/src/theme";

const TABS: { key: Exclude<OrderStatus, "served">; label: string }[] = [
  { key: "new", label: "Neu" },
  { key: "preparing", label: "In Zubereitung" },
  { key: "ready", label: "Fertig" },
];
const NEXT: Record<string, { status: OrderStatus; label: string; icon: string } | undefined> = {
  new: { status: "preparing", label: "Zubereitung starten", icon: "fire" },
  preparing: { status: "ready", label: "Fertig melden", icon: "bell-check" },
};

export default function Kitchen() {
  const { user, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<Exclude<OrderStatus, "served">>("new");
  const [, tick] = useState(0);
  const lastNew = useRef<number | null>(null);

  const q = useQuery({
    queryKey: ["kitchen-orders"],
    queryFn: () => api<Order[]>("/orders"),
    refetchInterval: 3000,
    enabled: user?.role === "kitchen",
  });

  const move = useMutation({
    mutationFn: (v: { id: string; status: OrderStatus }) =>
      api<Order>(`/orders/${v.id}/status`, { method: "PATCH", body: { status: v.status } }),
    onSuccess: () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
      qc.invalidateQueries({ queryKey: ["kitchen-orders"] });
    },
    onError: (e: any) => toast(e?.message ?? "Fehler", "error"),
  });

  const newCount = q.data ? q.data.filter((o) => o.status === "new").length : null;
  useEffect(() => {
    if (newCount === null) return;
    if (lastNew.current !== null && newCount > lastNew.current) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      toast("Neue Bestellung eingegangen", "info");
    }
    lastNew.current = newCount;
  }, [newCount, toast]);

  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  if (!user) return <Redirect href="/login" />;
  if (user.role !== "kitchen") return <Redirect href="/waiter" />;

  const list = (q.data ?? []).filter((o) => o.status === tab);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.headRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>{user.display_name}</Text>
            <Text style={styles.title}>Bestellungen</Text>
          </View>
          <Pressable testID="kitchen-logout-button" onPress={logout} style={styles.iconBtn} accessibilityLabel="Abmelden">
            <Icon name="logout" size={22} color={colors.onSurfaceTertiary} />
          </Pressable>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipRow}
          contentContainerStyle={styles.chipRowContent}
        >
          {TABS.map((t) => {
            const count = q.data?.filter((o) => o.status === t.key).length ?? 0;
            const active = tab === t.key;
            return (
              <Pressable
                key={t.key}
                testID={`kitchen-tab-${t.key}`}
                onPress={() => setTab(t.key)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{t.label}</Text>
                <View style={[styles.count, active && { backgroundColor: colors.onBrandSecondary }]}>
                  <Text style={[styles.countText, active && { color: colors.brandSecondary }]} testID={`kitchen-count-${t.key}`}>
                    {count}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {q.isLoading ? (
        <ActivityIndicator style={{ marginTop: 48 }} size="large" color={colors.brandPrimary} />
      ) : q.isError ? (
        <View style={styles.empty}>
          <Text style={{ color: colors.error }}>Bestellungen konnten nicht geladen werden.</Text>
          <Pressable testID="kitchen-retry-button" onPress={() => q.refetch()} style={styles.cta}>
            <Text style={styles.ctaText}>Erneut versuchen</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          testID="kitchen-ticket-list"
          data={list}
          keyExtractor={(o) => o.id}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 24, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isLoading} onRefresh={q.refetch} />}
          ListEmptyComponent={
            <View style={styles.empty} testID="kitchen-empty">
              <Icon name="silverware-clean" size={48} color={colors.borderStrong} />
              <Text style={styles.emptyText}>Keine Tickets in „{TABS.find((t) => t.key === tab)?.label}“</Text>
            </View>
          }
          renderItem={({ item, index }) => {
            const next = NEXT[item.status];
            const mins = minutesSince(item.created_at);
            return (
              <Animated.View entering={FadeInDown.delay(index * 50)} layout={LinearTransition} style={styles.ticket} testID={`ticket-${item.id}`}>
                <View style={styles.ticketHead}>
                  <View>
                    <Text style={styles.ticketLabel}>Tisch</Text>
                    <Text style={styles.ticketTable} testID={`ticket-table-${item.id}`}>
                      {item.table}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <View style={[styles.timer, mins >= 15 && { backgroundColor: colors.warning }]}>
                      <Icon name="clock-outline" size={14} color={mins >= 15 ? colors.onWarning : colors.onSurfaceTertiary} />
                      <Text style={[styles.timerText, mins >= 15 && { color: colors.onWarning }]}>{mins} Min.</Text>
                    </View>
                    <Text style={styles.waiter}>{item.waiter_name}</Text>
                  </View>
                </View>
                {item.items.map((it, i) => (
                  <View key={it.id} style={[styles.item, i > 0 && styles.itemBorder]}>
                    <Text style={styles.itemName}>
                      <Text style={styles.itemNo}>1×  </Text>
                      {it.name}
                    </Text>
                    {(it.voice_note_id || !!it.note_text) && (
                      <View style={styles.note} testID={`ticket-note-${it.id}`}>
                        <View style={styles.noteHead}>
                          <Icon name="microphone" size={16} color={colors.onBrandTertiary} />
                          <Text style={styles.noteLabel}>Ergänzung</Text>
                        </View>
                        <Text style={styles.noteText} testID={`ticket-note-text-${it.id}`}>
                          {it.note_text || "(kein Text erkannt – bitte anhören)"}
                        </Text>
                        {it.voice_note_id && <PlayVoiceButton voiceNoteId={it.voice_note_id} testID={`ticket-play-${it.id}`} />}
                      </View>
                    )}
                  </View>
                ))}
                {next ? (
                  <Pressable
                    testID={`ticket-advance-${item.id}`}
                    onPress={() => move.mutate({ id: item.id, status: next.status })}
                    disabled={move.isPending}
                    style={({ pressed }) => [styles.cta, item.status === "preparing" && { backgroundColor: colors.success }, pressed && { opacity: 0.85 }]}
                  >
                    <Icon name={next.icon as any} size={22} color={colors.onBrandPrimary} />
                    <Text style={styles.ctaText}>{next.label}</Text>
                  </Pressable>
                ) : (
                  <View style={styles.waiting}>
                    <Icon name="room-service-outline" size={18} color={colors.success} />
                    <Text style={styles.waitingText}>Wartet auf Abholung durch den Service</Text>
                  </View>
                )}
              </Animated.View>
            );
          }}
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surfaceTertiary },
  header: { backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.divider },
  headRow: { flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 16 },
  kicker: { fontSize: 13, fontWeight: "700", color: c.brandPrimary, textTransform: "uppercase", letterSpacing: 1 },
  title: { fontSize: 32, fontWeight: "800", color: c.onSurface, letterSpacing: -0.5 },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  chipRow: { height: 56, flexGrow: 0 },
  chipRowContent: { gap: 8, paddingHorizontal: 16, alignItems: "center" },
  chip: {
    height: 36,
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: c.surfaceTertiary,
    borderWidth: 1,
    borderColor: c.border,
  },
  chipActive: { backgroundColor: c.brandSecondary, borderColor: c.brandSecondary },
  chipText: { fontSize: 14, fontWeight: "700", color: c.onSurfaceTertiary },
  chipTextActive: { color: c.onBrandSecondary },
  count: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: c.surfaceSecondary, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  countText: { fontSize: 12, fontWeight: "800", color: c.onSurfaceTertiary },
  ticket: {
    backgroundColor: c.surfaceSecondary,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: c.border,
    shadowColor: c.onSurface,
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  ticketHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 },
  ticketLabel: { fontSize: 12, fontWeight: "700", color: c.muted, textTransform: "uppercase", letterSpacing: 1 },
  ticketTable: { fontSize: 44, fontWeight: "800", color: c.brandPrimary, lineHeight: 50 },
  timer: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: c.surfaceTertiary, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  timerText: { fontSize: 13, fontWeight: "700", color: c.onSurfaceTertiary },
  waiter: { fontSize: 12, color: c.muted },
  item: { paddingVertical: 10, gap: 8 },
  itemBorder: { borderTopWidth: 1, borderTopColor: c.divider },
  itemNo: { color: c.muted, fontWeight: "700" },
  itemName: { fontSize: 19, fontWeight: "800", color: c.onSurface },
  note: { backgroundColor: c.brandTertiary, borderRadius: 12, padding: 12, gap: 8 },
  noteHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  noteLabel: { fontSize: 12, fontWeight: "800", color: c.onBrandTertiary, textTransform: "uppercase", letterSpacing: 0.5 },
  noteText: { fontSize: 18, fontWeight: "600", color: c.onSurface, lineHeight: 24 },
  cta: {
    flexDirection: "row",
    gap: 8,
    minHeight: 56,
    borderRadius: 12,
    backgroundColor: c.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    paddingHorizontal: 20,
  },
  ctaText: { color: c.onBrandPrimary, fontSize: 17, fontWeight: "800" },
  waiting: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, padding: 12, borderRadius: 12, backgroundColor: c.surfaceTertiary },
  waitingText: { color: c.success, fontWeight: "700", fontSize: 14 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
  emptyText: { color: c.muted, fontSize: 16, textAlign: "center" },
}));
