"use client";

import { useEffect, useRef, useState } from "react";

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
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
 * Press-and-hold mic button.
 * onInterim → live (gray-italic) transcript while pressed.
 * onFinal   → committed transcript on release.
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

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    setSupported(!!SR);
  }, []);

  function start() {
    if (!supported) return;
    setError(null);
    finalRef.current = "";
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.continuous = false;
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
      setError(ev.error || "mic error");
    };
    rec.onend = () => {
      setActive(false);
      onFinal(finalRef.current.trim());
    };
    rec.start();
    recRef.current = rec;
    setActive(true);
  }

  function stop() {
    try {
      recRef.current?.stop();
    } catch {}
  }

  if (!supported) return null;

  return (
    <button
      type="button"
      title="Press and hold to dictate"
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      style={{
        appearance: "none",
        border: "1px solid var(--border)",
        background: active ? "var(--mta)" : "#fff",
        color: active ? "#fff" : "var(--ink)",
        cursor: "pointer",
        width: 42,
        height: 42,
        display: "grid",
        placeItems: "center",
        userSelect: "none",
        touchAction: "none",
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
        aria-label={error || "Mic"}
      >
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 10v2a7 7 0 0 0 14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="22" />
      </svg>
    </button>
  );
}
