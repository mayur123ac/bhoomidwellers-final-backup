"use client";
// CpSkeletons.tsx — the loading shapes for the Channel Partner panels.
//
// These exist because the CP screens genuinely wait on the network: measured
// against the production database, /api/cp-enquiries is ~310 ms for 210 rows
// and /api/channel-partners ~155 ms, and that is before Next's own overhead.
// What was on screen for that window was a single centered "Loading…" table
// row, so the panel went from one row tall to twenty rows tall the instant the
// data landed — the whole page jumped.
//
// The rule these follow: a skeleton stands in for content that IS coming. An
// empty result and a failed request are different outcomes and get their own
// treatment in the panels; nothing here is ever shown indefinitely, and none of
// it is shown at all when the panel already has rows to draw (see
// useCpResource, which paints from cache on the first render).
//
// Visual idiom matches the rest of the CRM (RevenueIntelligenceView,
// Settings/ui.tsx): `animate-pulse` over a flat token fill, staggered slightly
// down the list so it reads as one surface settling rather than a strobe.

import React from "react";

/** The fill used for every bar. Two tokens only — light and dark. */
export const skeletonFill = (isDark: boolean) =>
  isDark ? "bg-white/[0.07]" : "bg-slate-200/80";

/** A single grey bar. `w` is any Tailwind width class or a raw CSS width. */
export function SkeletonBar({
  isDark, w = "100%", h = 10, className = "", delay = 0, rounded = "rounded-md",
}: {
  isDark: boolean;
  w?: string;
  h?: number;
  className?: string;
  delay?: number;
  rounded?: string;
}) {
  return (
    <span
      aria-hidden
      className={`block animate-pulse ${rounded} ${skeletonFill(isDark)} ${className}`}
      style={{ width: w, height: h, animationDelay: delay ? `${delay}ms` : undefined }}
    />
  );
}

/**
 * Skeleton rows for a CP table, rendered INSIDE the panel's own <tbody>.
 *
 * Deliberately not a separate table: reusing the real one keeps the sticky
 * header, the column count and the row height identical, so the swap to real
 * rows moves nothing vertically. `widths` is per column, in px, chosen to sit
 * near the typical value in that column — the residual horizontal settle when
 * real text arrives is the only movement left.
 */
export function CpTableSkeletonRows({
  isDark, columns, rows = 8, widths, cellClass = "px-3 py-3",
}: {
  isDark: boolean;
  columns: number;
  rows?: number;
  widths?: number[];
  cellClass?: string;
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={`sk-${r}`} aria-hidden className={isDark ? "border-b border-white/5" : "border-b border-black/5"}>
          {Array.from({ length: columns }).map((__, c) => (
            <td key={c} className={cellClass}>
              <SkeletonBar
                isDark={isDark}
                w={`${widths?.[c] ?? 90}px`}
                h={10}
                // Staggered down the rows, not across the cells: the eye reads
                // a table by row, and a per-cell stagger looks like noise.
                delay={r * 60}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/**
 * The portfolio stat cards above a CP table.
 *
 * Same grid, radius and padding as the real ones. The real ones render only
 * once rows exist, so without this the summary strip appeared from nothing and
 * shoved the whole table down the moment the fetch resolved.
 */
export function CpStatCardsSkeleton({ isDark, cards = 4 }: { isDark: boolean; cards?: number }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mx-2 mb-3" aria-hidden>
      {Array.from({ length: cards }).map((_, i) => (
        <div
          key={i}
          className={`rounded-2xl px-4 py-3 shadow-sm ${isDark
            ? "bg-[#1C1C1E] border border-white/5 shadow-black/50"
            : "bg-white border border-black/5 shadow-gray-200/50"
            }`}
        >
          <SkeletonBar isDark={isDark} w="64px" h={10} delay={i * 70} />
          <SkeletonBar isDark={isDark} w="46px" h={20} delay={i * 70} className="mt-1.5" />
          <SkeletonBar isDark={isDark} w="88px" h={10} delay={i * 70} className="mt-1.5" />
        </div>
      ))}
    </div>
  );
}

/**
 * The partner detail drawer's body: tab strip plus the first two field blocks.
 * The drawer animates open at full size, so the alternative — one centered line
 * of text — left a 4xl modal almost empty and then filled it all at once.
 */
export function CpDrawerSkeleton({ isDark }: { isDark: boolean }) {
  return (
    <div aria-hidden>
      <div className="flex flex-wrap gap-2 mb-4">
        {[72, 116, 96, 100, 88].map((w, i) => (
          <SkeletonBar key={i} isDark={isDark} w={`${w}px`} h={28} rounded="rounded-lg" delay={i * 60} />
        ))}
      </div>
      {[0, 1].map(block => (
        <div
          key={block}
          className={`mb-4 rounded-2xl p-4 border ${isDark ? "bg-white/5 border-white/5" : "bg-black/5 border-transparent"}`}
        >
          <SkeletonBar isDark={isDark} w="118px" h={11} className="mb-3" delay={block * 90} />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <SkeletonBar isDark={isDark} w="70%" h={9} delay={block * 90 + i * 40} />
                <SkeletonBar isDark={isDark} w="88%" h={11} delay={block * 90 + i * 40} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The stat chips / count pills that sit in a CP panel header. */
export function CpHeaderSkeleton({ isDark, chips = 2 }: { isDark: boolean; chips?: number }) {
  return (
    <span className="inline-flex items-center gap-2" aria-hidden>
      {Array.from({ length: chips }).map((_, i) => (
        <SkeletonBar key={i} isDark={isDark} w="74px" h={20} rounded="rounded-full" delay={i * 80} />
      ))}
    </span>
  );
}

/**
 * CP Chat's conversation rail: avatar, name + timestamp, company line.
 * Row geometry copies the real one (px-5 py-3, 48px avatar) so selecting a
 * partner never nudges the list.
 */
export function CpChatRailSkeleton({ isDark, rows = 7 }: { isDark: boolean; rows?: number }) {
  return (
    <div aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-3">
          <SkeletonBar isDark={isDark} w="48px" h={48} rounded="rounded-full" delay={i * 70} className="flex-shrink-0" />
          <div className="min-w-0 flex-1 pb-3 pt-1 space-y-2">
            <div className="flex justify-between items-baseline gap-2">
              <SkeletonBar isDark={isDark} w="55%" h={12} delay={i * 70} />
              <SkeletonBar isDark={isDark} w="34px" h={10} delay={i * 70} />
            </div>
            <SkeletonBar isDark={isDark} w="42%" h={10} delay={i * 70} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * CP Chat's thread. Alternating sides with varied widths, because a column of
 * identical centered bars does not read as a conversation.
 */
export function CpChatThreadSkeleton({ isDark }: { isDark: boolean }) {
  const bubbles = [
    { mine: false, w: "62%", h: 44 },
    { mine: true, w: "48%", h: 34 },
    { mine: false, w: "70%", h: 58 },
    { mine: true, w: "40%", h: 34 },
    { mine: false, w: "55%", h: 44 },
  ];
  return (
    <div className="space-y-4" aria-hidden>
      <div className="flex justify-center my-6">
        <SkeletonBar isDark={isDark} w="64px" h={11} />
      </div>
      {bubbles.map((b, i) => (
        <div key={i} className={`flex w-full ${b.mine ? "justify-end" : "justify-start"}`}>
          <div className={`max-w-[75%] flex flex-col gap-1 ${b.mine ? "items-end" : "items-start"}`}>
            {!b.mine && <SkeletonBar isDark={isDark} w="96px" h={9} delay={i * 90} className="mx-1" />}
            <SkeletonBar
              isDark={isDark}
              w={b.w}
              h={b.h}
              delay={i * 90}
              rounded={b.mine ? "rounded-2xl rounded-tr-sm" : "rounded-2xl rounded-tl-sm"}
              className="min-w-[140px]"
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** CP Chat's right-hand Details/About column: label/value pairs and stat tiles. */
export function CpChatDetailsSkeleton({ isDark }: { isDark: boolean }) {
  return (
    <div className="p-5 space-y-8" aria-hidden>
      <div className="space-y-4">
        <SkeletonBar isDark={isDark} w="112px" h={13} />
        <div className="space-y-3">
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className="flex justify-between items-center gap-4">
              <SkeletonBar isDark={isDark} w="64px" h={11} delay={i * 60} />
              <SkeletonBar isDark={isDark} w="104px" h={11} delay={i * 60} />
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-4">
        <SkeletonBar isDark={isDark} w="126px" h={13} />
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map(i => (
            <SkeletonBar key={i} isDark={isDark} w="100%" h={86} rounded="rounded-xl" delay={i * 70} />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The card list behind CP Chat's Enquiries and Bookings tabs. Same 2rem radius
 * and padding as the real cards.
 */
export function CpChatCardListSkeleton({ isDark, rows = 4 }: { isDark: boolean; rows?: number }) {
  return (
    <div className="space-y-3" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className={`p-4 rounded-2xl border ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"}`}
        >
          <SkeletonBar isDark={isDark} w="42%" h={13} delay={i * 70} />
          <SkeletonBar isDark={isDark} w="28%" h={10} delay={i * 70} className="mt-2" />
        </div>
      ))}
    </div>
  );
}
