"use client";
// IndianCurrencyInput.tsx — Reusable ₹-prefixed input with live Indian comma formatting
import React, { useRef, useLayoutEffect } from "react";
<<<<<<< HEAD
import { formatIndianNumber, cleanCurrencyValue, formatCurrencyDisplay } from "@/lib/currency";
=======
import { formatIndianNumber, cleanCurrencyValue } from "@/lib/currency";
>>>>>>> cd2b0086d5cb85c0685d879c49ba9ed21dd19ac4

interface IndianCurrencyInputProps {
    value: string;                       // clean numeric string, e.g. "9000000"
    onChange: (cleanValue: string) => void;
    placeholder?: string;
    className?: string;                  // applied to the <input>, not the wrapper
    disabled?: boolean;
    id?: string;
}

export default function IndianCurrencyInput({
    value, onChange, placeholder, className = "", disabled, id,
}: IndianCurrencyInputProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const pendingCaret = useRef<{ pos: number; prevLen: number } | null>(null);

    const displayValue = formatIndianNumber(value);
<<<<<<< HEAD
    const formattedHint = cleanCurrencyValue(value) ? formatCurrencyDisplay(value) : "";
=======
>>>>>>> cd2b0086d5cb85c0685d879c49ba9ed21dd19ac4

    // Restore caret position after the formatted string re-renders (comma insertion shifts it)
    useLayoutEffect(() => {
        if (pendingCaret.current && inputRef.current) {
            const { pos, prevLen } = pendingCaret.current;
            const newPos = Math.max(0, pos + (displayValue.length - prevLen));
            inputRef.current.setSelectionRange(newPos, newPos);
            pendingCaret.current = null;
        }
    }, [displayValue]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value;
        const caretPos = e.target.selectionStart ?? raw.length;
        pendingCaret.current = { pos: caretPos, prevLen: raw.length };
        onChange(cleanCurrencyValue(raw));
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
        e.preventDefault();
        onChange(cleanCurrencyValue(e.clipboardData.getData("text")));
    };

    return (
        <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm opacity-60 pointer-events-none select-none">₹</span>
            <input
                ref={inputRef}
                id={id}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={displayValue}
                onChange={handleChange}
                onPaste={handlePaste}
                placeholder={placeholder}
                disabled={disabled}
                className={`${className} pl-7`}
            />
<<<<<<< HEAD
            {/* {formattedHint && (
                <span className="block mt-1 text-[11px] opacity-60 select-none">{formattedHint}</span>
            )} */}
=======
>>>>>>> cd2b0086d5cb85c0685d879c49ba9ed21dd19ac4
        </div>
    );
}