"use client";
import { useEffect, useState } from "react";
import { onSoundPrefs, setMusic, setSfx, soundPrefs, unlockSound, type SoundPrefs } from "@/lib/sound";

/** Music (off by default) and sound effects (on after the first interaction), remembered per viewer. */
export default function SoundToggles() {
  const [p, setP] = useState<SoundPrefs | null>(null); // the server never guesses a viewer's choice
  useEffect(() => {
    setP(soundPrefs());
    const off = onSoundPrefs((n) => setP({ ...n }));
    // every gesture re-unlocks (cheap once running): iOS can suspend or interrupt the context at any time
    const touch = () => { unlockSound(); };
    window.addEventListener("pointerdown", touch, { capture: true, passive: true });
    window.addEventListener("keydown", touch, { capture: true, passive: true });
    return () => { off(); window.removeEventListener("pointerdown", touch, true); window.removeEventListener("keydown", touch, true); };
  }, []);
  const music = p?.music ?? false, fx = p?.sfx ?? true;
  return (
    <div className="sound" role="group" aria-label="Sound">
      <button type="button" className="snd" aria-pressed={music} title={music ? "Music on — turn it off" : "Music off — turn it on"}
        onClick={() => { unlockSound(); setMusic(!music); }}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18V6l10-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="16.5" cy="16" r="2.5" />{!music && <path d="M3 3l18 18" />}
        </svg>
        <span>Music</span>
      </button>
      <button type="button" className="snd" aria-pressed={fx} title={fx ? "Sound effects on — mute them" : "Sound effects muted — turn them on"}
        onClick={() => { unlockSound(); setSfx(!fx); }}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 9h4l5-4v14l-5-4H4z" />{fx ? <path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a8 8 0 0 1 0 11" /> : <path d="M16 9.5l5 5M21 9.5l-5 5" />}
        </svg>
        <span>Sound</span>
      </button>
    </div>
  );
}
