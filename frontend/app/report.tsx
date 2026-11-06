import { useQuery } from "@tanstack/react-query";
import { Redirect, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, euro, Report } from "@/src/api";
import { useAuth } from "@/src/auth";
import HistoryCard from "@/src/components/HistoryCard";
import Icon from "@/src/components/Icon";
import { makeStyles, useTheme } from "@/src/theme";

export default function ReportScreen() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const q = useQuery({ queryKey: ["report"], queryFn: () => api<Report>("/reports/today"), refetchInterval: 10000, enabled: !!user });

  if (loading) return null;
  if (!user) return <Redirect href="/login" />;

  const r = q.data;
  const maxQty = Math.max(1, ...(r?.top_dishes.map((d) => d.qty) ?? [1]));
  const top = r?.top_dishes[0];

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable testID="report-back-button" onPress={() => router.back()} style={styles.iconBtn} accessibilityLabel="Zurück">
          <Icon name="arrow-left" size={24} color={colors.onSurface} />
        </Pressable>
        <View>
          <Text style={styles.title}>Tagesumsatz</Text>
          {r && (
            <Text style={styles.date}>
              {new Date(r.date).toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "long" })}
            </Text>
          )}
        </View>
      </View>

      {q.isLoading ? (
        <ActivityIndicator style={{ marginTop: 48 }} size="large" color={colors.brandPrimary} />
      ) : q.isError || !r ? (
        <View style={styles.center}>
          <Text style={{ color: colors.error }}>Bericht konnte nicht geladen werden.</Text>
          <Pressable testID="report-retry-button" onPress={() => q.refetch()} style={styles.retry}>
            <Text style={styles.retryText}>Erneut versuchen</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isLoading} onRefresh={() => { q.refetch(); }} />}
        >
          <Animated.View entering={FadeInDown} style={styles.hero} testID="report-revenue-card">
            <Text style={styles.heroLabel}>Umsatz heute</Text>
            <Text style={styles.heroValue} testID="report-revenue-total">
              {euro(r.revenue_total)}
            </Text>
            <View style={styles.heroRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.heroSmallLabel}>Bezahlt</Text>
                <Text style={styles.heroSmall} testID="report-revenue-paid">
                  {euro(r.revenue_paid)}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.heroSmallLabel}>Offen</Text>
                <Text style={styles.heroSmall} testID="report-revenue-open">
                  {euro(r.revenue_open)}
                </Text>
              </View>
            </View>
          </Animated.View>

          <View style={styles.statRow}>
            <Animated.View entering={FadeInDown.delay(60)} style={styles.stat}>
              <Icon name="clipboard-text-outline" size={22} color={colors.brandPrimary} />
              <Text style={styles.statValue} testID="report-orders-count">
                {r.orders_count}
              </Text>
              <Text style={styles.statLabel}>Bestellungen</Text>
            </Animated.View>
            <Animated.View entering={FadeInDown.delay(120)} style={styles.stat}>
              <Icon name="pizza" size={22} color={colors.brandPrimary} />
              <Text style={styles.statValue} testID="report-items-count">
                {r.items_count}
              </Text>
              <Text style={styles.statLabel}>Pizzas</Text>
            </Animated.View>
          </View>

          <Animated.View entering={FadeInDown.delay(180)} style={styles.card}>
            <Text style={styles.section}>Beliebteste Pizza</Text>
            {top ? (
              <View style={styles.topRow} testID="report-top-dish">
                <View style={styles.trophy}>
                  <Icon name="trophy" size={24} color={colors.onBrandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.topName}>{top.name}</Text>
                  <Text style={styles.muted}>
                    {top.qty}× verkauft · {euro(top.revenue)}
                  </Text>
                </View>
              </View>
            ) : (
              <Text style={styles.muted}>Heute noch keine Bestellungen.</Text>
            )}
            {r.top_dishes.map((d) => (
              <View key={d.menu_id} style={{ marginTop: 12 }} testID={`report-dish-${d.menu_id}`}>
                <View style={styles.barHead}>
                  <Text style={styles.barName}>{d.name}</Text>
                  <Text style={styles.barQty}>{d.qty}×</Text>
                </View>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${(d.qty / maxQty) * 100}%` }]} />
                </View>
              </View>
            ))}
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(240)} style={styles.card}>
            <Text style={styles.section}>Pro Kellner</Text>
            {r.by_waiter.length === 0 && <Text style={styles.muted}>Noch keine Daten.</Text>}
            {r.by_waiter.map((w, i) => (
              <View key={w.username} style={[styles.waiterRow, i > 0 && styles.divider]} testID={`report-waiter-${i}`}>
                <View style={styles.avatar}>
                  <Icon name="account" size={20} color={colors.onBrandTertiary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.waiterName}>{w.waiter_name}</Text>
                  <Text style={styles.muted}>{w.orders} Bestellung(en)</Text>
                </View>
                <Text style={styles.waiterRevenue}>{euro(w.revenue)}</Text>
              </View>
            ))}
          </Animated.View>
          {user.role === "owner" && <HistoryCard />}
        </ScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
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
  date: { fontSize: 13, color: c.muted },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
  retry: { minHeight: 44, paddingHorizontal: 20, borderRadius: 12, backgroundColor: c.brandPrimary, justifyContent: "center" },
  retryText: { color: c.onBrandPrimary, fontWeight: "700" },
  hero: { backgroundColor: c.surfaceInverse, borderRadius: 20, padding: 20 },
  heroLabel: { color: c.onSurfaceInverse, opacity: 0.7, fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  heroValue: { color: c.onSurfaceInverse, fontSize: 40, fontWeight: "800", marginTop: 4, letterSpacing: -1 },
  heroRow: { flexDirection: "row", marginTop: 16, gap: 12 },
  heroSmallLabel: { color: c.onSurfaceInverse, opacity: 0.7, fontSize: 12 },
  heroSmall: { color: c.onSurfaceInverse, fontSize: 18, fontWeight: "700" },
  statRow: { flexDirection: "row", gap: 12 },
  stat: { flex: 1, backgroundColor: c.surfaceSecondary, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: c.border, gap: 4 },
  statValue: { fontSize: 28, fontWeight: "800", color: c.onSurface },
  statLabel: { fontSize: 13, color: c.muted },
  card: { backgroundColor: c.surfaceSecondary, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: c.border },
  section: { fontSize: 13, fontWeight: "800", color: c.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  trophy: { width: 48, height: 48, borderRadius: 24, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center" },
  topName: { fontSize: 18, fontWeight: "800", color: c.onSurface },
  muted: { fontSize: 13, color: c.muted },
  barHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  barName: { fontSize: 14, fontWeight: "700", color: c.onSurface },
  barQty: { fontSize: 14, fontWeight: "700", color: c.onSurfaceTertiary },
  barTrack: { height: 10, borderRadius: 5, backgroundColor: c.surfaceTertiary, overflow: "hidden" },
  barFill: { height: 10, borderRadius: 5, backgroundColor: c.brandPrimary },
  waiterRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  divider: { borderTopWidth: 1, borderTopColor: c.divider },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.brandTertiary, alignItems: "center", justifyContent: "center" },
  waiterName: { fontSize: 16, fontWeight: "700", color: c.onSurface },
  waiterRevenue: { fontSize: 16, fontWeight: "800", color: c.onSurface },
}));
