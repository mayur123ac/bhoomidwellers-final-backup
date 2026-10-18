"use client";

// HRAnalyticsChat — AI-powered HR analytics chat panel (Phase 4B).
// HR asks questions in natural language and gets data-backed answers.

import { useState, useRef, useEffect, useCallback } from "react";
import { IoSend, IoSparkles, IoTrash } from "react-icons/io5";

interface Props {
  isDark: boolean;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const QUICK_PROMPTS = [
  "What's the overall attendance rate this month?",
  "Who has the lowest attendance?",
  "Summarize the latest payroll period.",
  "What are the most common HR request categories?",
  "Show me the salary distribution breakdown.",
  "Any anomalies or concerns I should know about?",
];

export default function HRAnalyticsChat({ isDark }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const card = isDark ? "bg-[#1C1C1E] border-[#38383A]" : "bg-white border-[#E5E5EA]";
  const inputCls = `w-full rounded-lg px-3 py-2 text-sm border outline-none transition resize-none ${
    isDark
      ? "bg-[#2C2C2E] border-[#48484A] text-white placeholder-[#636366] focus:border-emerald-500"
      : "bg-white border-[#D1D1D6] text-[#1D1D1F] placeholder-[#8E8E93] focus:border-emerald-600"
  }`;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: ChatMessage = { role: "user", content: text.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/hr/analytics/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: text.trim(),
          history: messages.slice(-10),
        }),
      });
      const json = await res.json();
      if (json.success) {
        setMessages([...newMessages, { role: "assistant", content: json.data.answer }]);
      } else {
        setError(json.message || "Failed to get response.");
      }
    } catch {
      setError("Network error. Please try again.");
    }
    setLoading(false);
  }, [messages, loading]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const clearChat = () => {
    setMessages([]);
    setError("");
  };

  // ── Empty state with quick prompts ────────────────────────────────────
  if (messages.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center ${
            isDark ? "bg-emerald-500/15" : "bg-emerald-50"
          }`}>
            <IoSparkles size={28} className="text-emerald-500" />
          </div>
          <div className="text-center">
            <h3 className={`text-lg font-bold mb-1 ${isDark ? "text-white" : "text-[#1D1D1F]"}`}>
              HR Analytics AI
            </h3>
            <p className={`text-sm max-w-md ${isDark ? "text-[#98989D]" : "text-[#86868B]"}`}>
              Ask questions about attendance, leave patterns, payroll, salary distribution, and more.
              All answers are backed by your organization's actual data.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                onClick={() => sendMessage(prompt)}
                className={`text-left px-3 py-2.5 rounded-xl text-xs border transition cursor-pointer ${
                  isDark
                    ? "bg-[#2C2C2E] border-[#48484A] text-[#E5E5EA] hover:border-emerald-500/50"
                    : "bg-[#F2F2F7] border-[#D1D1D6] text-[#3A3A3C] hover:border-emerald-500/50"
                }`}
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>

        {/* Input */}
        <div className={`p-4 border-t ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"}`}>
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              className={inputCls}
              rows={1}
              placeholder="Ask about HR data..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim()}
              className={`px-3 py-2 rounded-lg transition shrink-0 disabled:opacity-40 ${
                isDark
                  ? "bg-emerald-600 text-white hover:bg-emerald-500"
                  : "bg-emerald-600 text-white hover:bg-emerald-700"
              }`}
            >
              <IoSend size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Chat view ─────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-160px)]">
      {/* Header */}
      <div className={`flex items-center justify-between px-4 py-2 border-b ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"}`}>
        <div className="flex items-center gap-2">
          <IoSparkles size={16} className="text-emerald-500" />
          <span className={`text-sm font-semibold ${isDark ? "text-white" : "text-[#1D1D1F]"}`}>
            HR Analytics AI
          </span>
        </div>
        <button
          onClick={clearChat}
          className={`p-1.5 rounded-lg transition ${isDark ? "hover:bg-[#2C2C2E] text-[#98989D]" : "hover:bg-[#F2F2F7] text-[#86868B]"}`}
          title="Clear chat"
        >
          <IoTrash size={14} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm ${
                m.role === "user"
                  ? isDark
                    ? "bg-emerald-600 text-white"
                    : "bg-emerald-600 text-white"
                  : `border ${card}`
              }`}
            >
              <p className={`whitespace-pre-wrap ${
                m.role === "assistant"
                  ? isDark ? "text-[#E5E5EA]" : "text-[#3A3A3C]"
                  : ""
              }`}>
                {m.content}
              </p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className={`rounded-xl px-4 py-3 border ${card}`}>
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <div className={`w-1.5 h-1.5 rounded-full animate-bounce ${isDark ? "bg-emerald-400" : "bg-emerald-600"}`} style={{ animationDelay: "0ms" }} />
                  <div className={`w-1.5 h-1.5 rounded-full animate-bounce ${isDark ? "bg-emerald-400" : "bg-emerald-600"}`} style={{ animationDelay: "150ms" }} />
                  <div className={`w-1.5 h-1.5 rounded-full animate-bounce ${isDark ? "bg-emerald-400" : "bg-emerald-600"}`} style={{ animationDelay: "300ms" }} />
                </div>
                <span className={`text-xs ${isDark ? "text-[#636366]" : "text-[#8E8E93]"}`}>Analyzing...</span>
              </div>
            </div>
          </div>
        )}
        {error && (
          <div className="flex justify-start">
            <div className="rounded-xl px-3.5 py-2.5 bg-red-500/10 border border-red-500/20 text-sm text-red-400">
              {error}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className={`p-4 border-t ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"}`}>
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            className={inputCls}
            rows={1}
            placeholder="Ask about HR data..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || loading}
            className={`px-3 py-2 rounded-lg transition shrink-0 disabled:opacity-40 ${
              isDark
                ? "bg-emerald-600 text-white hover:bg-emerald-500"
                : "bg-emerald-600 text-white hover:bg-emerald-700"
            }`}
          >
            <IoSend size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
