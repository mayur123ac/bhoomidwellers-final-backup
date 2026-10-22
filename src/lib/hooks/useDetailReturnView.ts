import { useRef, useEffect } from "react";

/**
 * Tracks the last non-detail view identifier so a Back button can return
 * the user to whichever view they were on before opening a detail panel.
 *
 * @param currentView  The current view id (e.g. "forms", "closed-leads", "detail")
 * @param detailView   The id that represents the detail view (default "detail")
 * @param fallback     Returned when no previous view has been captured yet
 * @returns The view id to navigate back to
 */
export function useDetailReturnView(
  currentView: string,
  detailView: string = "detail",
  fallback: string = "overview",
): string {
  const prevRef = useRef<string>(fallback);

  useEffect(() => {
    if (currentView !== detailView) {
      prevRef.current = currentView;
    }
  }, [currentView, detailView]);

  return prevRef.current;
}
