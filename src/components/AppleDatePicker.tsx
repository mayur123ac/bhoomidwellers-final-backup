"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FaCalendarAlt } from "react-icons/fa";
import { MdChevronLeft, MdChevronRight } from "react-icons/md";

// ── Apple-Style Custom Date Picker ──────────────────────────────────────────

export default function AppleDatePicker({
    selectedDate,
    onChange,
    maxDate,
    isDark,
}: {
    selectedDate: string;
    onChange: (date: string) => void;
    maxDate: string;
    isDark: boolean;
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [viewDate, setViewDate] = useState(new Date(selectedDate));
    const popoverRef = useRef<HTMLDivElement>(null);

    // Sync view when selectedDate changes externally
    useEffect(() => {
        setViewDate(new Date(selectedDate));
    }, [selectedDate]);

    // Close when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        if (isOpen) document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [isOpen]);

    const currentYear = viewDate.getFullYear();
    const currentMonth = viewDate.getMonth();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const firstDay = new Date(currentYear, currentMonth, 1).getDay();

    const monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    ];
    const dayNames = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

    const handlePrevMonth = () => setViewDate(new Date(currentYear, currentMonth - 1, 1));
    const handleNextMonth = () => setViewDate(new Date(currentYear, currentMonth + 1, 1));

    const handleSelect = (day: number) => {
        const y = currentYear;
        const m = String(currentMonth + 1).padStart(2, "0");
        const d = String(day).padStart(2, "0");
        const isoString = `${y}-${m}-${d}`;
        if (maxDate && isoString > maxDate) return;
        onChange(isoString);
        setIsOpen(false);
    };

    // Parse selectedDate as local date to avoid timezone shift on display
    const [selY, selM, selD] = selectedDate.split("-").map(Number);
    const displayFormat = new Date(selY, selM - 1, selD).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });

    const todayStr = new Date().toISOString().split("T")[0];

    return (
        <div className="relative" ref={popoverRef}>
            {/* Trigger Button */}
            <button
                onClick={() => setIsOpen((prev) => !prev)}
                className={`flex items-center cursor-pointer gap-2 px-3 py-1.5 rounded-md text-[12px] font-medium tracking-wide border transition-colors ${isDark
                        ? "bg-[#2C2C2E] border-white/5 text-white hover:bg-[#3A3A3C]"
                        : "bg-white border-gray-200 text-black hover:bg-gray-50 shadow-sm"
                    }`}
            >
                <span>{displayFormat}</span>
                <FaCalendarAlt className="text-[11px] text-[#8E8E93]" />
            </button>

            {/* Floating Calendar Popover */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: -5, filter: "blur(4px)" }}
                        animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
                        exit={{ opacity: 0, scale: 0.95, y: -5, filter: "blur(4px)" }}
                        transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                        className={`absolute left-0 top-[calc(100%+8px)] w-[264px] p-4 rounded-[20px] shadow-[0_12px_40px_rgba(0,0,0,0.14)] z-50 backdrop-blur-2xl ${isDark
                                ? "bg-[#1C1C1E]/90 border border-white/10"
                                : "bg-white/92 border border-black/5"
                            }`}
                    >
                        {/* Month / Year Header */}
                        <div className="flex justify-between items-center mb-4 px-1">
                            <span
                                className={`font-semibold tracking-tight text-[14px] ${isDark ? "text-white" : "text-black"
                                    }`}
                            >
                                {monthNames[currentMonth]} {currentYear}
                            </span>
                            <div className="flex gap-0.5">
                                <button
                                    onClick={handlePrevMonth}
                                    className={`p-1 rounded-full transition-colors ${isDark ? "hover:bg-white/10 text-white" : "hover:bg-black/5 text-black"
                                        }`}
                                >
                                    <MdChevronLeft size={20} />
                                </button>
                                <button
                                    onClick={handleNextMonth}
                                    className={`p-1 rounded-full transition-colors ${isDark ? "hover:bg-white/10 text-white" : "hover:bg-black/5 text-black"
                                        }`}
                                >
                                    <MdChevronRight size={20} />
                                </button>
                            </div>
                        </div>

                        {/* Day-of-week Headers */}
                        <div className="grid grid-cols-7 gap-1 mb-2">
                            {dayNames.map((d) => (
                                <div
                                    key={d}
                                    className="text-center text-[10px] font-semibold uppercase tracking-wider text-[#8E8E93]"
                                >
                                    {d}
                                </div>
                            ))}
                        </div>

                        {/* Calendar Grid */}
                        <div className="grid grid-cols-7 gap-1">
                            {/* Leading empty cells */}
                            {Array.from({ length: firstDay }).map((_, i) => (
                                <div key={`empty-${i}`} />
                            ))}

                            {/* Day cells */}
                            {Array.from({ length: daysInMonth }).map((_, i) => {
                                const day = i + 1;
                                const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                                const isSelected = dateStr === selectedDate;
                                const isToday = dateStr === todayStr;
                                const isDisabled = !!(maxDate && dateStr > maxDate);

                                return (
                                    <button
                                        key={day}
                                        disabled={isDisabled}
                                        onClick={() => handleSelect(day)}
                                        className={`
                      w-[32px] h-[32px] rounded-full flex items-center justify-center text-[13px] font-medium transition-colors mx-auto
                      ${isSelected
                                                ? "bg-[#9E217B] text-white font-semibold shadow-sm"
                                                : isDisabled
                                                    ? "opacity-25 cursor-not-allowed"
                                                    : isToday
                                                        ? isDark
                                                            ? "bg-white/10 text-[#9E217B] font-semibold"
                                                            : "bg-[#9E217B]/10 text-[#9E217B] font-semibold"
                                                        : isDark
                                                            ? "hover:bg-white/10 text-white"
                                                            : "hover:bg-black/5 text-black"
                                            }
                    `}
                                    >
                                        {day}
                                    </button>
                                );
                            })}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}