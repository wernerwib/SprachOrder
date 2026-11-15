import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Platform, Pressable, Switch, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, euro, HOME, MENU_IMAGES, MenuItem } from "@/src/api";
import { useAuth } from "@/src/auth";
import Icon from "@/src/components/Icon";
import { useToast } from "@/src/toast";
import { makeStyles, useTheme } from "@/src/theme";

type Editing = { id?: number; name: string; price: string } | null;

export default function OwnerMenu() {
  const { user, logout, loading } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Editing>(null);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");

  useEffect(() => {
    if (editing) {
      setName(editing.name);
      setPrice(editing.price);
    }
  }, [editing]);

  const q = useQuery({ queryKey: ["menu"], queryFn: () => api<MenuItem[]>("/menu"), enabled: user?.role === "owner" });
  const securityQ = useQuery({
    queryKey: ["security"],
    queryFn: () => api<{ default_password_users: { username: string; role: string }[] }>("/security/status"),
    enabled: user?.role === "owner",
  });

  const save = useMutation({
    mutationFn: (v: { id?: number; name: string; price: number }) =>
      v.id
        ? api<MenuItem>(`/menu/${v.id}`, { method: "PATCH", body: { name: v.name, price: v.price } })
        : api<MenuItem>("/menu", { method: "POST", body: { name: v.name, price: v.price } }),
    onSuccess: (m, v) => {
      toast(v.id ? `${m.name} gespeichert` : `${m.name} hinzugefügt`, "success");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["menu"] });
    },
    onError: (e: any) => toast(e?.message ?? "Speichern fehlgeschlagen", "error"),
  });

  const toggle = useMutation({
    mutationFn: (m: MenuItem) => api<MenuItem>(`/menu/${m.id}`, { method: "PATCH", body: { available: !m.available } }),
    onMutate: async (m) => {
      await qc.cancelQueries({ queryKey: ["menu"] });
      const prev = qc.getQueryData<MenuItem[]>(["menu"]);
      qc.setQueryData<MenuItem[]>(["menu"], (old) => old?.map((x) => (x.id === m.id ? { ...x, available: !m.available } : x)));
      return { prev };
    },
    onError: (e: any, _m, ctx) => {
      if (ctx?.prev) qc.setQueryData(["menu"], ctx.prev);
      toast(e?.message ?? "Fehler", "error");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["menu"] }),
  });

  if (loading) return null;
  if (!user) return <Redirect href="/login" />;
  if (user.role !== "owner") return <Redirect href={HOME[user.role]} />;

  const parsedPrice = Number(price.replace(",", "."));
  const valid = name.trim().length > 0 && Number.isFinite(parsedPrice) && parsedPrice > 0 && parsedPrice <= 999;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>{user.display_name}</Text>
          <Text style={styles.title}>Speisekarte</Text>
        </View>
        <Pressable
          testID="owner-staff-button"
          onPress={() => router.push("/staff")}
          style={[styles.iconBtn, { marginRight: 8 }]}
          accessibilityLabel="Personal verwalten"
        >
          <Icon name="account-group-outline" size={22} color={colors.onSurfaceTertiary} />
        </Pressable>
        <Pressable
          testID="owner-report-button"
          onPress={() => router.push("/report")}
          style={[styles.iconBtn, { marginRight: 8 }]}
          accessibilityLabel="Tagesumsatz"
        >
          <Icon name="chart-box-outline" size={22} color={colors.onSurfaceTertiary} />
        </Pressable>
        <Pressable testID="owner-logout-button" onPress={logout} style={styles.iconBtn} accessibilityLabel="Abmelden">
          <Icon name="logout" size={22} color={colors.onSurfaceTertiary} />
        </Pressable>
      </View>

      {q.isLoading ? (
        <ActivityIndicator style={{ marginTop: 48 }} size="large" color={colors.brandPrimary} />
      ) : q.isError ? (
        <View style={styles.center}>
          <Text style={{ color: colors.error }}>Speisekarte konnte nicht geladen werden.</Text>
          <Pressable testID="owner-retry-button" onPress={() => q.refetch()} style={styles.primary}>
            <Text style={styles.primaryText}>Erneut versuchen</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          testID="owner-menu-list"
          data={q.data}
          keyExtractor={(m) => String(m.id)}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 104 }}
          ListHeaderComponent={
            <View style={{ gap: 10, marginBottom: 6 }}>
              {!!securityQ.data?.default_password_users.length && (
                <Pressable testID="owner-security-banner" onPress={() => router.push("/staff")} style={styles.banner}>
                  <Icon name="shield-alert-outline" size={22} color={colors.onWarning} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.bannerTitle}>Demo-Passwörter noch aktiv</Text>
                    <Text style={styles.bannerText}>
                      {securityQ.data.default_password_users.map((u) => u.username).join(", ")} – vor dem Start bitte ändern
                    </Text>
                  </View>
                  <Icon name="chevron-right" size={22} color={colors.onWarning} />
                </Pressable>
              )}
              <Pressable testID="owner-receipt-settings-button" onPress={() => router.push("/settings")} style={styles.settingsRow}>
                <Icon name="qrcode" size={22} color={colors.onBrandTertiary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.settingsTitle}>Bon & Google-Bewertung</Text>
                  <Text style={styles.settingsText}>Name, Adresse und QR-Code auf dem Bon</Text>
                </View>
                <Icon name="chevron-right" size={22} color={colors.onBrandTertiary} />
              </Pressable>
              <Text style={styles.hint}>Ausgeschaltete Gerichte sehen die Kellner nicht mehr auf der Speisekarte.</Text>
            </View>
          }
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.delay(index * 40)} style={[styles.row, !item.available && { opacity: 0.6 }]} testID={`owner-menu-item-${item.id}`}>
              {item.image && MENU_IMAGES[item.image] ? (
                <Image source={{ uri: MENU_IMAGES[item.image] }} style={styles.thumb} contentFit="cover" transition={200} />
              ) : (
                <View style={[styles.thumb, styles.thumbPlaceholder]}>
                  <Icon name="pizza" size={28} color={colors.onBrandTertiary} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>
                  <Text style={styles.no}>{item.id}  </Text>
                  {item.name}
                </Text>
                <Text style={styles.price} testID={`owner-menu-price-${item.id}`}>
                  {euro(item.price)} · {item.available ? "verfügbar" : "ausgeblendet"}
                </Text>
              </View>
              <Pressable
                testID={`owner-edit-${item.id}`}
                onPress={() => setEditing({ id: item.id, name: item.name, price: item.price.toFixed(2).replace(".", ",") })}
                style={styles.editBtn}
                accessibilityLabel={`${item.name} bearbeiten`}
              >
                <Icon name="pencil" size={20} color={colors.onSurfaceTertiary} />
              </Pressable>
              <Switch
                testID={`owner-toggle-${item.id}`}
                value={item.available}
                onValueChange={() => toggle.mutate(item)}
                trackColor={{ true: colors.success, false: colors.borderStrong }}
                thumbColor={colors.surfaceSecondary}
              />
            </Animated.View>
          )}
        />
      )}

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable testID="owner-add-dish-button" onPress={() => setEditing({ name: "", price: "" })} style={styles.primary}>
          <Icon name="plus" size={22} color={colors.onBrandPrimary} />
          <Text style={styles.primaryText}>Neues Gericht</Text>
        </Pressable>
      </View>

      <Modal visible={!!editing} transparent animationType="fade" onRequestClose={() => setEditing(null)} statusBarTranslucent navigationBarTranslucent>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.scrim}>
          <Pressable style={{ flex: 1 }} onPress={() => setEditing(null)} testID="owner-edit-backdrop" />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} testID="owner-edit-sheet">
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>{editing?.id ? "Gericht bearbeiten" : "Neues Gericht"}</Text>
            <Text style={styles.label}>Name</Text>
            <TextInput
              testID="owner-name-input"
              value={name}
              onChangeText={setName}
              placeholder="z. B. Pizza Diavola"
              placeholderTextColor={colors.muted}
              style={styles.input}
              maxLength={60}
              returnKeyType="next"
            />
            <Text style={styles.label}>Preis in Euro</Text>
            <TextInput
              testID="owner-price-input"
              value={price}
              onChangeText={setPrice}
              placeholder="z. B. 13,50"
              placeholderTextColor={colors.muted}
              keyboardType="decimal-pad"
              style={styles.input}
            />
            <View style={styles.sheetRow}>
              <Pressable testID="owner-edit-cancel-button" onPress={() => setEditing(null)} style={styles.secondary}>
                <Text style={styles.secondaryText}>Abbrechen</Text>
              </Pressable>
              <Pressable
                testID="owner-edit-save-button"
                disabled={!valid || save.isPending}
                onPress={() => save.mutate({ id: editing?.id, name: name.trim(), price: Math.round(parsedPrice * 100) / 100 })}
                style={[styles.primary, { flex: 1 }, (!valid || save.isPending) && { opacity: 0.45 }]}
              >
                {save.isPending ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Speichern</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  center: { alignItems: "center", padding: 32, gap: 16 },
  hint: { fontSize: 13, color: c.muted, marginBottom: 6 },
  banner: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.warning, borderRadius: 12, padding: 12 },
  bannerTitle: { color: c.onWarning, fontWeight: "800", fontSize: 15 },
  bannerText: { color: c.onWarning, fontSize: 13 },
  settingsRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.brandTertiary, borderRadius: 12, padding: 12, minHeight: 56 },
  settingsTitle: { color: c.onBrandTertiary, fontWeight: "800", fontSize: 15 },
  settingsText: { color: c.onBrandTertiary, fontSize: 13 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: c.surfaceSecondary,
    borderRadius: 20,
    padding: 10,
    borderWidth: 1,
    borderColor: c.border,
  },
  thumb: { width: 56, height: 56, borderRadius: 12 },
  thumbPlaceholder: { backgroundColor: c.brandTertiary, alignItems: "center", justifyContent: "center" },
  no: { color: c.brandPrimary, fontWeight: "800" },
  name: { fontSize: 16, fontWeight: "700", color: c.onSurface },
  price: { fontSize: 13, color: c.muted, marginTop: 2 },
  editBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceTertiary },
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
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: c.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: c.onBrandPrimary, fontSize: 17, fontWeight: "800" },
  secondary: { minHeight: 56, paddingHorizontal: 20, borderRadius: 12, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  secondaryText: { color: c.onSurfaceTertiary, fontSize: 16, fontWeight: "700" },
  scrim: { flex: 1, backgroundColor: c.scrim },
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 12 },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: c.borderStrong, marginBottom: 16 },
  sheetTitle: { fontSize: 22, fontWeight: "800", color: c.onSurface, marginBottom: 16 },
  label: { fontSize: 13, fontWeight: "700", color: c.onSurfaceTertiary, marginBottom: 6 },
  input: {
    minHeight: 52,
    borderRadius: 12,
    backgroundColor: c.surfaceTertiary,
    paddingHorizontal: 16,
    fontSize: 16,
    color: c.onSurface,
    marginBottom: 16,
  },
  sheetRow: { flexDirection: "row", gap: 10 },
}));
