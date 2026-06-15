import { useCallback, useEffect, useRef, useState } from "react";

/** Delay before restarting recognition after Chrome ends a session (e.g. pause between words). */
const RESTART_DELAY_MS = 120;

type SpeechRecognitionResultList = {
  length: number;
  resultIndex?: number;
  [index: number]: { isFinal: boolean; [index: number]: { transcript: string } };
};

type SpeechRecognitionResultEvent = {
  resultIndex: number;
  results: SpeechRecognitionResultList;
};

type SpeechRecognitionError = {
  error: string;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  processLocally?: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionError) => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  onsoundstart: (() => void) | null;
  onsoundend: (() => void) | null;
};

type SpeechRecognitionStatic = {
  available?: (opts: { langs: string[]; processLocally: boolean }) => Promise<string>;
  install?: (opts: { langs: string[]; processLocally: boolean }) => Promise<boolean>;
};

/** Only one SpeechRecognition instance may run at a time (LoanWizardV2 uses three hooks). */
let activeMicSessionStop: (() => void) | null = null;

function claimMicSession(stop: () => void) {
  if (activeMicSessionStop && activeMicSessionStop !== stop) {
    activeMicSessionStop();
  }
  activeMicSessionStop = stop;
}

function releaseMicSession(stop: () => void) {
  if (activeMicSessionStop === stop) activeMicSessionStop = null;
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

function getSpeechRecognitionStatic(): SpeechRecognitionStatic | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as Window & { SpeechRecognition?: SpeechRecognitionStatic };
  return w.SpeechRecognition;
}

/**
 * Prefer on-device recognition only when the language pack is installed.
 * Forcing processLocally without install() causes language-not-supported errors.
 */
async function configureRecognitionMode(recognition: SpeechRecognitionLike): Promise<boolean> {
  if (!("processLocally" in recognition)) {
    recognition.processLocally = false;
    return false;
  }

  const SR = getSpeechRecognitionStatic();
  if (!SR?.available) {
    recognition.processLocally = false;
    return false;
  }

  try {
    let status = await SR.available({ langs: ["en-US"], processLocally: true });
    if (status === "downloadable" && SR.install) {
      await SR.install({ langs: ["en-US"], processLocally: true });
      status = await SR.available({ langs: ["en-US"], processLocally: true });
    }
    if (status === "available") {
      recognition.processLocally = true;
      return true;
    }
  } catch {
    /* use cloud */
  }

  recognition.processLocally = false;
  return false;
}

function messageForSpeechError(code: string, usingLocal: boolean): string {
  switch (code) {
    case "not-allowed":
      return "Microphone access was denied. Allow the mic in browser settings.";
    case "service-not-allowed":
      return "Speech recognition is blocked on this page. Use HTTPS or check browser settings.";
    case "no-speech":
      return "No speech detected. Try again.";
    case "network":
      return "Speech recognition needs a network connection in this browser.";
    case "audio-capture":
      return "No microphone found, or it is in use by another app.";
    case "language-not-supported":
      return usingLocal
        ? "On-device speech is not ready. Switched to cloud recognition — try again."
        : "Speech recognition is not available for English in this browser.";
    default:
      return `Could not capture speech (${code}). Try again.`;
  }
}

function joinTranscript(...parts: string[]): string {
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

function readSessionTranscript(results: SpeechRecognitionResultList): {
  sessionFinal: string;
  interim: string;
} {
  let sessionFinal = "";
  let interim = "";
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const piece = result[0]?.transcript ?? "";
    if (result.isFinal) sessionFinal += piece;
    else interim += piece;
  }
  return { sessionFinal, interim };
}

export function useSpeechToText() {
  const [isSupported, setIsSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const userListeningRef = useRef(false);
  const baseTextRef = useRef("");
  const committedFinalRef = useRef("");
  const sessionFinalRef = useRef("");
  const restartTimerRef = useRef<number | null>(null);
  const speakingTimeoutRef = useRef<number | null>(null);
  const modeConfiguredRef = useRef(false);
  const usingLocalRef = useRef(false);
  const stopListeningRef = useRef<() => void>(() => {});

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const commitSessionFinal = useCallback(() => {
    const sessionFinal = sessionFinalRef.current.trim();
    if (!sessionFinal) return;
    committedFinalRef.current = joinTranscript(committedFinalRef.current, sessionFinal);
    sessionFinalRef.current = "";
  }, []);

  const clearSpeakingSoon = useCallback(() => {
    if (speakingTimeoutRef.current) window.clearTimeout(speakingTimeoutRef.current);
    speakingTimeoutRef.current = window.setTimeout(() => setIsSpeaking(false), 700);
  }, []);

  const markSpeaking = useCallback(() => {
    if (speakingTimeoutRef.current) window.clearTimeout(speakingTimeoutRef.current);
    setIsSpeaking(true);
  }, []);

  const scheduleRestart = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition || !userListeningRef.current) return;

    clearRestartTimer();
    restartTimerRef.current = window.setTimeout(() => {
      restartTimerRef.current = null;
      if (!userListeningRef.current) return;
      try {
        recognition.start();
      } catch {
        restartTimerRef.current = window.setTimeout(() => {
          restartTimerRef.current = null;
          if (!userListeningRef.current) return;
          try {
            recognition.start();
          } catch {
            userListeningRef.current = false;
            setIsListening(false);
            setIsSpeaking(false);
            releaseMicSession(stopListeningRef.current);
            setError("Could not keep the microphone open. Try clicking the mic again.");
          }
        }, RESTART_DELAY_MS);
      }
    }, RESTART_DELAY_MS);
  }, [clearRestartTimer]);

  const fallbackToCloudRecognition = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition || !("processLocally" in recognition)) return false;
    if (!recognition.processLocally) return false;
    recognition.processLocally = false;
    usingLocalRef.current = false;
    return true;
  }, []);

  useEffect(() => {
    const Ctor = getSpeechRecognitionCtor();
    setIsSupported(!!Ctor);
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.processLocally = false;

    recognition.onresult = (event) => {
      const { sessionFinal, interim } = readSessionTranscript(event.results);
      sessionFinalRef.current = sessionFinal;

      if (interim.trim() || sessionFinal.trim()) markSpeaking();
      else clearSpeakingSoon();

      setLiveTranscript(
        joinTranscript(baseTextRef.current, committedFinalRef.current, sessionFinal, interim),
      );
    };

    recognition.onend = () => {
      commitSessionFinal();
      if (userListeningRef.current) {
        scheduleRestart();
        return;
      }
      setIsListening(false);
      setIsSpeaking(false);
    };

    recognition.onerror = (event) => {
      const code = event.error;

      if (code === "aborted") return;

      if (code === "busy") {
        if (userListeningRef.current) scheduleRestart();
        return;
      }

      if (code === "no-speech" || code === "network") {
        if (userListeningRef.current) {
          scheduleRestart();
          return;
        }
        setError(messageForSpeechError(code, usingLocalRef.current));
        return;
      }

      if (code === "language-not-supported" && fallbackToCloudRecognition()) {
        if (userListeningRef.current) {
          scheduleRestart();
          return;
        }
      }

      setError(messageForSpeechError(code, usingLocalRef.current));

      if (code !== "no-speech" && code !== "network") {
        userListeningRef.current = false;
        setIsListening(false);
        setIsSpeaking(false);
        releaseMicSession(stopListeningRef.current);
      }
    };

    recognition.onspeechstart = markSpeaking;
    recognition.onspeechend = clearSpeakingSoon;
    recognition.onsoundstart = markSpeaking;
    recognition.onsoundend = clearSpeakingSoon;

    recognitionRef.current = recognition;

    return () => {
      userListeningRef.current = false;
      clearRestartTimer();
      releaseMicSession(stopListeningRef.current);
      recognition.onresult = null;
      recognition.onend = null;
      recognition.onerror = null;
      recognition.onspeechstart = null;
      recognition.onspeechend = null;
      recognition.onsoundstart = null;
      recognition.onsoundend = null;
      if (speakingTimeoutRef.current) window.clearTimeout(speakingTimeoutRef.current);
      try {
        recognition.abort();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
      modeConfiguredRef.current = false;
    };
  }, [
    clearRestartTimer,
    clearSpeakingSoon,
    commitSessionFinal,
    fallbackToCloudRecognition,
    markSpeaking,
    scheduleRestart,
  ]);

  const stopListening = useCallback(() => {
    userListeningRef.current = false;
    clearRestartTimer();
    commitSessionFinal();
    releaseMicSession(stopListeningRef.current);

    const recognition = recognitionRef.current;
    if (!recognition) {
      setIsListening(false);
      setIsSpeaking(false);
      setLiveTranscript(joinTranscript(baseTextRef.current, committedFinalRef.current));
      return;
    }
    try {
      recognition.stop();
    } catch {
      try {
        recognition.abort();
      } catch {
        /* ignore */
      }
    }
    setIsListening(false);
    setIsSpeaking(false);
    setLiveTranscript(joinTranscript(baseTextRef.current, committedFinalRef.current));
  }, [clearRestartTimer, commitSessionFinal]);

  stopListeningRef.current = stopListening;

  const startListening = useCallback(
    async (baseText = "") => {
      const recognition = recognitionRef.current;
      if (!recognition) return false;

      setError(null);
      clearRestartTimer();
      claimMicSession(stopListeningRef.current);

      if (!modeConfiguredRef.current) {
        usingLocalRef.current = await configureRecognitionMode(recognition);
        modeConfiguredRef.current = true;
      }

      baseTextRef.current = baseText;
      committedFinalRef.current = "";
      sessionFinalRef.current = "";
      setLiveTranscript(baseText.trim());
      userListeningRef.current = true;

      try {
        recognition.start();
        setIsListening(true);
        setIsSpeaking(false);
        return true;
      } catch {
        userListeningRef.current = false;
        releaseMicSession(stopListeningRef.current);
        setError("Microphone is already in use. Stop other tabs or apps using the mic.");
        setIsListening(false);
        return false;
      }
    },
    [clearRestartTimer],
  );

  const toggleListening = useCallback(
    (baseText = "") => {
      if (isListening) {
        stopListening();
        return;
      }
      void startListening(baseText);
    },
    [isListening, startListening, stopListening],
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    isSupported,
    isListening,
    isSpeaking,
    liveTranscript,
    error,
    startListening,
    stopListening,
    toggleListening,
    clearError,
  };
}
