import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type SpeechRecognitionAlternativeLike = {
    transcript: string;
    confidence: number;
};

type SpeechRecognitionResultLike = {
    isFinal: boolean;
    length: number;
    [index: number]: SpeechRecognitionAlternativeLike;
};

type SpeechRecognitionResultListLike = {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
};

type SpeechRecognitionEventLike = Event & {
    resultIndex: number;
    results: SpeechRecognitionResultListLike;
};

type SpeechRecognitionErrorEventLike = Event & {
    error: string;
    message: string;
};

type SpeechRecognitionLike = {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    maxAlternatives: number;
    onstart: (() => void) | null;
    onend: (() => void) | null;
    onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
    onresult: ((event: SpeechRecognitionEventLike) => void) | null;
    start: () => void;
    stop: () => void;
    abort: () => void;
};

type SpeechRecognitionConstructorLike = new () => SpeechRecognitionLike;

type SpeechRecognitionWindow = Window & {
    SpeechRecognition?: SpeechRecognitionConstructorLike;
    webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
};

export type BrowserSpeechStatus = "idle" | "starting" | "listening" | "processing" | "error";

export type BrowserSpeechErrorCode = "permissionDenied" | "serviceUnavailable" | "microphoneUnavailable" | "noSpeech" | "networkError" | "languageUnsupported" | "failed";

type Options = {
    language: string;
    onText: (text: string) => void;
};

function getSpeechRecognitionConstructor() {
    if (typeof window === "undefined") return null;
    const speechWindow = window as SpeechRecognitionWindow;
    return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition || null;
}

function errorCode(error: string): BrowserSpeechErrorCode {
    if (error === "not-allowed" || error === "permission-denied") return "permissionDenied";
    if (error === "service-not-allowed") return "serviceUnavailable";
    if (error === "audio-capture") return "microphoneUnavailable";
    if (error === "no-speech") return "noSpeech";
    if (error === "network") return "networkError";
    if (error === "language-not-supported") return "languageUnsupported";
    return "failed";
}

export function useBrowserSpeechInput({ language, onText }: Options) {
    const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
    const finalTextRef = useRef("");
    const interimTextRef = useRef("");
    const cancelledRef = useRef(false);
    const failedRef = useRef(false);
    const mountedRef = useRef(true);
    const onTextRef = useRef(onText);
    onTextRef.current = onText;

    const [status, setStatus] = useState<BrowserSpeechStatus>("idle");
    const [seconds, setSeconds] = useState(0);
    const [transcript, setTranscript] = useState("");
    const [error, setError] = useState<BrowserSpeechErrorCode | null>(null);
    const supported = useMemo(() => Boolean(getSpeechRecognitionConstructor()), []);

    useEffect(() => {
        if (status !== "listening") return;
        setSeconds(0);
        const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
        return () => window.clearInterval(timer);
    }, [status]);

    const resetSession = useCallback(() => {
        finalTextRef.current = "";
        interimTextRef.current = "";
        cancelledRef.current = false;
        failedRef.current = false;
        setSeconds(0);
        setTranscript("");
        setError(null);
    }, []);

    const cancel = useCallback(() => {
        cancelledRef.current = true;
        recognitionRef.current?.abort();
        recognitionRef.current = null;
        if (mountedRef.current) {
            setStatus("idle");
            setSeconds(0);
            setTranscript("");
            setError(null);
        }
    }, []);

    const stop = useCallback(() => {
        if (!recognitionRef.current) return;
        setStatus("processing");
        recognitionRef.current.stop();
    }, []);

    const start = useCallback(() => {
        if (status === "listening" || status === "starting") return;
        const Recognition = getSpeechRecognitionConstructor();
        if (!Recognition) {
            setStatus("error");
            setError("serviceUnavailable");
            return;
        }

        recognitionRef.current?.abort();
        resetSession();
        const recognition = new Recognition();
        recognition.lang = language;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        recognition.onstart = () => {
            if (mountedRef.current) setStatus("listening");
        };
        recognition.onresult = (event) => {
            let interim = "";
            for (let index = event.resultIndex; index < event.results.length; index += 1) {
                const result = event.results[index];
                const text = result?.[0]?.transcript || "";
                if (result?.isFinal) finalTextRef.current += text;
                else interim += text;
            }
            interimTextRef.current = interim;
            if (mountedRef.current) setTranscript(`${finalTextRef.current}${interim}`);
        };
        recognition.onerror = (event) => {
            if (event.error === "aborted" && cancelledRef.current) return;
            failedRef.current = true;
            if (mountedRef.current) {
                setStatus("error");
                setError(errorCode(event.error));
            }
        };
        recognition.onend = () => {
            recognitionRef.current = null;
            if (!mountedRef.current || cancelledRef.current) return;
            const text = `${finalTextRef.current}${interimTextRef.current}`.trim();
            if (text && !failedRef.current) {
                onTextRef.current(text);
                setStatus("idle");
                setTranscript("");
                setError(null);
            } else if (!failedRef.current) {
                setStatus("error");
                setError("noSpeech");
            }
        };

        recognitionRef.current = recognition;
        setStatus("starting");
        try {
            recognition.start();
        } catch {
            recognitionRef.current = null;
            setStatus("error");
            setError("failed");
        }
    }, [language, resetSession, status]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            cancelledRef.current = true;
            recognitionRef.current?.abort();
            recognitionRef.current = null;
        };
    }, []);

    return {
        supported,
        status,
        seconds,
        transcript,
        error,
        start,
        stop,
        cancel,
        clearError: cancel,
    };
}
