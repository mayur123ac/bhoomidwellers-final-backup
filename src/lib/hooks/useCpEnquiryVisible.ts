import { useEffect, useState } from "react";

/** Whether the standalone "CP Enquiry" tab is enabled for the given role key. */
export function useCpEnquiryVisible(
  roleKey: "receptionist" | "site_head" | "sales_manager" | null
): boolean {
  const [visible, setVisible] = useState(roleKey === "sales_manager");

  useEffect(() => {
    if (!roleKey) return;
    fetch("/api/settings/cp-enquiry-visibility", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data[roleKey] === "boolean") {
          setVisible(data[roleKey]);
        }
      })
      .catch(() => {});
  }, [roleKey]);

  return visible;
}
