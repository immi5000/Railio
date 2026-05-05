"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
};

declare global {
  interface Window {
    SpeechRecognition?: { new (): SpeechRecognitionLike };
    webkitSpeechRecognition?: { new (): SpeechRecognitionLike };
  }
}

/**
 * Click-to-toggle mic button.
 *
 * Click once → starts dictation, button turns blue with a pulsing dot.
 * Click again → stops, commits the final transcript.
 *
 * `continuous = true` keeps it listening across natural pauses. Some browsers
 * (Chrome) still auto-end after ~60s of silence; we listen for `onend` and
 * restart if the user hasn't explicitly stopped.
 */
export function MicButton({
  onInterim,
  onFinal,
}: {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
}) {
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef("");
  // True only when the user clicks the button to stop. Lets `onend` decide
  // whether the end is "user wanted it" or "browser auto-stopped".
  const userStoppedRef = useRef(false);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    setSupported(!!SR);
  }, []);

  // Make sure we don't leave a recognizer running on unmount.
  useEffect(() => {
    return () => {
      try {
        recRef.current?.abort();
      } catch {}
      recRef.current = null;
    };
  }, []);

  const buildRecognizer = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.lang = "en-US";

    rec.onresult = (e: SpeechRecognitionEventLike) => {
      let interim = "";
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (finalText) finalRef.current += finalText;
      onInterim(finalRef.current + interim);
    };

    rec.onerror = (ev) => {
      // 'no-speech' fires after a quiet pause — not a real failure, swallow
      // and let `onend` auto-restart if the user is still active.
      if (ev.error === "no-speech" || ev.error === "aborted") return;
      const msg =
        ev.error === "not-allowed"
          ? "Microphone permission denied"
          : ev.error === "audio-capture"
            ? "No microphone detected"
            : ev.error === "network"
              ? "Speech service unavailable"
              : ev.error || "mic error";
      setError(msg);
    };

    rec.onend = () => {
      // If the user didn't stop, the browser auto-ended (silence/timeout).
      // Restart so dictation feels continuous.
      if (!userStoppedRef.current && recRef.current === rec) {
        try {
          rec.start();
          return;
        } catch {
          // Fall through and shut down cleanly.
        }
      }
      // Real stop: commit the final transcript.
      setActive(false);
      onFinal(finalRef.current.trim());
      finalRef.current = "";
      recRef.current = null;
    };

    return rec;
  }, [onInterim, onFinal]);

  const start = useCallback(() => {
    if (!supported || active) return;
    setError(null);
    finalRef.current = "";
    userStoppedRef.current = false;
    const rec = buildRecognizer();
    if (!rec) return;
    recRef.current = rec;
    setActive(true);
    try {
      rec.start();
    } catch (e) {
      // start() throws InvalidStateError if a session is already running —
      // recover by aborting and trying once more on the next tick.
      try {
        rec.abort();
      } catch {}
      setActive(false);
      recRef.current = null;
      setError(e instanceof Error ? e.message : "Could not start mic");
    }
  }, [active, buildRecognizer, supported]);

  const stop = useCallback(() => {
    if (!recRef.current) return;
    userStoppedRef.current = true;
    try {
      recRef.current.stop();
    } catch {
      try {
        recRef.current.abort();
      } catch {}
    }
  }, []);

  if (!supported) return null;

  return (
    <button
      type="button"
      title={
        error
          ? error
          : active
            ? "Click to stop dictation"
            : "Click to start dictation"
      }
      aria-pressed={active}
      onClick={() => (active ? stop() : start())}
      style={{
        appearance: "none",
        border: `1px solid ${active ? "var(--mta)" : "var(--border)"}`,
        background: active ? "var(--mta)" : "#fff",
        color: active ? "#fff" : "var(--ink)",
        cursor: "pointer",
        width: 42,
        height: 42,
        position: "relative",
        display: "grid",
        placeItems: "center",
        userSelect: "none",
        transition: "background 0.12s, border-color 0.12s, color 0.12s",
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        aria-label={error || (active ? "Listening" : "Mic")}
      >
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 10v2a7 7 0 0 0 14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="22" />
      </svg>
      {active && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 4,
            right: 4,
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "#fff",
            boxShadow: "0 0 0 0 rgba(255,255,255,.7)",
            animation: "dot 1.4s infinite",
          }}
        />
      )}
    </button>
  );
}
