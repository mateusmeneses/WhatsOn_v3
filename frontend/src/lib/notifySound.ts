import { useSyncExternalStore } from "react";

const KEY = "whatson.sound";
const CHANGE = "whatson:sound-change";

export function isSoundEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(KEY, enabled ? "1" : "0");
  } catch {
    // preferência não persistida: vale só até recarregar
  }
  window.dispatchEvent(new Event(CHANGE));
}

function subscribe(listener: () => void): () => void {
  window.addEventListener(CHANGE, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGE, listener);
    window.removeEventListener("storage", listener);
  };
}

/** Preferência "avisar com som" (por navegador). */
export function useSoundEnabled(): boolean {
  return useSyncExternalStore(subscribe, isSoundEnabled, () => false);
}

let context: AudioContext | null = null;

/** Dois tons curtos e suaves. Falha em silêncio (navegador sem áudio ou sem interação prévia do usuário). */
export function playChime(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    context ??= new Ctx();
    if (context.state === "suspended") void context.resume();
    const start = context.currentTime;
    [660, 880].forEach((frequency, i) => {
      const osc = context!.createOscillator();
      const gain = context!.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;
      const t = start + i * 0.16;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      osc.connect(gain).connect(context!.destination);
      osc.start(t);
      osc.stop(t + 0.32);
    });
  } catch {
    // sem áudio: o contador no menu e no título continua avisando
  }
}

/** Alarme de atendimento sem resposta: três bipes fortes, duas vezes. Toca mesmo com o aviso sonoro desligado. */
export function playAlarm(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    context ??= new Ctx();
    if (context.state === "suspended") void context.resume();
    const start = context.currentTime;
    for (let i = 0; i < 6; i += 1) {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = "square";
      osc.frequency.value = i % 2 === 0 ? 988 : 784;
      const t = start + i * 0.22 + (i >= 3 ? 0.5 : 0);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(gain).connect(context.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    }
  } catch {
    // sem áudio: o pop-up e o aviso na tela continuam
  }
}
