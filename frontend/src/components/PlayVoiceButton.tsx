import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text } from "react-native";

import { voiceAudioUrl } from "@/src/api";
import Icon from "@/src/components/Icon";
import { useToast } from "@/src/toast";
import { makeStyles, useTheme } from "@/src/theme";

export default function PlayVoiceButton({ voiceNoteId, testID }: { voiceNoteId: string; testID?: string }) {
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const loaded = useRef(false);
  const [waiting, setWaiting] = useState(false);
  const toast = useToast();
  const { colors } = useTheme();
  const styles = useStyles();

  useEffect(() => {
    if (status.playing || status.didJustFinish) setWaiting(false);
    if (status.didJustFinish) {
      player.seekTo(0).catch(() => {});
      player.pause();
    }
  }, [status.playing, status.didJustFinish, player]);

  const onPress = async () => {
    try {
      if (status.playing) {
        player.pause();
        return;
      }
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      if (!loaded.current) {
        player.replace({ uri: voiceAudioUrl(voiceNoteId) });
        loaded.current = true;
        setWaiting(true);
      }
      player.play();
    } catch (e) {
      setWaiting(false);
      toast("Audio konnte nicht abgespielt werden", "error");
      console.log("playback error", e);
    }
  };

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [styles.btn, pressed && { opacity: 0.7 }]}
      accessibilityLabel={status.playing ? "Pause" : "Sprachnotiz abspielen"}
    >
      {waiting && !status.playing ? (
        <ActivityIndicator color={colors.onBrandSecondary} size="small" />
      ) : (
        <Icon name={status.playing ? "pause" : "play"} size={22} color={colors.onBrandSecondary} />
      )}
      <Text style={styles.label}>{status.playing ? "Pause" : "Anhören"}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: c.brandSecondary,
    alignSelf: "flex-start",
  },
  label: { color: c.onBrandSecondary, fontWeight: "700", fontSize: 14 },
}));
