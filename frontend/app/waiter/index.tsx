import { useQuery } from "@tanstack/react-query";
import { Redirect, useRouter } from "expo-router";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, euro, STATUS_LABEL, TableInfo } from "@/src/api";
import { useAuth } from "@/src/auth";
import Icon from "@/src/components/Icon";
import { makeStyles, ThemeColors, useTheme } from "@/src/theme";

const statusColor = (c: ThemeColors, s: TableInfo["status"]) =>
  ({ free: c.muted, new: c.info, preparing: c.warning, ready: c.success, billing: c.brandPrimary })[s];

export default function WaiterTables() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const q = useQuery({
    queryKey: ["tables"],
    queryFn: () => api<TableInfo[]>("/tables"),
    refetchInterval: 3000,
    enabled: user?.role === "waiter",
  });

  if (!user) return <Redirect href="/login" />;
  if (user.role !== "waiter") return <Redirect href="/kitchen" />;

  const readyCount = q.data?.filter((t) => t.status === "ready").length ?? 0;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>{user.display_name}</Text>
          <Text style={styles.title}>Tische</Text>
        </View>
        <Pressable
          testID="waiter-report-button"
          onPress={() => router.push("/report")}
          style={[styles.iconBtn, { marginRight: 8 }]}
          accessibilityLabel="Tagesumsatz"
        >
          <Icon name="chart-box-outline" size={22} color={colors.onSurfaceTertiary} />
        </Pressable>
        <Pressable testID="waiter-logout-button" onPress={logout} style={styles.iconBtn} accessibilityLabel="Abmelden">
          <Icon name="logout" size={22} color={colors.onSurfaceTertiary} />
        </Pressable>
      </View>
      {readyCount > 0 && (
        <View style={styles.banner} testID="waiter-ready-banner">
          <Icon name="bell-ring" size={20} color={colors.onSuccess} />
          <Text style={styles.bannerText}>
            {readyCount === 1 ? "1 Tisch hat abholbereites Essen" : `${readyCount} Tische haben abholbereites Essen`}
          </Text>
        </View>
      )}
      {q.isLoading ? (
        <ActivityIndicator style={{ marginTop: 48 }} size="large" color={colors.brandPrimary} />
      ) : q.isError ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>Tische konnten nicht geladen werden.</Text>
          <Pressable testID="tables-retry-button" onPress={() => q.refetch()} style={styles.retry}>
            <Text style={styles.retryText}>Erneut versuchen</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          testID="tables-grid"
          data={q.data}
          keyExtractor={(t) => String(t.table)}
          numColumns={2}
          columnWrapperStyle={{ gap: 12 }}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isLoading} onRefresh={q.refetch} />}
          renderItem={({ item, index }) => {
            const sc = statusColor(colors, item.status);
            return (
              <Animated.View entering={FadeInDown.delay(index * 40)} style={{ flex: 1 }}>
                <Pressable
                  testID={`table-tile-${item.table}`}
                  onPress={() => router.push(`/waiter/table/${item.table}`)}
                  style={({ pressed }) => [
                    styles.tile,
                    item.status !== "free" && { borderColor: sc },
                    pressed && { transform: [{ scale: 0.97 }] },
                  ]}
                >
                  <View style={styles.tileTop}>
                    <Text style={styles.tileLabel}>Tisch</Text>
                    <View style={[styles.pip, { backgroundColor: sc }]} />
                  </View>
                  <Text style={styles.tileNum}>{item.table}</Text>
                  <Text style={[styles.tileStatus, { color: sc }]} testID={`table-status-${item.table}`}>
                    {STATUS_LABEL[item.status]}
                  </Text>
                  <Text style={styles.tileTotal}>{item.status === "free" ? " " : euro(item.total)}</Text>
                </Pressable>
              </Animated.View>
            );
          }}
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: c.surface,
    borderBottomWidth: 1,
    borderBottomColor: c.divider,
  },
  kicker: { fontSize: 13, fontWeight: "700", color: c.brandPrimary, textTransform: "uppercase", letterSpacing: 1 },
  title: { fontSize: 32, fontWeight: "800", color: c.onSurface, letterSpacing: -0.5 },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: c.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: c.success,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
  },
  bannerText: { color: c.onSuccess, fontWeight: "700", fontSize: 14, flex: 1 },
  tile: {
    backgroundColor: c.surfaceSecondary,
    borderRadius: 20,
    padding: 16,
    borderWidth: 2,
    borderColor: c.border,
    minHeight: 140,
    shadowColor: c.onSurface,
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  tileTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  tileLabel: { fontSize: 13, color: c.muted, fontWeight: "600" },
  pip: { width: 10, height: 10, borderRadius: 5 },
  tileNum: { fontSize: 40, fontWeight: "800", color: c.onSurface, letterSpacing: -1 },
  tileStatus: { fontSize: 14, fontWeight: "700" },
  tileTotal: { fontSize: 13, color: c.muted, marginTop: 2 },
  center: { alignItems: "center", padding: 32, gap: 16 },
  errorText: { color: c.error, fontSize: 15 },
  retry: { minHeight: 44, paddingHorizontal: 20, borderRadius: 12, backgroundColor: c.brandPrimary, justifyContent: "center" },
  retryText: { color: c.onBrandPrimary, fontWeight: "700" },
}));
