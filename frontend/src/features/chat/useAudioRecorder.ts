import { useEffect, useRef, useState } from "react";

/** Ogg/Opus é o formato nativo de áudio do WhatsApp; webm/opus é o que o Chrome grava. */
const PREFERRED_TYPES = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm"];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  return PREFERRED_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

export function audioRecordingSupported(): boolean {
  return typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

export function useAudioRecorder() {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  function cleanup() {
    clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    setRecording(false);
    setSeconds(0);
  }

  useEffect(() => cleanup, []);

  async function start(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    streamRef.current = stream;
    recorderRef.current = recorder;
    recorder.start();
    setRecording(true);
    setSeconds(0);
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  }

  /** Encerra a gravação e devolve o arquivo; `null` se nada foi gravado. */
  function stop(): Promise<File | null> {
    const recorder = recorderRef.current;
    if (!recorder) return Promise.resolve(null);
    return new Promise((resolve) => {
      recorder.onstop = () => {
        const type = (recorder.mimeType || "audio/webm").split(";")[0]!;
        const blob = new Blob(chunksRef.current, { type });
        cleanup();
        if (blob.size === 0) return resolve(null);
        const ext = type.includes("ogg") ? "ogg" : "webm";
        resolve(new File([blob], `audio-${Date.now()}.${ext}`, { type }));
      };
      recorder.stop();
    });
  }

  function cancel(): void {
    const recorder = recorderRef.current;
    if (recorder) {
      recorder.onstop = null;
      if (recorder.state !== "inactive") recorder.stop();
    }
    cleanup();
  }

  return { recording, seconds, start, stop, cancel };
}
