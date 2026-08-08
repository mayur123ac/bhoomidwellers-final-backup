import SettingsShell from "@/components/Settings/SettingsShell";

export const metadata = {
  title: "Settings | Bhoomi CRM",
};

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <SettingsShell>{children}</SettingsShell>;
}
