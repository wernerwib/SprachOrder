import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Platform, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, apiDelete, HOME, Staff } from "@/src/api";
import { useAuth } from "@/src/auth";
import Icon from "@/src/components/Icon";
import { useToast } from "@/src/toast";
import { makeStyles, useTheme } from "@/src/theme";

type Sheet =
  | { mode: "create" }
  | { mode: "own" }
  | { mode: "password"; staff: Staff }
  | { mode: "delete"; staff: Staff }
  | null;
const ROLE_LABEL = { waiter: "Kellner", kitchen: "Küche", owner: "Inhaber" } as const;

export default function StaffScreen() {
  const { user, loading, setSession } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const qc = useQueryClient();
  const toast = useToast();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<"waiter" | "kitchen">("waiter");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [sheetError, setSheetError] = useState("");
  const [currentPw, setCurrentPw] = useState("");

  useEffect(() => {
    if (sheet) {
      setDisplayName("");
      setUsername("");
      setRole("waiter");
      setPassword("");
      setShowPw(false);
      setSheetError("");
      setCurrentPw("");
    }
  }, [sheet]);

  const q = useQuery({ queryKey: ["staff"], queryFn: () => api<Staff[]>("/staff"), enabled: user?.role === "owner" });

  const onError = (e: any) => setSheetError(e?.message ?? "Fehler");
  const done = (msg: string) => {
    toast(msg, "success");
    setSheet(null);
    qc.invalidateQueries({ queryKey: ["staff"] });
    qc.invalidateQueries({ queryKey: ["security"] });
  };

  const changeOwn = useMutation({
    mutationFn: () =>
      api<{ access_token: string; user: Staff }>("/auth/change-password", {
        method: "POST",
        body: { current_password: currentPw.trim(), new_password: password.trim() },
      }),
    onSuccess: async (r) => {
      await setSession(r.access_token, r.user);
      done("Ihr Passwort wurde geändert");
    },
    onError,
  });

  const create = useMutation({
    mutationFn: () =>
      api<Staff>("/staff", {
        method: "POST",
        body: { display_name: displayName.trim(), username: username.trim().toLowerCase(), role, password: password.trim() },
      }),
    onSuccess: (s) => done(`${s.display_name} angelegt`),
    onError,
  });
  const reset = useMutation({
    mutationFn: (s: Staff) => api(`/staff/${s.username}/password`, { method: "PATCH", body: { password: password.trim() } }),
    onSuccess: (_r, s) => done(`Passwort für ${s.display_name} geändert`),
    onError,
  });
  const remove = useMutation({
    mutationFn: (s: Staff) => apiDelete(`/staff/${s.username}`),
    onSuccess: (_r, s) => done(`${s.display_name} entfernt`),
    onError,
  });

  if (loading) return null;
  if (!user) return <Redirect href="/login" />;
  if (user.role !== "owner") return <Redirect href={HOME[user.role]} />;

  const pwValid = password.trim().length >= 8;
  const userValid = /^[a-z0-9_.-]{3,32}$/.test(username.trim().toLowerCase());
  const createValid = displayName.trim().length > 0 && userValid && pwValid;
  const busy = create.isPending || reset.isPending || remove.isPending || changeOwn.isPending;

  const pwField = (
    <>
      <Text style={styles.label}>Passwort (mind. 8 Zeichen)</Text>
      <View style={styles.pwRow}>
        <TextInput
          testID="staff-password-input"
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPw}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          placeholder="Neues Passwort"
          placeholderTextColor={colors.muted}
          style={[styles.input, { flex: 1, marginBottom: 0, paddingRight: 52 }]}
        />
        <Pressable
          testID="staff-toggle-password-button"
          onPress={() => setShowPw((v) => !v)}
          style={styles.eyeBtn}
          accessibilityLabel={showPw ? "Passwort verbergen" : "Passwort anzeigen"}
        >
          <Icon name={showPw ? "eye-off-outline" : "eye-outline"} size={22} color={colors.muted} />
        </Pressable>
      </View>
    </>
  );

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable
          testID="staff-back-button"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/owner"))}
          style={styles.iconBtn}
          accessibilityLabel="Zurück"
        >
          <Icon name="arrow-left" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={[styles.title, { flex: 1 }]}>Personal</Text>
        <Pressable testID="staff-own-password-button" onPress={() => setSheet({ mode: "own" })} style={styles.ownBtn}>
          <Icon name="lock-reset" size={18} color={colors.onBrandSecondary} />
          <Text style={styles.ownBtnText}>Mein Passwort</Text>
        </Pressable>
      </View>
      {user.must_change_password && (
        <Pressable testID="staff-own-demo-warning" onPress={() => setSheet({ mode: "own" })} style={styles.warn}>
          <Icon name="shield-alert-outline" size={20} color={colors.onWarning} />
          <Text style={styles.warnText}>Sie nutzen noch das Demo-Passwort. Bitte jetzt ändern.</Text>
        </Pressable>
      )}

      {q.isLoading ? (
        <ActivityIndicator style={{ marginTop: 48 }} size="large" color={colors.brandPrimary} />
      ) : q.isError ? (
        <View style={styles.center}>
          <Text style={{ color: colors.error }}>Personal konnte nicht geladen werden.</Text>
          <Pressable testID="staff-retry-button" onPress={() => q.refetch()} style={styles.primary}>
            <Text style={styles.primaryText}>Erneut versuchen</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          testID="staff-list"
          data={q.data}
          keyExtractor={(s) => s.username}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 104, flexGrow: 1 }}
          ListHeaderComponent={<Text style={styles.hint}>Kellner und Küche melden sich mit diesen Zugängen an.</Text>}
          ListEmptyComponent={
            <View style={styles.center} testID="staff-empty">
              <Icon name="account-group-outline" size={48} color={colors.borderStrong} />
              <Text style={styles.muted}>Noch keine Mitarbeiter angelegt.</Text>
            </View>
          }
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.delay(index * 40)} style={styles.row} testID={`staff-row-${item.username}`}>
              <View style={[styles.avatar, item.role === "kitchen" && { backgroundColor: colors.surfaceTertiary }]}>
                <Icon
                  name={item.role === "kitchen" ? "chef-hat" : "room-service-outline"}
                  size={22}
                  color={item.role === "kitchen" ? colors.onSurfaceTertiary : colors.onBrandTertiary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.display_name}
                </Text>
                <Text style={styles.muted} numberOfLines={1}>
                  {ROLE_LABEL[item.role]} · {item.username}
                </Text>
                {item.must_change_password && (
                  <View style={styles.demoBadge} testID={`staff-demo-badge-${item.username}`}>
                    <Text style={styles.demoBadgeText}>Demo-Passwort – bitte ändern</Text>
                  </View>
                )}
              </View>
              <Pressable
                testID={`staff-reset-${item.username}`}
                onPress={() => setSheet({ mode: "password", staff: item })}
                style={styles.rowBtn}
                accessibilityLabel={`Passwort von ${item.display_name} ändern`}
              >
                <Icon name="key-variant" size={20} color={colors.onSurfaceTertiary} />
              </Pressable>
              <Pressable
                testID={`staff-delete-${item.username}`}
                onPress={() => setSheet({ mode: "delete", staff: item })}
                style={styles.rowBtn}
                accessibilityLabel={`${item.display_name} entfernen`}
              >
                <Icon name="trash-can-outline" size={20} color={colors.error} />
              </Pressable>
            </Animated.View>
          )}
        />
      )}

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable testID="staff-add-button" onPress={() => setSheet({ mode: "create" })} style={styles.primary}>
          <Icon name="account-plus-outline" size={22} color={colors.onBrandPrimary} />
          <Text style={styles.primaryText}>Neuer Zugang</Text>
        </Pressable>
      </View>

      <Modal visible={!!sheet} transparent animationType="fade" onRequestClose={() => setSheet(null)} statusBarTranslucent navigationBarTranslucent>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.scrim}>
          <Pressable style={{ flex: 1 }} onPress={() => setSheet(null)} testID="staff-sheet-backdrop" />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} testID="staff-sheet">
            <View style={styles.handle} />
            {sheet?.mode === "create" && (
              <>
                <Text style={styles.sheetTitle}>Neuer Zugang</Text>
                <View style={styles.roleRow}>
                  {(["waiter", "kitchen"] as const).map((r) => (
                    <Pressable
                      key={r}
                      testID={`staff-role-${r}`}
                      onPress={() => setRole(r)}
                      style={[styles.roleChip, role === r && styles.roleChipActive]}
                    >
                      <Icon
                        name={r === "kitchen" ? "chef-hat" : "room-service-outline"}
                        size={18}
                        color={role === r ? colors.onBrandSecondary : colors.onSurfaceTertiary}
                      />
                      <Text style={[styles.roleChipText, role === r && { color: colors.onBrandSecondary }]}>{ROLE_LABEL[r]}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.label}>Name (wird angezeigt)</Text>
                <TextInput
                  testID="staff-display-name-input"
                  value={displayName}
                  onChangeText={setDisplayName}
                  placeholder="z. B. Marco"
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                  maxLength={40}
                />
                <Text style={styles.label}>Benutzername (klein, ohne Leerzeichen)</Text>
                <TextInput
                  testID="staff-username-input"
                  value={username}
                  onChangeText={(v) => {
                    setUsername(v);
                    setSheetError("");
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="z. B. marco"
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                  maxLength={32}
                />
                {pwField}
              </>
            )}
            {sheet?.mode === "password" && (
              <>
                <Text style={styles.sheetTitle}>Passwort ändern</Text>
                <Text style={styles.sheetSub}>
                  {sheet.staff.display_name} ({sheet.staff.username}) wird beim nächsten Mal mit dem neuen Passwort angemeldet.
                </Text>
                {pwField}
              </>
            )}
            {sheet?.mode === "own" && (
              <>
                <Text style={styles.sheetTitle}>Mein Passwort ändern</Text>
                <Text style={styles.label}>Aktuelles Passwort</Text>
                <TextInput
                  testID="staff-current-password-input"
                  value={currentPw}
                  onChangeText={(v) => {
                    setCurrentPw(v);
                    setSheetError("");
                  }}
                  secureTextEntry={!showPw}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  placeholder="Aktuelles Passwort"
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                />
                {pwField}
              </>
            )}
            {sheet?.mode === "delete" && (
              <>
                <Text style={styles.sheetTitle}>Zugang entfernen?</Text>
                <Text style={styles.sheetSub}>
                  {sheet.staff.display_name} ({sheet.staff.username}) kann sich danach nicht mehr anmelden und wird innerhalb weniger Sekunden abgemeldet.
                  Bisherige Bestellungen bleiben erhalten.
                </Text>
              </>
            )}
            {!!sheetError && (
              <Text style={styles.sheetError} testID="staff-sheet-error">
                {sheetError}
              </Text>
            )}
            <View style={styles.sheetRow}>
              <Pressable testID="staff-sheet-cancel-button" onPress={() => setSheet(null)} style={styles.secondary}>
                <Text style={styles.secondaryText}>Abbrechen</Text>
              </Pressable>
              {sheet?.mode === "create" && (
                <Pressable
                  testID="staff-create-save-button"
                  disabled={!createValid || busy}
                  onPress={() => create.mutate()}
                  style={[styles.primary, { flex: 1 }, (!createValid || busy) && { opacity: 0.45 }]}
                >
                  {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Anlegen</Text>}
                </Pressable>
              )}
              {sheet?.mode === "password" && (
                <Pressable
                  testID="staff-password-save-button"
                  disabled={!pwValid || busy}
                  onPress={() => reset.mutate(sheet.staff)}
                  style={[styles.primary, { flex: 1 }, (!pwValid || busy) && { opacity: 0.45 }]}
                >
                  {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Speichern</Text>}
                </Pressable>
              )}
              {sheet?.mode === "own" && (
                <Pressable
                  testID="staff-own-password-save-button"
                  disabled={!pwValid || !currentPw.trim() || busy}
                  onPress={() => changeOwn.mutate()}
                  style={[styles.primary, { flex: 1 }, (!pwValid || !currentPw.trim() || busy) && { opacity: 0.45 }]}
                >
                  {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Ändern</Text>}
                </Pressable>
              )}
              {sheet?.mode === "delete" && (
                <Pressable
                  testID="staff-delete-confirm-button"
                  disabled={busy}
                  onPress={() => remove.mutate(sheet.staff)}
                  style={[styles.primary, { flex: 1, backgroundColor: colors.error }, busy && { opacity: 0.45 }]}
                >
                  {busy ? <ActivityIndicator color={colors.onError} /> : <Text style={[styles.primaryText, { color: colors.onError }]}>Entfernen</Text>}
                </Pressable>
              )}
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
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
  hint: { fontSize: 13, color: c.muted, marginBottom: 6 },
  muted: { fontSize: 13, color: c.muted },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: c.surfaceSecondary,
    borderRadius: 20,
    padding: 12,
    borderWidth: 1,
    borderColor: c.border,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.brandTertiary, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 16, fontWeight: "700", color: c.onSurface },
  rowBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center" },
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
  sheetTitle: { fontSize: 22, fontWeight: "800", color: c.onSurface, marginBottom: 12 },
  sheetSub: { fontSize: 14, color: c.onSurfaceTertiary, lineHeight: 20, marginBottom: 16 },
  sheetRow: { flexDirection: "row", gap: 10, marginTop: 8 },
  sheetError: { color: c.error, fontSize: 14, fontWeight: "700", marginBottom: 4 },
  ownBtn: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: 12, borderRadius: 999, backgroundColor: c.brandSecondary },
  ownBtnText: { color: c.onBrandSecondary, fontWeight: "700", fontSize: 14 },
  warn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.warning, margin: 16, marginBottom: 0, padding: 12, borderRadius: 12 },
  warnText: { flex: 1, color: c.onWarning, fontWeight: "700", fontSize: 14 },
  demoBadge: { alignSelf: "flex-start", backgroundColor: c.warning, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginTop: 4 },
  demoBadgeText: { color: c.onWarning, fontSize: 11, fontWeight: "800" },
  label: { fontSize: 13, fontWeight: "700", color: c.onSurfaceTertiary, marginBottom: 6 },
  input: {
    minHeight: 52,
    borderRadius: 12,
    backgroundColor: c.surfaceTertiary,
    paddingHorizontal: 16,
    fontSize: 16,
    color: c.onSurface,
    marginBottom: 14,
  },
  pwRow: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  eyeBtn: { position: "absolute", right: 4, width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  roleRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  roleChip: {
    flex: 1,
    flexDirection: "row",
    gap: 6,
    height: 44,
    borderRadius: 999,
    backgroundColor: c.surfaceTertiary,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: "center",
    justifyContent: "center",
  },
  roleChipActive: { backgroundColor: c.brandSecondary, borderColor: c.brandSecondary },
  roleChipText: { fontSize: 15, fontWeight: "700", color: c.onSurfaceTertiary },
}));
