import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HERO_IMAGE, HOME, Role } from "@/src/api";
import { useAuth } from "@/src/auth";
import Icon from "@/src/components/Icon";
import { makeStyles, useTheme } from "@/src/theme";

const DEFAULT_USER: Record<Role, string> = { waiter: "kellner1", kitchen: "kueche", owner: "inhaber" };

export default function Login() {
  const { user, login } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const [role, setRole] = useState<Role>("waiter");
  const [username, setUsername] = useState(DEFAULT_USER.waiter);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) return <Redirect href={HOME[user.role]} />;

  const pickRole = (r: Role) => {
    setRole(r);
    setUsername(DEFAULT_USER[r]);
    setPassword("");
    setError("");
  };

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const u = await login(username.trim().toLowerCase(), password);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      router.replace(HOME[u.role]);
    } catch (e: any) {
      setError(e?.message ?? "Anmeldung fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  const RoleCard = ({ r, icon, label, sub }: { r: Role; icon: string; label: string; sub: string }) => {
    const active = role === r;
    return (
      <Pressable
        testID={`login-role-${r}`}
        onPress={() => pickRole(r)}
        style={[styles.roleCard, active && styles.roleCardActive]}
      >
        <View style={[styles.roleIcon, active && { backgroundColor: colors.brandPrimary }]}>
          <Icon name={icon as any} size={26} color={active ? colors.onBrandPrimary : colors.onBrandTertiary} />
        </View>
        <Text style={styles.roleLabel}>{label}</Text>
        <Text style={styles.roleSub}>{sub}</Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.root}>
      <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        <View style={styles.hero}>
          <Image source={{ uri: HERO_IMAGE }} style={{ flex: 1 }} contentFit="cover" transition={300} />
          <LinearGradient colors={["transparent", colors.surface]} style={styles.heroScrim} />
          <View style={[styles.brandRow, { top: insets.top + 16 }]}>
            <Icon name="pizza" size={22} color={colors.onBrandPrimary} />
            <Text style={styles.brandText}>Pizzaiolo</Text>
          </View>
        </View>

        <View style={styles.body}>
          <Text style={styles.title}>Willkommen zurück</Text>
          <Text style={styles.subtitle}>Wählen Sie Ihren Bereich und melden Sie sich an.</Text>

          <View style={styles.roleRow}>
            <RoleCard r="waiter" icon="room-service-outline" label="Kellner" sub="Tische" />
            <RoleCard r="kitchen" icon="chef-hat" label="Küche" sub="Tickets" />
            <RoleCard r="owner" icon="store-cog-outline" label="Inhaber" sub="Speisekarte" />
          </View>

          <Text style={styles.label}>Benutzername</Text>
          <TextInput
            testID="login-username-input"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
            placeholder="Benutzername"
            placeholderTextColor={colors.muted}
          />
          <Text style={styles.label}>Passwort</Text>
          <TextInput
            testID="login-password-input"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            style={styles.input}
            placeholder="Passwort"
            placeholderTextColor={colors.muted}
            onSubmitEditing={submit}
            returnKeyType="go"
          />
          {!!error && (
            <Text style={styles.error} testID="login-error-text">
              {error}
            </Text>
          )}
          <Pressable
            testID="login-submit-button"
            onPress={submit}
            disabled={busy || !username || !password}
            style={({ pressed }) => [
              styles.submit,
              (busy || !username || !password) && { opacity: 0.5 },
              pressed && { opacity: 0.85 },
            ]}
          >
            {busy ? (
              <ActivityIndicator color={colors.onBrandPrimary} />
            ) : (
              <Text style={styles.submitText}>Anmelden</Text>
            )}
          </Pressable>
          <Text style={styles.demo} testID="login-demo-hint">
            Demo: kellner1 / kellner2 · Kellner123!{"\n"}Küche: kueche · Kueche123!{"\n"}Inhaber: inhaber · Inhaber123!
          </Text>
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  hero: { height: 280 },
  heroScrim: { position: "absolute", left: 0, right: 0, bottom: 0, height: 160 },
  brandRow: {
    position: "absolute",
    left: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: c.brandPrimary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  brandText: { color: c.onBrandPrimary, fontWeight: "800", fontSize: 16, letterSpacing: 0.5 },
  body: { paddingHorizontal: 24, marginTop: -24 },
  title: { fontSize: 32, fontWeight: "800", color: c.onSurface, letterSpacing: -0.5 },
  subtitle: { fontSize: 15, color: c.muted, marginTop: 4, marginBottom: 24 },
  roleRow: { flexDirection: "row", gap: 8, marginBottom: 24 },
  roleCard: {
    flex: 1,
    padding: 12,
    borderRadius: 20,
    backgroundColor: c.surfaceSecondary,
    borderWidth: 1.5,
    borderColor: c.border,
    gap: 6,
  },
  roleCardActive: { borderColor: c.brandPrimary, backgroundColor: c.brandTertiary },
  roleIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: c.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  roleLabel: { fontSize: 16, fontWeight: "800", color: c.onSurface },
  roleSub: { fontSize: 12, color: c.muted },
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
  error: { color: c.error, fontSize: 14, marginBottom: 12, fontWeight: "600" },
  submit: {
    minHeight: 56,
    borderRadius: 12,
    backgroundColor: c.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  submitText: { color: c.onBrandPrimary, fontSize: 17, fontWeight: "800" },
  demo: { textAlign: "center", color: c.muted, fontSize: 13, marginTop: 16, lineHeight: 20 },
}));
