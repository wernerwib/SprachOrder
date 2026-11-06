import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, Bill, euro, HOME } from "@/src/api";
import { useAuth } from "@/src/auth";
import Icon from "@/src/components/Icon";
import { useToast } from "@/src/toast";
import { printReceipt, shareReceipt } from "@/src/receipt";
import { makeStyles, useTheme } from "@/src/theme";

export default function TableBill() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const table = Number(id);
  const { user, loading } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const [split, setSplit] = useState(false);
  const [sel, setSel] = useState<Record<number, number>>({});

  const q = useQuery({
    queryKey: ["bill", table],
    queryFn: () => api<Bill>(`/tables/${table}/bill`),
    refetchInterval: 3000,
    enabled: user?.role === "waiter",
  });

  const finish = (amount: number) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    toast(`Tisch ${table} abgeschlossen · ${euro(amount)}`, "success");
    qc.invalidateQueries();
    router.dismissTo("/waiter");
  };

  const close = useMutation({
    mutationFn: () => api<{ total: number }>(`/tables/${table}/close`, { method: "POST" }),
    onSuccess: (r) => finish(r.total),
    onError: (e: any) => toast(e?.message ?? "Fehler", "error"),
  });

  const pay = useMutation({
    mutationFn: () =>
      api<{ amount: number; closed: boolean }>(`/tables/${table}/pay`, {
        method: "POST",
        body: {
          lines: Object.entries(sel)
            .filter(([, n]) => n > 0)
            .map(([menu_id, qty]) => ({ menu_id: Number(menu_id), qty })),
        },
      }),
    onSuccess: (r) => {
      setSel({});
      setSplit(false);
      if (r.closed) {
        finish(r.amount);
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast(`Teilzahlung ${euro(r.amount)} erhalten`, "success");
      qc.invalidateQueries({ queryKey: ["bill", table] });
      qc.invalidateQueries({ queryKey: ["report"] });
    },
    onError: (e: any) => toast(e?.message ?? "Fehler", "error"),
  });

  if (loading) return null;
  if (!user) return <Redirect href="/login" />;
  if (user.role !== "waiter") return <Redirect href={HOME[user.role]} />;

  const bill = q.data;
  const empty = !bill || bill.lines.length === 0;
  const canClose = !!bill && !empty && bill.all_served;
  const selTotal = bill ? bill.lines.reduce((s, l) => s + (sel[l.menu_id] ?? 0) * l.price, 0) : 0;
  const setQty = (menuId: number, max: number, delta: number) =>
    setSel((s) => ({ ...s, [menuId]: Math.max(0, Math.min(max, (s[menuId] ?? 0) + delta)) }));

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable testID="bill-back-button" onPress={() => router.back()} style={styles.iconBtn} accessibilityLabel="Zurück">
          <Icon name="arrow-left" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>Rechnung</Text>
          <Text style={styles.title} numberOfLines={1} testID="bill-title">
            Tisch {table}
          </Text>
        </View>
        {!empty && bill && (
          <>
            <Pressable
              testID="bill-print-button"
              onPress={() => printReceipt(bill).catch(() => toast("Drucken nicht möglich", "error"))}
              style={[styles.iconBtn, styles.headBtn]}
              accessibilityLabel="Bon drucken"
            >
              <Icon name="printer-outline" size={22} color={colors.onSurface} />
            </Pressable>
            <Pressable
              testID="bill-share-button"
              onPress={() => shareReceipt(bill).catch(() => toast("Bon konnte nicht erstellt werden", "error"))}
              style={[styles.iconBtn, styles.headBtn]}
              accessibilityLabel="Bon als PDF teilen"
            >
              <Icon name="share-variant-outline" size={22} color={colors.onSurface} />
            </Pressable>
          </>
        )}
      </View>

      {q.isLoading ? (
        <ActivityIndicator style={{ marginTop: 48 }} size="large" color={colors.brandPrimary} />
      ) : q.isError ? (
        <View style={styles.center}>
          <Text style={{ color: colors.error }}>Rechnung konnte nicht geladen werden.</Text>
          <Pressable testID="bill-retry-button" onPress={() => q.refetch()} style={styles.secondary}>
            <Text style={styles.secondaryText}>Erneut versuchen</Text>
          </Pressable>
        </View>
      ) : empty ? (
        <View style={styles.center} testID="bill-empty">
          <Icon name="receipt-text-check-outline" size={48} color={colors.borderStrong} />
          <Text style={styles.emptyText}>Keine offene Rechnung für diesen Tisch.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 160 + insets.bottom }}>
          <Animated.View entering={FadeInDown} style={styles.receipt} testID="bill-receipt">
            <View style={styles.receiptHead}>
              <Icon name="pizza" size={22} color={colors.brandPrimary} />
              <Text style={styles.receiptBrand}>Pizzaiolo</Text>
            </View>
            <Text style={styles.receiptMeta}>
              Tisch {table} · {bill.orders} Bestellung(en) ·{" "}
              {new Date().toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
            </Text>
            <View style={styles.dashed} />
            {bill.lines.map((l) => (
              <View key={l.menu_id} style={styles.line} testID={`bill-line-${l.menu_id}`}>
                <Text style={styles.lineQty}>{l.qty}×</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lineName}>{l.name}</Text>
                  <Text style={styles.lineUnit}>
                    je {euro(l.price)}
                    {l.paid_qty > 0 ? ` · ${l.paid_qty} bezahlt` : ""}
                  </Text>
                </View>
                {split && l.open_qty > 0 ? (
                  <View style={styles.stepper}>
                    <Pressable
                      testID={`split-minus-${l.menu_id}`}
                      onPress={() => setQty(l.menu_id, l.open_qty, -1)}
                      style={styles.stepBtn}
                      accessibilityLabel="Weniger"
                    >
                      <Icon name="minus" size={18} color={colors.onSurface} />
                    </Pressable>
                    <Text style={styles.stepQty} testID={`split-qty-${l.menu_id}`}>
                      {sel[l.menu_id] ?? 0}/{l.open_qty}
                    </Text>
                    <Pressable
                      testID={`split-plus-${l.menu_id}`}
                      onPress={() => setQty(l.menu_id, l.open_qty, 1)}
                      style={styles.stepBtn}
                      accessibilityLabel="Mehr"
                    >
                      <Icon name="plus" size={18} color={colors.onSurface} />
                    </Pressable>
                  </View>
                ) : (
                  <Text style={[styles.lineAmount, l.open_qty === 0 && styles.paidAmount]}>{euro(l.amount)}</Text>
                )}
              </View>
            ))}
            <View style={styles.dashed} />
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Gesamt</Text>
              <Text style={styles.totalValue} testID="bill-total">
                {euro(bill.total)}
              </Text>
            </View>
            {bill.paid_total > 0 && (
              <>
                <View style={styles.subRow}>
                  <Text style={styles.subLabel}>Bereits bezahlt</Text>
                  <Text style={styles.subLabel} testID="bill-paid-total">
                    − {euro(bill.paid_total)}
                  </Text>
                </View>
                <View style={styles.subRow}>
                  <Text style={styles.openLabel}>Offen</Text>
                  <Text style={styles.openLabel} testID="bill-open-total">
                    {euro(bill.open_total)}
                  </Text>
                </View>
              </>
            )}
            <Text style={styles.vat}>inkl. MwSt.</Text>
          </Animated.View>
          {!bill.all_served && (
            <View style={styles.warn} testID="bill-not-served-warning">
              <Icon name="alert-circle-outline" size={20} color={colors.onWarning} />
              <Text style={styles.warnText}>Noch nicht alle Gerichte serviert – Abschluss erst danach möglich.</Text>
            </View>
          )}
        </ScrollView>
      )}

      {!empty && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
          {split ? (
            <View style={styles.footerRow}>
              <Pressable
                testID="split-cancel-button"
                onPress={() => {
                  setSplit(false);
                  setSel({});
                }}
                style={styles.secondaryBtn}
              >
                <Text style={styles.secondaryBtnText}>Zurück</Text>
              </Pressable>
              <Pressable
                testID="split-pay-button"
                disabled={selTotal === 0 || pay.isPending || !canClose}
                onPress={() => pay.mutate()}
                style={({ pressed }) => [
                  styles.primary,
                  { flex: 1 },
                  (selTotal === 0 || pay.isPending || !canClose) && { opacity: 0.45 },
                  pressed && { opacity: 0.85 },
                ]}
              >
                {pay.isPending ? (
                  <ActivityIndicator color={colors.onBrandPrimary} />
                ) : (
                  <Text style={styles.primaryText}>Auswahl bezahlen · {euro(selTotal)}</Text>
                )}
              </Pressable>
            </View>
          ) : (
            <View style={styles.footerRow}>
              <Pressable
                testID="bill-split-button"
                disabled={!canClose}
                onPress={() => setSplit(true)}
                style={[styles.secondaryBtn, !canClose && { opacity: 0.45 }]}
              >
                <Icon name="call-split" size={20} color={colors.onSurfaceTertiary} />
                <Text style={styles.secondaryBtnText}>Getrennt</Text>
              </Pressable>
              <Pressable
                testID="bill-close-table-button"
                disabled={!canClose || close.isPending}
                onPress={() => close.mutate()}
                style={({ pressed }) => [
                  styles.primary,
                  { flex: 1 },
                  (!canClose || close.isPending) && { opacity: 0.45 },
                  pressed && { opacity: 0.85 },
                ]}
              >
                {close.isPending ? (
                  <ActivityIndicator color={colors.onBrandPrimary} />
                ) : (
                  <>
                    <Icon name="cash-check" size={22} color={colors.onBrandPrimary} />
                    <Text style={styles.primaryText}>
                      {bill && bill.paid_total > 0 ? `Rest ${euro(bill.open_total)} kassieren` : "Bezahlt · abschließen"}
                    </Text>
                  </>
                )}
              </Pressable>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  stepper: { flexDirection: "row", alignItems: "center", gap: 4 },
  stepBtn: { width: 44, height: 44, borderRadius: 12, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  stepQty: { minWidth: 40, textAlign: "center", fontSize: 15, fontWeight: "800", color: c.onSurface },
  paidAmount: { color: c.muted, textDecorationLine: "line-through" },
  subRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  subLabel: { fontSize: 15, color: c.muted, fontWeight: "600" },
  openLabel: { fontSize: 18, color: c.brandPrimary, fontWeight: "800" },
  footerRow: { flexDirection: "row", gap: 10 },
  secondaryBtn: {
    flexDirection: "row",
    gap: 6,
    minHeight: 56,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: c.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: { color: c.onSurfaceTertiary, fontSize: 15, fontWeight: "700" },
  root: { flex: 1, backgroundColor: c.surfaceTertiary },
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
  title: { fontSize: 22, fontWeight: "800", color: c.onSurface },
  kicker: { fontSize: 12, fontWeight: "700", color: c.brandPrimary, textTransform: "uppercase", letterSpacing: 1 },
  headBtn: { backgroundColor: c.surfaceTertiary, marginLeft: 4 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
  emptyText: { color: c.muted, fontSize: 16, textAlign: "center" },
  receipt: { backgroundColor: c.surfaceSecondary, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: c.border },
  receiptHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  receiptBrand: { fontSize: 20, fontWeight: "800", color: c.onSurface },
  receiptMeta: { fontSize: 13, color: c.muted, marginTop: 4 },
  dashed: { borderBottomWidth: 1.5, borderStyle: "dashed", borderColor: c.borderStrong, marginVertical: 16 },
  line: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 },
  lineQty: { width: 36, fontSize: 17, fontWeight: "800", color: c.brandPrimary },
  lineName: { fontSize: 16, fontWeight: "700", color: c.onSurface },
  lineUnit: { fontSize: 13, color: c.muted },
  lineAmount: { fontSize: 16, fontWeight: "700", color: c.onSurface },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  totalLabel: { fontSize: 18, fontWeight: "800", color: c.onSurface },
  totalValue: { fontSize: 32, fontWeight: "800", color: c.onSurface },
  vat: { fontSize: 12, color: c.muted, textAlign: "right" },
  warn: { flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: c.warning, borderRadius: 12, padding: 12, marginTop: 12 },
  warnText: { flex: 1, color: c.onWarning, fontWeight: "700", fontSize: 14 },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 16,
    backgroundColor: c.surfaceSecondary,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  primary: {
    flexDirection: "row",
    gap: 8,
    minHeight: 56,
    borderRadius: 12,
    backgroundColor: c.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: c.onBrandPrimary, fontSize: 17, fontWeight: "800" },
  secondary: { minHeight: 44, paddingHorizontal: 20, borderRadius: 12, backgroundColor: c.surfaceSecondary, justifyContent: "center" },
  secondaryText: { color: c.onSurface, fontWeight: "700" },
}));
