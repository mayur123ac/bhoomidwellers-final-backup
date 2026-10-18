"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getStoredCrmUser, installLoggedOutBackGuard } from "@/lib/authSession";
import { useCrmTheme } from "@/lib/hooks/useCrmTheme";
import dynamic from "next/dynamic";
import AppHeader from "@/components/AppHeader";
import HeaderClock from "@/components/HeaderClock";
import { IoSunnyOutline, IoMoonOutline, IoArrowBackOutline } from "react-icons/io5";
import { HeaderControl } from "@/components/AppHeader";

const SalaryTab = dynamic(() => import("@/components/hr/SalaryTab"), { ssr: false });

export default function MySalaryPage() {
  const router = useRouter();
  const { isDark, toggleTheme } = useCrmTheme();
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const cleanup = installLoggedOutBackGuard(() => router.replace("/"));
    const stored = getStoredCrmUser();
    if (!stored) {
      router.replace("/");
      return cleanup;
    }
    setUser(stored);
    return cleanup;
  }, [router]);

  if (!user) return null;

  return (
    <div className={`min-h-[100dvh] font-sans transition-colors duration-300 ${isDark ? "bg-[#000000] text-white" : "bg-[#F5F5F7] text-[#1D1D1F]"}`}>
      <AppHeader isDark={isDark} context="My Salary" role={user.role || ""}>
        <div className="flex items-center gap-1.5 md:gap-2">
          <HeaderClock isDark={isDark} />
          <HeaderControl isDark={isDark} onClick={toggleTheme} label={isDark ? "Light mode" : "Dark mode"}>
            {isDark ? <IoSunnyOutline size={16} /> : <IoMoonOutline size={16} />}
          </HeaderControl>
          <HeaderControl isDark={isDark} onClick={() => router.back()} label="Back to dashboard">
            <IoArrowBackOutline size={16} />
          </HeaderControl>
        </div>
      </AppHeader>

      <main className="max-w-4xl mx-auto p-5 md:p-8 pb-24">
        <SalaryTab isDark={isDark} />
      </main>
    </div>
  );
}
