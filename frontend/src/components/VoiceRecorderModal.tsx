import {
  getRecordingPermissionsAsync,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Modal, Platform, Pressable, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { API_URL, getAuthToken } from "@/src/api";
import Icon from "@/src/components/Icon";
import { makeStyles, useTheme } from "@/src/theme";
import { uploadForm } from "@/src/utils/upload";

type Phase = "idle" | "recording" | "uploading" | "done" | "denied" | "blocked" | "error";
const MAX_MS = 60000;

type Props = {
  visible: boolean;
  dishName: string;
  onClose: () => void;
  onSaved: (note: { id: string; transcript: string }) => void;
};

export default function VoiceRecorderModal({ visible, dishName, onClose, onSaved }: Props) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recState = useAudioRecorderState(recorder, 250);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ id: string; transcript: string } | null>(null);
  const busy = useRef(false);
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (visible) {
      setPhase("idle");
      setResult(null);
      setError("");
    }
  }, [visible]);

  useEffect(() => {
    pulse.value = phase === "recording" ? withRepeat(withTiming(1.15, { duration: 600 }), -1, true) : withTiming(1);
  }, [phase, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  useEffect(
    () => () => {
      if (watchdog.current) clearTimeout(watchdog.current);
      try {
        if (recorder.isRecording) recorder.stop().catch(() => {});
      } catch {
        // already released
      }
    },
    [recorder],
  );

  const start = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      let perm = await getRecordingPermissionsAsync();
      if (!perm.granted) {
        if (!perm.canAskAgain && perm.status === "denied") {
          setPhase("blocked");
          return;
        }
        perm = await requestRecordingPermissionsAsync();
        if (!perm.granted) {
          setPhase(perm.canAskAgain ? "denied" : "blocked");
          return;
        }
      }
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setPhase("recording");
      watchdog.current = setTimeout(() => stop(), MAX_MS);
    } catch (e) {
      console.log("record start error", e);
      setError("Aufnahme konnte nicht gestartet werden.");
      setPhase("error");
    } finally {
      busy.current = false;
    }
  };

  const stop = async () => {
    if (watchdog.current) clearTimeout(watchdog.current);
    setPhase("uploading");
    try {
      await recorder.stop();
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      const uri = recorder.uri;
      if (!uri) throw new Error("Keine Aufnahme vorhanden");
      const isWeb = Platform.OS === "web";
      const res = await uploadForm(`${API_URL}/voice-notes`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
        files: {
          audio: {
            uri,
            name: isWeb ? "aufnahme.webm" : "aufnahme.m4a",
            mimeType: isWeb ? "audio/webm" : "audio/m4a",
          },
        },
      });
      if (!res.ok) {
        let msg = "Upload fehlgeschlagen";
        try {
          msg = (await res.json()).detail ?? msg;
        } catch {}
        throw new Error(msg);
      }
      const data = (await res.json()) as { id: string; transcript: string };
      setResult(data);
      setPhase("done");
    } catch (e: any) {
      console.log("record upload error", e);
      setError(e?.message ?? "Upload fehlgeschlagen");
      setPhase("error");
    }
  };

  const close = () => {
    if (phase === "recording") {
      try {
        recorder.stop().catch(() => {});
      } catch {}
      if (watchdog.current) clearTimeout(watchdog.current);
    }
    onClose();
  };

  const seconds = Math.floor((recState.durationMillis ?? 0) / 1000);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.scrim}>
        <Pressable style={{ flex: 1 }} onPress={close} testID="voice-modal-backdrop" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]} testID="voice-recorder-modal">
          <View style={styles.handle} />
          <Text style={styles.title}>Ergänzung aufsprechen</Text>
          <Text style={styles.subtitle}>{dishName}</Text>

          {(phase === "idle" || phase === "recording" || phase === "denied") && (
            <View style={styles.center}>
              <Text style={styles.hint} testID="voice-hint-text">
                {phase === "recording"
                  ? `Aufnahme läuft… ${seconds}s – zum Beenden tippen`
                  : phase === "denied"
                    ? "Ohne Mikrofon kann keine Sprachnotiz aufgenommen werden. Tippen Sie erneut, um den Zugriff zu erlauben."
                    : "Tippen Sie auf das Mikrofon und sprechen Sie z. B. „ohne Zwiebeln, extra scharf“. Dafür wird der Mikrofon-Zugriff benötigt."}
              </Text>
              <Animated.View style={pulseStyle}>
                <Pressable
                  testID={phase === "recording" ? "voice-stop-button" : "voice-record-button"}
                  onPress={phase === "recording" ? stop : start}
                  style={[styles.micBtn, phase === "recording" && styles.micBtnRec]}
                  accessibilityLabel={phase === "recording" ? "Aufnahme beenden" : "Aufnahme starten"}
                >
                  <Icon
                    name={phase === "recording" ? "stop" : "microphone"}
                    size={44}
                    color={colors.onBrandPrimary}
                  />
                </Pressable>
              </Animated.View>
            </View>
          )}

          {phase === "uploading" && (
            <View style={styles.center} testID="voice-uploading">
              <ActivityIndicator size="large" color={colors.brandPrimary} />
              <Text style={styles.hint}>Wird übertragen und in Text umgewandelt…</Text>
            </View>
          )}

          {phase === "blocked" && (
            <View style={styles.center}>
              <Text style={styles.hint}>
                Der Mikrofon-Zugriff ist blockiert. Bitte in den Einstellungen erlauben.
              </Text>
              <Pressable testID="voice-open-settings-button" style={styles.primary} onPress={() => Linking.openSettings()}>
                <Text style={styles.primaryText}>Einstellungen öffnen</Text>
              </Pressable>
            </View>
          )}

          {phase === "error" && (
            <View style={styles.center}>
              <Text style={[styles.hint, { color: colors.error }]} testID="voice-error-text">
                {error}
              </Text>
              <Pressable testID="voice-retry-button" style={styles.primary} onPress={() => setPhase("idle")}>
                <Text style={styles.primaryText}>Erneut versuchen</Text>
              </Pressable>
            </View>
          )}

          {phase === "done" && result && (
            <View style={{ gap: 16 }}>
              <View style={styles.transcriptBox}>
                <Text style={styles.transcriptLabel}>Erkannter Text</Text>
                <Text style={styles.transcript} testID="voice-transcript-text">
                  {result.transcript || "(Kein Text erkannt – die Audioaufnahme wird trotzdem gespeichert)"}
                </Text>
              </View>
              <View style={styles.row}>
                <Pressable testID="voice-rerecord-button" style={styles.secondary} onPress={() => setPhase("idle")}>
                  <Text style={styles.secondaryText}>Neu aufnehmen</Text>
                </Pressable>
                <Pressable
                  testID="voice-save-button"
                  style={[styles.primary, { flex: 1 }]}
                  onPress={() => {
                    onSaved(result);
                    onClose();
                  }}
                >
                  <Text style={styles.primaryText}>Übernehmen</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  scrim: { flex: 1, backgroundColor: c.scrim },
  sheet: {
    backgroundColor: c.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: c.borderStrong, marginBottom: 16 },
  title: { fontSize: 22, fontWeight: "800", color: c.onSurface },
  subtitle: { fontSize: 15, color: c.muted, marginTop: 4, marginBottom: 16 },
  center: { alignItems: "center", gap: 24, paddingVertical: 16 },
  hint: { fontSize: 15, color: c.onSurfaceTertiary, textAlign: "center", lineHeight: 22 },
  micBtn: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: c.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  micBtnRec: { backgroundColor: c.error },
  transcriptBox: { backgroundColor: c.brandTertiary, borderRadius: 12, padding: 16 },
  transcriptLabel: { fontSize: 12, fontWeight: "700", color: c.onBrandTertiary, textTransform: "uppercase", marginBottom: 6 },
  transcript: { fontSize: 17, color: c.onSurface, lineHeight: 24 },
  row: { flexDirection: "row", gap: 12 },
  primary: {
    minHeight: 52,
    borderRadius: 12,
    backgroundColor: c.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  primaryText: { color: c.onBrandPrimary, fontSize: 16, fontWeight: "700" },
  secondary: {
    minHeight: 52,
    borderRadius: 12,
    backgroundColor: c.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  secondaryText: { color: c.onSurfaceTertiary, fontSize: 16, fontWeight: "700" },
}));
