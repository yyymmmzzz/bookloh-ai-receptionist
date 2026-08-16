"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";

type CallStatus = "idle" | "connecting" | "connected" | "ended" | "error";

interface TranscriptLine {
  role: "user" | "assistant" | "system";
  text: string;
  ts: number;
  isFinal: boolean;
}

interface ToolCallLog {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
  ts: number;
}

interface LogEntry {
  ts: number;
  type: "info" | "warn" | "error" | "tool" | "function-call" | "speech" | "status";
  message: string;
}

export default function TestCallPage() {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCallLog[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [duration, setDuration] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const vapiRef = useRef<any>(null);
  const callRef = useRef<any>(null);
  const startedAtRef = useRef<number>(0);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const logsRef = useRef<HTMLDivElement>(null);

  // Update duration every second when connected
  useEffect(() => {
    if (status !== "connected") return;
    const interval = setInterval(() => {
      setDuration(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 500);
    return () => clearInterval(interval);
  }, [status]);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" });
  }, [transcript]);

  useEffect(() => {
    logsRef.current?.scrollTo({ top: logsRef.current.scrollHeight, behavior: "smooth" });
  }, [logs]);

  const addLog = useCallback((type: LogEntry["type"], message: string) => {
    setLogs((prev) => [...prev, { ts: Date.now(), type, message }]);
  }, []);

  const startCall = useCallback(async () => {
    setErrorMsg(null);
    setTranscript([]);
    setToolCalls([]);
    setLogs([]);
    setDuration(0);
    setStatus("connecting");
    addLog("info", "Initializing Vapi SDK...");

    try {
      const publicKey = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY;
      const assistantId = process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID;

      if (!publicKey || !assistantId) {
        throw new Error("Missing NEXT_PUBLIC_VAPI_PUBLIC_KEY or NEXT_PUBLIC_VAPI_ASSISTANT_ID");
      }

      const Vapi = (await import("@vapi-ai/web")).default;
      const vapi = new Vapi(publicKey);
      vapiRef.current = vapi;

      vapi.on("call-start", () => {
        addLog("status", "✓ Call started — you should hear the AI greeting");
        startedAtRef.current = Date.now();
        setStatus("connected");
      });

      vapi.on("call-end", () => {
        addLog("status", "■ Call ended");
        setStatus("ended");
      });

      vapi.on("speech-start", () => {
        addLog("speech", "🎤 User started speaking");
      });

      vapi.on("speech-end", () => {
        addLog("speech", "🔇 User stopped speaking");
      });

      vapi.on("volume-level", (volume: number) => {
        setMicLevel(volume);
      });

      vapi.on("message", (msg: any) => {
        if (msg.type === "transcript") {
          setTranscript((prev) => [
            ...prev,
            {
              role: msg.role,
              text: msg.transcript,
              ts: Date.now(),
              isFinal: msg.transcriptType === "final",
            },
          ]);
          if (msg.transcriptType === "final") {
            addLog("info", `💬 ${msg.role}: ${msg.transcript.slice(0, 100)}${msg.transcript.length > 100 ? "..." : ""}`);
          }
        } else if (msg.type === "tool-calls" || msg.type === "function-call") {
          const calls = msg.toolCalls || (msg.functionCall ? [msg.functionCall] : []);
          calls.forEach((tc: any) => {
            const name = tc.function?.name || tc.name || "unknown";
            const args = tc.function?.arguments || tc.parameters || {};
            addLog("tool", `🔧 ${name}(${JSON.stringify(args).slice(0, 80)})`);
            setToolCalls((prev) => [
              ...prev,
              {
                id: tc.id || `tc_${Date.now()}_${Math.random()}`,
                name,
                args,
                result: tc.function?.result || tc.result,
                ts: Date.now(),
              },
            ]);
          });
        } else if (msg.type === "error") {
          addLog("error", `❌ Error: ${JSON.stringify(msg)}`);
        }
      });

      vapi.on("error", (err: any) => {
        addLog("error", `❌ Vapi error: ${err?.message || JSON.stringify(err)}`);
        setErrorMsg(err?.message || String(err));
        setStatus("error");
      });

      addLog("info", `Starting call with assistant ${assistantId}...`);
      const call = await vapi.start(assistantId);
      callRef.current = call;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog("error", `Failed to start: ${msg}`);
      setErrorMsg(msg);
      setStatus("error");
    }
  }, [addLog]);

  const stopCall = useCallback(() => {
    callRef.current?.stop?.();
    vapiRef.current?.stop?.();
    addLog("info", "Stopping call...");
  }, [addLog]);

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vapi Test Call</h1>
          <p className="text-sm text-gray-500 mt-1">
            Browser-based test — no phone number needed. Use your microphone to talk to the AI.
          </p>
        </div>
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-700">
          ← Back to dashboard
        </Link>
      </div>

      {/* Status banner */}
      <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center gap-3">
        <div className="text-blue-600 text-lg">🧪</div>
        <div className="flex-1 text-sm text-blue-900">
          <strong>Test mode.</strong> This page uses Vapi Web SDK in your browser. Microphone access required.
          Note: tool calls won't reach your server yet (no public URL) — you'll see them logged but no work order will be created.
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <div className="flex items-center gap-4">
          {status === "idle" || status === "ended" || status === "error" ? (
            <button
              onClick={startCall}
              className="inline-flex items-center gap-2 px-6 py-3 bg-orange-500 text-white text-base font-semibold rounded-md hover:bg-orange-600"
            >
              🎙️ Start test call
            </button>
          ) : (
            <button
              onClick={stopCall}
              className="inline-flex items-center gap-2 px-6 py-3 bg-red-500 text-white text-base font-semibold rounded-md hover:bg-red-600"
            >
              ⏹️ End call
            </button>
          )}

          <div className="flex items-center gap-2 text-sm">
            <StatusDot status={status} />
            <span className="font-medium text-gray-700">
              {status === "idle" && "Ready"}
              {status === "connecting" && "Connecting..."}
              {status === "connected" && `Connected · ${formatDuration(duration)}`}
              {status === "ended" && "Call ended"}
              {status === "error" && "Error"}
            </span>
          </div>

          {status === "connected" && (
            <div className="flex-1 flex items-center gap-2 ml-4">
              <div className="text-xs text-gray-500">Mic:</div>
              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden max-w-[200px]">
                <div
                  className="h-full bg-green-500 transition-all"
                  style={{ width: `${Math.min(100, micLevel * 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {errorMsg && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
            {errorMsg}
          </div>
        )}
      </div>

      {/* Two-column: transcript + tools/logs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Transcript */}
        <div className="bg-white rounded-lg border border-gray-200 flex flex-col" style={{ height: "500px" }}>
          <div className="px-4 py-2 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Transcript</h2>
            <span className="text-xs text-gray-400">{transcript.length} lines</span>
          </div>
          <div ref={transcriptRef} className="flex-1 overflow-y-auto p-4 space-y-2">
            {transcript.length === 0 ? (
              <div className="text-center text-gray-400 text-sm mt-12">
                Start a call to see the conversation here
              </div>
            ) : (
              transcript.map((line, i) => (
                <div
                  key={i}
                  className={`flex ${line.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] px-3 py-1.5 rounded-lg text-sm ${
                      line.role === "user"
                        ? "bg-orange-100 text-orange-900"
                        : "bg-gray-100 text-gray-900"
                    } ${!line.isFinal ? "opacity-50" : ""}`}
                  >
                    {line.text}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Tool calls + logs */}
        <div className="bg-white rounded-lg border border-gray-200 flex flex-col" style={{ height: "500px" }}>
          <div className="px-4 py-2 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Tool calls</h2>
            <span className="text-xs text-gray-400">{toolCalls.length} calls</span>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {toolCalls.length === 0 ? (
              <div className="text-center text-gray-400 text-sm mt-4">
                Tool calls will appear here when the AI uses them
              </div>
            ) : (
              toolCalls.map((tc) => (
                <div key={tc.id} className="bg-blue-50 border border-blue-200 rounded p-2 text-xs font-mono">
                  <div className="font-semibold text-blue-900">🔧 {tc.name}</div>
                  <div className="text-blue-700 mt-1 break-all">
                    {JSON.stringify(tc.args, null, 2)}
                  </div>
                  {tc.result && (
                    <div className="text-blue-600 mt-1 break-all opacity-70">
                      → {tc.result}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Event log (collapsed by default but useful for debugging) */}
      <details className="mt-4 bg-gray-50 rounded-lg border border-gray-200 p-3">
        <summary className="text-sm font-semibold text-gray-700 cursor-pointer">
          Event log ({logs.length})
        </summary>
        <div ref={logsRef} className="mt-3 max-h-64 overflow-y-auto text-xs font-mono space-y-1">
          {logs.length === 0 ? (
            <div className="text-gray-400">No events yet</div>
          ) : (
            logs.map((log, i) => (
              <div
                key={i}
                className={`flex gap-2 ${
                  log.type === "error"
                    ? "text-red-700"
                    : log.type === "tool"
                      ? "text-blue-700"
                      : log.type === "speech"
                        ? "text-purple-700"
                        : "text-gray-700"
                }`}
              >
                <span className="text-gray-400">{new Date(log.ts).toLocaleTimeString()}</span>
                <span>{log.message}</span>
              </div>
            ))
          )}
        </div>
      </details>

      {/* Suggested test scenarios */}
      <div className="mt-6 bg-amber-50 border border-amber-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-amber-900 mb-2">🧪 Try these test scenarios</h3>
        <ul className="text-sm text-amber-800 space-y-1.5">
          <li>
            <strong>Accept:</strong> "My kitchen sink is leaking. I'm at 77006. Tomorrow afternoon works."
            → Should call <code className="bg-amber-100 px-1 rounded">validate_service</code> + <code className="bg-amber-100 px-1 rounded">get_price_quote</code> + <code className="bg-amber-100 px-1 rounded">end_call(accepted)</code>
          </li>
          <li>
            <strong>Urgent:</strong> "My pipe burst! Water is everywhere!"
            → Should call <code className="bg-amber-100 px-1 rounded">flag_urgent</code> + <code className="bg-amber-100 px-1 rounded">end_call(urgent)</code>
          </li>
          <li>
            <strong>Reject:</strong> "I have an outlet problem in Dallas, 75201."
            → Should call <code className="bg-amber-100 px-1 rounded">validate_service</code> (rejected) + <code className="bg-amber-100 px-1 rounded">end_call(rejected)</code>
          </li>
          <li>
            <strong>Unsure:</strong> "I need help with my septic tank."
            → Should call <code className="bg-amber-100 px-1 rounded">flag_uncertain</code> + <code className="bg-amber-100 rounded">end_call(unsure)</code>
          </li>
        </ul>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: CallStatus }) {
  const color = {
    idle: "bg-gray-300",
    connecting: "bg-yellow-400 animate-pulse",
    connected: "bg-green-500 animate-pulse",
    ended: "bg-gray-400",
    error: "bg-red-500",
  }[status];

  return <div className={`w-2.5 h-2.5 rounded-full ${color}`} />;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
