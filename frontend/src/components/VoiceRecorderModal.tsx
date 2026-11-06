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
import { ActivityIndicator, Linking, Modal, Platform, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { API_URL, getAuthToken } from "@/src/api";
import Icon from "@/src/components/Icon";
import { makeStyles, useTheme } from "@/src/theme";
import { uploadForm } from "@/src/utils/upload";

type Phase = "idle" | "recording" | "uploading" | "denied" | "blocked" | "error";
const MAX_MS = 60000;
const MIN_MS = 1200;

export type NoteResult = { voice_note_id: string | null; note_text: string };

type Props = {
  visible: boolean;
  dishName: string;
  initialText?: string;
  initialVoiceId?: string | null;
  onClose: () => void;
  onSaved: (note: NoteResult) => void;
};

export default function VoiceRecorderModal({ visible, dishName, initialText, initialVoiceId, onClose, onSaved }: Props) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recState = useAudioRecorderState(recorder, 250);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const lastTranscript = useRef("");
  const startedAt = useRef(0);
  const session = useRef(0);
  const [notice, setNotice] = useState("");
  const busy = useRef(false);
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (visible) {
      setPhase("idle");
      setError("");
      setText(initialText ?? "");
      setVoiceId(initialVoiceId ?? null);
      setNotice("");
      lastTranscript.current = initialText ?? "";
    }
  }, [visible, initialText, initialVoiceId]);

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
    session.current += 1;
    setNotice("");
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
      startedAt.current = Date.now();
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
    const mySession = session.current;
    try {
      // keep recording a moment longer: very short inputs stay at least ~1.2 s and the
      // last syllable is not cut off when stop is tapped while still speaking
      const elapsed = Date.now() - startedAt.current;
      await new Promise((r) => setTimeout(r, Math.max(400, MIN_MS - elapsed)));
      if (session.current !== mySession) return; // modal closed or a new recording started meanwhile
      const durationMs = Date.now() - startedAt.current;
      await recorder.stop();
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      const uri = recorder.uri;
      if (!uri) throw Object.assign(new Error("Keine Aufnahme vorhanden"), { own: true });
      const isWeb = Platform.OS === "web";
      const webMp4 =
        isWeb && typeof MediaRecorder !== "undefined" && !MediaRecorder.isTypeSupported?.("audio/webm");
      const res = await uploadForm(`${API_URL}/voice-notes`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
        fields: { duration_ms: String(durationMs) },
        files: {
          // no mimeType on native: re-wrapping the native file Blob can lose its bytes;
          // the server derives the audio type from the file extension
          audio: isWeb
            ? webMp4
              ? { uri, name: "aufnahme.mp4", mimeType: "audio/mp4" }
              : { uri, name: "aufnahme.webm", mimeType: "audio/webm" }
            : { uri, name: "aufnahme.m4a" },
        },
      });
      if (!res.ok) {
        let msg = "Upload fehlgeschlagen";
        try {
          msg = (await res.json()).detail ?? msg;
        } catch {}
        throw Object.assign(new Error(msg), { own: true });
      }
      const data = (await res.json()) as { id: string; transcript: string };
      if (session.current !== mySession) return;
      setVoiceId(data.id);
      setNotice(
        data.transcript
          ? ""
          : "Kein Text erkannt. Die Aufnahme ist angehängt. Bitte deutlicher sprechen oder Mikrofon prüfen (im Emulator: ⋯ → Microphone → „Virtual microphone uses host audio input“).",
      );
      if (data.transcript) {
        setText((prev) => {
          const unedited = !prev.trim() || prev === lastTranscript.current;
          return unedited ? data.transcript : `${prev.trim()} ${data.transcript}`;
        });
        lastTranscript.current = data.transcript;
      }
      setPhase("idle");
    } catch (e: any) {
      console.log("record upload error", e);
      if (session.current !== mySession) return;
      setError(e?.own ? e.message : "Aufnahme fehlgeschlagen – bitte erneut versuchen.");
      setPhase("error");
    }
  };

  const close = () => {
    if (phase === "recording" || phase === "uploading") {
      session.current += 1; // abandon the running recording/upload
      try {
        if (recorder.isRecording) recorder.stop().catch(() => {});
      } catch {}
      setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {});
      if (watchdog.current) clearTimeout(watchdog.current);
    }
    onClose();
  };

  const seconds = Math.floor((recState.durationMillis ?? 0) / 1000);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.scrim}>
        <Pressable style={{ flex: 1 }} onPress={close} testID="voice-modal-backdrop" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} testID="voice-recorder-modal">
          <View style={styles.handle} />
          <Text style={styles.title}>Ergänzung</Text>
          <Text style={styles.subtitle}>{dishName}</Text>

          <Text style={styles.transcriptLabel}>Text (aufsprechen oder tippen)</Text>
          <TextInput
            testID="voice-note-text-input"
            value={text}
            onChangeText={setText}
            placeholder="z. B. ohne Zwiebeln, extra scharf"
            placeholderTextColor={colors.muted}
            multiline
            maxLength={300}
            style={styles.input}
            editable={phase !== "recording" && phase !== "uploading"}
          />

          {(phase === "idle" || phase === "recording" || phase === "denied") && (
            <View style={styles.micRow}>
              <Animated.View style={pulseStyle}>
                <Pressable
                  testID={phase === "recording" ? "voice-stop-button" : "voice-record-button"}
                  onPress={phase === "recording" ? stop : start}
                  style={[styles.micBtn, phase === "recording" && styles.micBtnRec]}
                  accessibilityLabel={phase === "recording" ? "Aufnahme beenden" : "Aufnahme starten"}
                >
                  <Icon name={phase === "recording" ? "stop" : "microphone"} size={32} color={colors.onBrandPrimary} />
                </Pressable>
              </Animated.View>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={styles.hintLeft} testID="voice-hint-text">
                  {phase === "recording"
                    ? `Aufnahme läuft… ${seconds}s – zum Beenden tippen`
                    : phase === "denied"
                      ? "Ohne Mikrofon keine Sprachnotiz. Erneut tippen, um den Zugriff zu erlauben."
                      : voiceId
                        ? "Tippen, um neu aufzunehmen."
                        : "Tippen und sprechen. Dafür wird das Mikrofon benötigt."}
                </Text>
                {voiceId && phase !== "recording" && (
                  <View style={styles.voiceRow} testID="voice-attached">
                    <Icon name="check-circle" size={16} color={colors.success} />
                    <Text style={styles.voiceText}>Aufnahme angehängt</Text>
                    <Pressable testID="voice-remove-audio-button" onPress={() => setVoiceId(null)} hitSlop={12}>
                      <Text style={styles.removeText}>entfernen</Text>
                    </Pressable>
                  </View>
                )}
                {!!notice && phase === "idle" && (
                  <Text style={styles.notice} testID="voice-no-text-notice">
                    {notice}
                  </Text>
                )}
              </View>
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
                Der Mikrofon-Zugriff ist blockiert. Bitte in den Einstellungen erlauben – oder den Text eintippen.
              </Text>
              <Pressable testID="voice-open-settings-button" style={styles.secondary} onPress={() => Linking.openSettings()}>
                <Text style={styles.secondaryText}>Einstellungen öffnen</Text>
              </Pressable>
            </View>
          )}

          {phase === "error" && (
            <View style={styles.center}>
              <Text style={[styles.hint, { color: colors.error }]} testID="voice-error-text">
                {error}
              </Text>
              <Pressable testID="voice-retry-button" style={styles.secondary} onPress={() => setPhase("idle")}>
                <Text style={styles.secondaryText}>Erneut versuchen</Text>
              </Pressable>
            </View>
          )}

          <View style={[styles.row, { marginTop: 16 }]}>
            <Pressable testID="voice-cancel-button" style={styles.secondary} onPress={close}>
              <Text style={styles.secondaryText}>Abbrechen</Text>
            </Pressable>
            <Pressable
              testID="voice-save-button"
              disabled={phase === "recording" || phase === "uploading"}
              style={[styles.primary, { flex: 1 }, (phase === "recording" || phase === "uploading") && { opacity: 0.45 }]}
              onPress={() => {
                onSaved({ voice_note_id: voiceId, note_text: text.trim() });
                onClose();
              }}
            >
              <Text style={styles.primaryText}>Übernehmen</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
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
  hintLeft: { fontSize: 14, color: c.onSurfaceTertiary, lineHeight: 20 },
  notice: { fontSize: 13, color: c.warning, fontWeight: "700", lineHeight: 18 },
  input: {
    minHeight: 72,
    maxHeight: 140,
    borderRadius: 12,
    backgroundColor: c.surfaceTertiary,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: c.onSurface,
    textAlignVertical: "top",
  },
  micRow: { flexDirection: "row", alignItems: "center", gap: 16, marginTop: 16 },
  voiceRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  voiceText: { fontSize: 13, color: c.success, fontWeight: "700" },
  removeText: { fontSize: 13, color: c.error, fontWeight: "700", textDecorationLine: "underline" },
  micBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
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
