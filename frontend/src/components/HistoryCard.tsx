import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { api, euro, History } from "@/src/api";
import { makeStyles, useTheme } from "@/src/theme";

const RANGES: { key: History["range"]; label: string }[] = [
  { key: "7d", label: "7 Tage" },
  { key: "30d", label: "30 Tage" },
  { key: "12w", label: "12 Wochen" },
];
const CHART_H = 140;

export default function HistoryCard() {
  const [range, setRange] = useState<History["range"]>("7d");
  const [selected, setSelected] = useState<string | null>(null);
  const [chartW, setChartW] = useState(0);
  const { colors } = useTheme();
  const styles = useStyles();
  const q = useQuery({ queryKey: ["history", range], queryFn: () => api<History>(`/reports/history?range=${range}`) });
  const h = q.data;
  const max = Math.max(1, ...(h?.buckets.map((b) => b.revenue) ?? [1]));
  const sel = h?.buckets.find((b) => b.key === selected) ?? null;
  const wMax = Math.max(1, ...(h?.weekday_avg.map((w) => w.revenue) ?? [1]));
  const nonZero = h?.weekday_avg.filter((w) => w.revenue > 0) ?? [];
  const busiest = nonZero.length ? nonZero.reduce((a, b) => (b.revenue > a.revenue ? b : a)) : null;
  const quietest = nonZero.length > 1 ? h!.weekday_avg.reduce((a, b) => (b.revenue < a.revenue ? b : a)) : null;
  const showEvery = range === "30d" ? 5 : range === "12w" ? 2 : 1;

  return (
    <View style={styles.card} testID="report-history-card">
      <Text style={styles.section}>Umsatz-Verlauf</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipRow}>
        {RANGES.map((r) => (
          <Pressable
            key={r.key}
            testID={`history-range-${r.key}`}
            onPress={() => {
              setRange(r.key);
              setSelected(null);
            }}
            style={[styles.chip, range === r.key && styles.chipActive]}
          >
            <Text style={[styles.chipText, range === r.key && { color: colors.onBrandSecondary }]}>{r.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {q.isLoading ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ height: CHART_H + 80 }} />
      ) : q.isError || !h ? (
        <Pressable testID="history-retry-button" onPress={() => q.refetch()} style={{ height: CHART_H, justifyContent: "center" }}>
          <Text style={{ color: colors.error, textAlign: "center" }}>Verlauf konnte nicht geladen werden – tippen zum Wiederholen</Text>
        </Pressable>
      ) : (
        <Animated.View entering={FadeIn} key={range}>
          <View style={styles.kpis}>
            <View style={{ flex: 1 }}>
              <Text style={styles.kpiLabel}>{sel ? sel.label : "Summe"}</Text>
              <Text style={styles.kpiValue} testID="history-total">
                {euro(sel ? sel.revenue : h.total)}
              </Text>
              <Text style={styles.kpiSub}>{sel ? `${sel.orders} Bestellungen · ${sel.items} Pizzas` : `${h.orders} Bestellungen`}</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={styles.kpiLabel}>Ø pro {range === "12w" ? "Woche" : "Tag"}</Text>
              <Text style={styles.kpiValueSmall} testID="history-average">
                {euro(h.average)}
              </Text>
            </View>
          </View>

          <View
            style={styles.chart}
            testID="history-chart"
            onLayout={(e) => setChartW(e.nativeEvent.layout.width)}
          >
            {h.buckets.map((b, i) => {
              const active = b.key === selected;
              const best = h.best?.key === b.key;
              return (
                <View key={b.key} style={styles.barCol} testID={`history-bar-${i}`}>
                  <View
                    style={[
                      styles.bar,
                      { height: Math.max(b.revenue > 0 ? 4 : 2, (b.revenue / max) * CHART_H) },
                      b.revenue === 0 && { backgroundColor: colors.border },
                      best && { backgroundColor: colors.brandPrimary },
                      active && { backgroundColor: colors.brandSecondary },
                    ]}
                  />
                </View>
              );
            })}
            {/* one large touch area: the tapped x position picks the bar */}
            <Pressable
              testID="history-chart-touch"
              style={StyleSheet.absoluteFill}
              onPress={(e) => {
                const ne = e.nativeEvent as any;
                const x = typeof ne.locationX === "number" ? ne.locationX : ne.offsetX;
                if (!chartW || typeof x !== "number" || !Number.isFinite(x)) return;
                const idx = Math.min(h.buckets.length - 1, Math.max(0, Math.floor((x / chartW) * h.buckets.length)));
                const bucket = h.buckets[idx];
                if (!bucket) return;
                setSelected((s) => (s === bucket.key ? null : bucket.key));
              }}
              accessibilityLabel="Balken antippen, um den Wert zu sehen"
            />
          </View>
          <View style={styles.axis}>
            {h.buckets.map((b, i) =>
              (h.buckets.length - 1 - i) % showEvery === 0 ? (
                <Text
                  key={b.key}
                  style={[
                    styles.barLabel,
                    { left: `${((i + 0.5) / h.buckets.length) * 100}%` },
                    b.key === selected && { color: colors.onSurface, fontWeight: "800" },
                  ]}
                  numberOfLines={1}
                >
                  {b.short}
                </Text>
              ) : null,
            )}
          </View>
          {h.best && (
            <Text style={styles.bestText} testID="history-best">
              {range === "12w" ? "Stärkste Woche" : "Stärkster Tag"}: {h.best.label} · {euro(h.best.revenue)}
            </Text>
          )}

          {range !== "7d" && (
            <View style={{ marginTop: 20 }}>
              <Text style={styles.subSection}>Ø Umsatz pro Wochentag</Text>
              {h.weekday_avg.map((w) => (
                <View key={w.weekday} style={styles.wRow} testID={`history-weekday-${w.weekday}`}>
                  <Text style={styles.wDay}>{w.weekday}</Text>
                  <View style={styles.wTrack}>
                    <View
                      style={[
                        styles.wFill,
                        { width: `${(w.revenue / wMax) * 100}%` },
                        busiest?.weekday === w.weekday && { backgroundColor: colors.success },
                        quietest?.weekday === w.weekday && { backgroundColor: colors.warning },
                      ]}
                    />
                  </View>
                  <Text style={styles.wVal}>{euro(w.revenue)}</Text>
                </View>
              ))}
              {busiest && (
                <Text style={styles.bestText}>
                  Am meisten los: {busiest.weekday}
                  {quietest && quietest.weekday !== busiest.weekday ? ` · am ruhigsten: ${quietest.weekday}` : ""}
                </Text>
              )}
            </View>
          )}
        </Animated.View>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  card: { backgroundColor: c.surfaceSecondary, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: c.border },
  section: { fontSize: 13, fontWeight: "800", color: c.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
  subSection: { fontSize: 13, fontWeight: "800", color: c.onSurfaceTertiary, marginBottom: 8 },
  chipRow: { height: 56, flexGrow: 0, marginHorizontal: -16 },
  chips: { gap: 8, paddingHorizontal: 16, alignItems: "center" },
  chip: {
    height: 36,
    flexShrink: 0,
    paddingHorizontal: 14,
    borderRadius: 999,
    justifyContent: "center",
    backgroundColor: c.surfaceTertiary,
    borderWidth: 1,
    borderColor: c.border,
  },
  chipActive: { backgroundColor: c.brandSecondary, borderColor: c.brandSecondary },
  chipText: { fontSize: 14, fontWeight: "700", color: c.onSurfaceTertiary },
  kpis: { flexDirection: "row", alignItems: "flex-end", marginBottom: 12 },
  kpiLabel: { fontSize: 12, color: c.muted, fontWeight: "600" },
  kpiValue: { fontSize: 28, fontWeight: "800", color: c.onSurface },
  kpiValueSmall: { fontSize: 18, fontWeight: "800", color: c.onSurface },
  kpiSub: { fontSize: 12, color: c.muted },
  chart: { height: CHART_H, flexDirection: "row", alignItems: "flex-end", gap: 3, overflow: "hidden" },
  barCol: { flex: 1, height: CHART_H, justifyContent: "flex-end", alignItems: "center" },
  bar: { width: "80%", maxWidth: 28, borderRadius: 4, backgroundColor: c.borderStrong },
  axis: { height: 18, marginTop: 4 },
  barLabel: { position: "absolute", width: 40, marginLeft: -20, textAlign: "center", fontSize: 11, color: c.muted },
  bestText: { fontSize: 13, color: c.onSurfaceTertiary, marginTop: 10, fontWeight: "600" },
  wRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  wDay: { width: 24, fontSize: 13, fontWeight: "700", color: c.onSurface },
  wTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: c.surfaceTertiary, overflow: "hidden" },
  wFill: { height: 10, borderRadius: 5, backgroundColor: c.borderStrong },
  wVal: { width: 72, textAlign: "right", fontSize: 12, color: c.onSurfaceTertiary, fontWeight: "600" },
}));
