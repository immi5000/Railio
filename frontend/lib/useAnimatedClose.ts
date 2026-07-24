"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Animated dismissal for overlays (modals, drawers, lightboxes — DESIGN.md §7).
 *
 * Put `ref` on the overlay's root node and `data-closing={closing || undefined}`
 * on the nodes that carry exit keyframes, then route every close path through
 * `requestClose` instead of calling `onClose` directly. The exit keyframe plays,
 * and `onClose` fires on `animationend` (with a timeout safety net).
 *
 * If no CSS animation applies to the node — jsdom in vitest never loads
 * globals.css, and the check is synchronous — it closes instantly, which keeps
 * tests that assert synchronous unmount green. Under prefers-reduced-motion the
 * global kill switch shrinks the exit to ~0ms, so animationend fires on the
 * next frame with no special-casing here.
 */
export function useAnimatedClose<T extends HTMLElement = HTMLElement>(
  onClose: () => void,
  safetyMs = 400,
) {
  const ref = useRef<T | null>(null);
  const [closing, setClosing] = useState(false);
  const firedRef = useRef(false);

  const requestClose = useCallback(() => {
    const node = ref.current;
    if (!node || getComputedStyle(node).animationName === "none") {
      onClose();
      return;
    }
    if (firedRef.current) return; // already closing — ignore repeat Escapes
    firedRef.current = true;
    setClosing(true);
    let timer: ReturnType<typeof setTimeout>;
    const done = () => {
      node.removeEventListener("animationend", done);
      clearTimeout(timer);
      onClose();
    };
    node.addEventListener("animationend", done);
    timer = setTimeout(done, safetyMs);
  }, [onClose, safetyMs]);

  return { ref, closing, requestClose };
}
