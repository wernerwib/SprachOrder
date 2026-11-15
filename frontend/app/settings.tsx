import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, HOME, Settings } from "@/src/api";
import { useAuth } from "@/src/auth";
import Icon from "@/src/components/Icon";
import { qrDataUrl } from "@/src/receipt";
import { useToast } from "@/src/toast";
import { makeStyles, useTheme } from "@/src/theme";

export default function ReceiptSettings() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  const q = useQuery({ queryKey: ["settings"], queryFn: () => api<Settings>("/settings"), enabled: user?.role === "owner" });
  useEffect(() => {
    if (q.data) {
      setName(q.data.restaurant_name);
      setAddress(q.data.address);
      setUrl(q.data.review_url);
    }
  }, [q.data]);

  const save = useMutation({
    mutationFn: () =>
      api<Settings>("/settings", {
        method: "PUT",
        body: { restaurant_name: name.trim(), address: address.trim(), review_url: url.trim() },
      }),
    onSuccess: (s) => {
      qc.setQueryData(["settings"], s);
      toast("Bon-Einstellungen gespeichert", "success");
      if (router.canGoBack()) router.back();
      else router.replace("/owner");
    },
    onError: (e: any) => setError(e?.status === 422 ? "Bitte Eingaben prüfen (Link muss mit https:// beginnen)." : e?.message ?? "Fehler"),
  });

  if (loading) return null;
  if (!user) return <Redirect href="/login" />;
  if (user.role !== "owner") return <Redirect href={HOME[user.role]} />;

  const trimmedUrl = url.trim();
  const urlValid = trimmedUrl === "" || /^https:\/\/\S+$/.test(trimmedUrl);
  const valid = name.trim().length > 0 && urlValid;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable
          testID="settings-back-button"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/owner"))}
          style={styles.iconBtn}
          accessibilityLabel="Zurück"
        >
          <Icon name="arrow-left" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Bon-Einstellungen</Text>
      </View>

      {q.isLoading ? (
        <ActivityIndicator style={{ marginTop: 48 }} size="large" color={colors.brandPrimary} />
      ) : (
        <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 120 }}>
          <Text style={styles.label}>Name des Restaurants (oben auf dem Bon)</Text>
          <TextInput
            testID="settings-name-input"
            value={name}
            onChangeText={setName}
            maxLength={60}
            placeholder="Pizzaiolo"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <Text style={styles.label}>Adresse (optional)</Text>
          <TextInput
            testID="settings-address-input"
            value={address}
            onChangeText={setAddress}
            maxLength={120}
            placeholder="Hauptstraße 1, 10115 Berlin"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <Text style={styles.label}>Link zu Ihrer Google-Bewertung</Text>
          <TextInput
            testID="settings-review-url-input"
            value={url}
            onChangeText={(v) => {
              setUrl(v);
              setError("");
            }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            maxLength={300}
            placeholder="https://g.page/r/…/review"
            placeholderTextColor={colors.muted}
            style={[styles.input, !urlValid && { borderWidth: 1.5, borderColor: colors.error }]}
          />
          <Text style={styles.help}>
            So finden Sie den Link: Google-Unternehmensprofil öffnen → „Nach Rezensionen fragen“ → Link kopieren und hier einfügen.
            Leer lassen = kein QR-Code auf dem Bon.
          </Text>
          {!urlValid && <Text style={styles.error} testID="settings-url-error-text">Der Link muss mit https:// beginnen.</Text>}

          {urlValid && trimmedUrl !== "" && (
            <View style={styles.preview} testID="settings-qr-preview">
              <Text style={styles.previewTitle}>Hat es Ihnen geschmeckt?</Text>
              <Text style={styles.previewSub}>So erscheint der QR-Code auf jedem Bon</Text>
              <Image source={{ uri: qrDataUrl(trimmedUrl) }} style={styles.qr} contentFit="contain" />
            </View>
          )}
          {!!error && (
            <Text style={styles.error} testID="settings-error-text">
              {error}
            </Text>
          )}
        </KeyboardAwareScrollView>
      )}

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable
          testID="settings-save-button"
          disabled={!valid || save.isPending}
          onPress={() => save.mutate()}
          style={[styles.primary, (!valid || save.isPending) && { opacity: 0.45 }]}
        >
          {save.isPending ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Speichern</Text>}
        </Pressable>
      </View>
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
  help: { fontSize: 13, color: c.muted, lineHeight: 19, marginTop: -6, marginBottom: 12 },
  error: { color: c.error, fontSize: 14, fontWeight: "700", marginBottom: 8 },
  preview: { alignItems: "center", backgroundColor: c.surfaceSecondary, borderRadius: 20, borderWidth: 1, borderColor: c.border, padding: 20, marginTop: 8 },
  previewTitle: { fontSize: 17, fontWeight: "800", color: c.onSurface },
  previewSub: { fontSize: 13, color: c.muted, marginBottom: 12 },
  qr: { width: 160, height: 160 },
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
  primary: { minHeight: 56, borderRadius: 12, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center" },
  primaryText: { color: c.onBrandPrimary, fontSize: 17, fontWeight: "800" },
}));
