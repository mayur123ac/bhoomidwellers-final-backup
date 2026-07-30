export function getStoredCrmUser() {
  try {
    const stored = localStorage.getItem("crm_user");
    if (!stored) return null;
    return JSON.parse(stored);
  } catch {
    localStorage.removeItem("crm_user");
    return null;
  }
}

export function clearCrmSession() {
  localStorage.removeItem("crm_user");
  sessionStorage.clear();
  
  // Call the logout API to clear the cookie
  // We use fetch with keepalive or standard await depending on context, 
  // but since this might be called on unmount or before navigating, we can just fire it off
  if (typeof window !== "undefined") {
    // Logout is a soft navigation (router.replace), so client providers mounted in
    // the root layout are never remounted. Tell them to drop this user's state,
    // otherwise the next user inherits it — e.g. the header attendance badge.
    window.dispatchEvent(new Event("attendance-reset"));
    fetch("/api/auth/logout", { method: "POST" }).catch(console.error);
  }
}

export function installLoggedOutBackGuard(onLoggedOut: () => void) {
  const checkSession = () => {
    if (!localStorage.getItem("crm_user")) onLoggedOut();
  };

  window.addEventListener("pageshow", checkSession);
  window.addEventListener("focus", checkSession);

  return () => {
    window.removeEventListener("pageshow", checkSession);
    window.removeEventListener("focus", checkSession);
  };
}
