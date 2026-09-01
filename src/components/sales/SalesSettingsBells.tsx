"use client";

import React, { useMemo, useState, useCallback } from "react";
import { FaCalendarAlt, FaBell } from "react-icons/fa";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  useNotificationFeed,
  withinNextDay,
  type CrmNotification,
} from "@/lib/hooks/useNotificationFeed";
import NotificationPopover from "@/components/notifications/NotificationPopover";

export default function SalesSettingsBells({
  isDark,
}: {
  isDark: boolean;
}) {
  const router = useRouter();
  const [activePopup, setActivePopup] = useState<"visit" | "notifications" | null>(null);

  const notifications = useNotificationFeed({
    followUpReminders: true,
    siteVisitAlerts: true,
  });

  const followUpLeads = notifications.followUps;
  const visitNotificationLeads = useMemo(
    () => withinNextDay(notifications.siteVisits),
    [notifications.siteVisits]
  );

  const notifPopoverTheme = useMemo(
    () => ({
      text: isDark ? "text-gray-200" : "text-[#1A1A1A]",
      textMuted: isDark ? "text-gray-400" : "text-gray-500",
      textFaint: isDark ? "text-gray-500" : "text-gray-400",
      border: isDark ? "border-[#2a2a2a]" : "border-gray-200",
      itemHover: isDark ? "hover:bg-[#222]" : "hover:bg-gray-50",
      footer: isDark ? "bg-[#151515] border-[#2a2a2a]" : "bg-gray-50 border-gray-200",
    }),
    [isDark]
  );

  const openLeadFromNotification = useCallback(
    async (n: CrmNotification) => {
      setActivePopup(null);
      // Fallback deep linking for settings
      sessionStorage.setItem("pending_lead_open", String(n.leadId));
      router.push("/dashboard/sales");
    },
    [router]
  );

  const seeAllNotifications = useCallback(
    (filter: string) => {
      setActivePopup(null);
      // Fallback deep linking
      sessionStorage.setItem("pending_notification_filter", filter);
      router.push("/dashboard/sales");
    },
    [router]
  );

  const dropdownClasses = isDark
    ? "bg-[#1a1a1a] border-[#2a2a2a]"
    : "bg-white border-[#9CA3AF]";
  const dropdownGlass = isDark
    ? {}
    : {
        boxShadow:
          "0 2px 4px rgba(0,0,0,0.04), 0 8px 20px rgba(158,33,123,0.08), 0 20px 40px rgba(0,0,0,0.10)",
      };

  return (
    <>
      {/* Site Visit Bell */}
      <div className="relative">
        <div className="relative cursor-pointer" onClick={() => setActivePopup(activePopup === "visit" ? null : "visit")}>
          <FaCalendarAlt className={`${isDark ? "text-gray-400" : "text-[#6B7280]"} hover:text-[#9E217B] transition-colors w-5 h-5`} />
          {visitNotificationLeads.length > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-orange-500 rounded-full text-[9px] font-black text-white flex items-center justify-center">
              {visitNotificationLeads.length > 9 ? "9+" : visitNotificationLeads.length}
            </span>
          )}
        </div>
        <AnimatePresence>
          {activePopup === "visit" && (
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className={`absolute top-12 -right-2 sm:right-0 w-[calc(100vw-24px)] sm:w-80 max-w-[320px] rounded-xl shadow-2xl z-50 overflow-hidden border ${dropdownClasses}`}
              style={dropdownGlass}
            >
              <NotificationPopover
                title="Site Visit Reminders"
                caption="Scheduled for today & tomorrow"
                items={visitNotificationLeads}
                footerNoun="upcoming site visits"
                accent="orange"
                theme={notifPopoverTheme}
                onOpenLead={openLeadFromNotification}
                onDismiss={(n) => notifications.dismiss(n.id)}
                onSeeAll={() => seeAllNotifications("site_visit")}
                renderDetail={(n) => (
                  <p className={`text-[10px] mt-0.5 truncate ${notifPopoverTheme.textFaint}`}>
                    {n.leadName}
                  </p>
                )}
                renderMetric={(n) => (
                  <span
                    className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${
                      n.visitDiff === 0
                        ? "text-red-400 bg-red-500/10 border-red-500/30"
                        : "text-yellow-400 bg-yellow-500/10 border-yellow-500/30"
                    }`}
                  >
                    {n.visitDiff === 0 ? "TODAY" : n.visitDiff === 1 ? "TOMORROW" : `IN ${n.visitDiff}D`}
                  </span>
                )}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Follow-up Bell */}
      <div className="relative">
        <div className="relative cursor-pointer" onClick={() => setActivePopup(activePopup === "notifications" ? null : "notifications")}>
          <FaBell className={`${isDark ? "text-gray-400" : "text-[#6B7280]"} hover:text-[#9E217B] transition-colors w-5 h-5`} />
          {followUpLeads.length > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 rounded-full text-[9px] font-black text-white flex items-center justify-center">
              {followUpLeads.length > 9 ? "9+" : followUpLeads.length}
            </span>
          )}
        </div>
        <AnimatePresence>
          {activePopup === "notifications" && (
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className={`absolute top-12 -right-2 sm:right-0 w-[calc(100vw-24px)] sm:w-80 max-w-[320px] rounded-xl shadow-2xl z-50 overflow-hidden border ${dropdownClasses}`}
              style={dropdownGlass}
            >
              <NotificationPopover
                title="Follow-up Reminders"
                caption="Leads with no activity in 2+ days"
                items={followUpLeads}
                footerNoun="pending follow-ups"
                accent="purple"
                theme={notifPopoverTheme}
                onOpenLead={openLeadFromNotification}
                onDismiss={(n) => notifications.dismiss(n.id)}
                onSeeAll={() => seeAllNotifications("follow_up")}
                renderDetail={(n) => (
                  <>
                    <p className={`text-[10px] mt-0.5 truncate ${notifPopoverTheme.textFaint}`}>
                      {n.leadName}
                    </p>
                    {n.interestStatus && n.interestStatus !== "Pending" && (
                      <span
                        className={`inline-block mt-1 text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                          n.interestStatus === "Interested"
                            ? "text-green-400 border-green-500/30 bg-green-500/10"
                            : "text-yellow-400 border-yellow-500/30 bg-yellow-500/10"
                        }`}
                      >
                        {n.interestStatus}
                      </span>
                    )}
                  </>
                )}
                renderMetric={(n) => (
                  <>
                    <div
                      className={`text-xs font-black ${
                        (n.daysSince ?? 0) >= 7
                          ? "text-red-400"
                          : (n.daysSince ?? 0) >= 4
                          ? "text-orange-400"
                          : "text-yellow-400"
                      }`}
                    >
                      {n.daysSince}d
                    </div>
                    <p className={`text-[9px] ${notifPopoverTheme.textFaint}`}>no contact</p>
                  </>
                )}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
