import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HERO_IMAGE, HOME, Role, User } from "@/src/api";
import { useAuth } from "@/src/auth";
import Icon from "@/src/components/Icon";
import { makeStyles, useTheme } from "@/src/theme";

const TEST_ROLES: { role: Role; label: string; icon: "room-service-outline" | "chef-hat" | "store-outline" }[] = [
  { role: "waiter", label: "Kellner", icon: "room-service-outline" },
  { role: "kitchen", label: "Küche", icon: "chef-hat" },
  { role: "owner", label: "Inhaber", icon: "store-outline" },
];

export default function Login() {
  const { user, login, demoLogin } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);

  if (user) return <Redirect href={HOME[user.role]} />;

  const submit = () => run(() => login(username.trim().toLowerCase(), password.trim()));

  const run = async (fn: () => Promise<User>) => {
    setBusy(true);
    setError("");
    try {
      const u = await fn();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      router.replace(HOME[u.role]);
    } catch (e: any) {
      setError(e?.message ?? "Anmeldung fehlgeschlagen");
    } finally {
      setBusy(false);
    }
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
          <Text style={styles.subtitle}>Melden Sie sich mit Ihrem Zugang an. Die App öffnet automatisch Ihren Bereich.</Text>

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
          <View style={styles.pwRow}>
            <TextInput
              testID="login-password-input"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPw}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              style={[styles.input, { flex: 1, marginBottom: 0, paddingRight: 52 }]}
              placeholder="Passwort"
              placeholderTextColor={colors.muted}
              onSubmitEditing={submit}
              returnKeyType="go"
            />
            <Pressable
              testID="login-toggle-password-button"
              onPress={() => setShowPw((v) => !v)}
              style={styles.eyeBtn}
              accessibilityLabel={showPw ? "Passwort verbergen" : "Passwort anzeigen"}
            >
              <Icon name={showPw ? "eye-off-outline" : "eye-outline"} size={22} color={colors.muted} />
            </Pressable>
          </View>
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
          <Text style={styles.testTitle}>Test-Anmeldung (ohne Passwort)</Text>
          <View style={styles.testRow}>
            {TEST_ROLES.map((r) => (
              <Pressable
                key={r.role}
                testID={`demo-login-${r.role}-button`}
                disabled={busy}
                onPress={() => run(() => demoLogin(r.role))}
                style={({ pressed }) => [styles.testBtn, pressed && { opacity: 0.85 }]}
              >
                <Icon name={r.icon} size={22} color={colors.brandPrimary} />
                <Text style={styles.testBtnText}>{r.label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.demo} testID="login-help-text">
            Kein Zugang oder Passwort vergessen? Bitte wenden Sie sich an den Inhaber.
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
  pwRow: { flexDirection: "row", alignItems: "center", marginBottom: 16 },
  eyeBtn: { position: "absolute", right: 4, width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  submit: {
    minHeight: 56,
    borderRadius: 12,
    backgroundColor: c.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  submitText: { color: c.onBrandPrimary, fontSize: 17, fontWeight: "800" },
  testTitle: { fontSize: 13, fontWeight: "700", color: c.onSurfaceTertiary, marginTop: 28, marginBottom: 8, textAlign: "center" },
  testRow: { flexDirection: "row", gap: 8 },
  testBtn: {
    flex: 1,
    minHeight: 64,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: c.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  testBtnText: { color: c.brandPrimary, fontWeight: "800", fontSize: 14 },
  demo: { textAlign: "center", color: c.muted, fontSize: 13, marginTop: 16, lineHeight: 20 },
}));
