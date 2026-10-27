// Dictation for a room's box: speech into the words, never sent by it.
//
// The same helper, the same grant checks and the same words as an
// agent's composer (src/components/Composer.tsx), which keeps its own
// copy inline for now. Dictation is only typing by voice, so it works in
// a room exactly as it does anywhere: what is heard is a draft to edit.
import { useEffect, useRef, useState } from "react";
import { Mic } from "@/components/icons";
import { RANK, TrayButton, type Notice } from "@/components/composer/Tray";
import { t, type MessageKey } from "@/lib/i18n";

/** What the helper's error words mean to a person. */
const SPEECH_TROUBLE: Record<string, MessageKey> = {
  "speech-not-authorized": "dictation.speech.notAuthorized",
  "recognizer-unavailable": "dictation.speech.recognizerUnavailable",
  "mic-failed": "dictation.speech.micFailed",
  "recognition-error": "dictation.speech.recognitionError",
};

/** Five bars that move with the voice, so listening never looks deaf. */
export function VoiceMeter({ level }: { level: number }) {
  const bars = [0.45, 0.75, 1, 0.75, 0.45];
  return (
    <span className="flex h-[17px] items-center gap-[2px]" aria-hidden>
      {bars.map((weight, i) => (
        <span
          key={i}
          className="w-[2px] rounded-full bg-current transition-[height] duration-100 ease-out"
          style={{ height: `${Math.max(3, Math.min(15, 3 + level * weight * 22))}px` }}
        />
      ))}
    </span>
  );
}

/**
 * Listening, and what it heard. `text` is what is in the box when it
 * starts, so speech is added to what was typed rather than replacing it;
 * `onText` is each new reading of the whole. `off` stops it, for a box
 * that is going away or can no longer send.
 */
export function useDictation(text: string, onText: (next: string) => void, off = false) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A standing denial: macOS will not ask again, so the pane is offered. */
  const [denied, setDenied] = useState(false);
  const [pane, setPane] = useState<"mic" | "speech">("mic");
  const [level, setLevel] = useState(0);
  const base = useRef("");
  const write = useRef(onText);
  write.current = onText;

  useEffect(() => {
    if (!recording) return;
    const bridge = window.bloks;
    if (!bridge) {
      setRecording(false);
      return;
    }
    setError(null);
    const offTranscript = bridge.onSpeechTranscript((line) => {
      if (typeof line.level === "number") {
        setLevel(Math.max(0, Math.min(1, line.level)));
        return;
      }
      if (typeof line.error === "string") {
        setRecording(false);
        setError(t(SPEECH_TROUBLE[line.error] ?? "dictation.speech.stoppedUnexpectedly"));
        setPane(line.error === "speech-not-authorized" ? "speech" : "mic");
        return;
      }
      if (typeof line.text === "string") write.current(base.current ? `${base.current} ${line.text}` : line.text);
    });
    const offEnd = bridge.onSpeechEnd(({ code }) => {
      setRecording(false);
      setLevel(0);
      if (code === 1) {
        setError((current) => current ?? t("dictation.speech.allowInSettings"));
      }
    });
    void bridge.speechStart();
    return () => {
      offTranscript();
      offEnd();
      void bridge.speechStop();
    };
  }, [recording]);

  // the microphone goes with the box, never on without it
  useEffect(() => {
    if (off && recording) setRecording(false);
  }, [off, recording]);

  /** Settles the grant first: a microphone macOS refused looked like a
   * button that did nothing. */
  const toggle = async () => {
    if (!window.bloks) return setError(t("dictation.speech.needsDesktop"));
    if (recording) return setRecording(false);
    setError(null);
    setDenied(false);
    const status = await window.bloks.permStatus().catch(() => null);
    let mic = status?.mic ?? "unknown";
    if (mic === "not-determined") mic = (await window.bloks.permRequestMic().catch(() => false)) ? "granted" : "denied";
    if (mic === "denied" || mic === "restricted") {
      setDenied(true);
      setError(t("dictation.speech.noMicAccess"));
      return;
    }
    base.current = text.trim();
    setRecording(true);
  };

  const notice: Notice | null = error
    ? {
        id: "speech",
        tone: "warn",
        rank: RANK.feedback,
        icon: <Mic size={14} />,
        title: error,
        actions: (denied || pane === "speech") && (
          <TrayButton onClick={() => void window.bloks?.permOpenSettings(pane)}>{t("dictation.openSettings")}</TrayButton>
        ),
        onDismiss: () => setError(null),
      }
    : null;

  return { recording, level, toggle, stop: () => setRecording(false), notice };
}
