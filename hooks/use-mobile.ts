import * as React from "react"

const MOBILE_BREAKPOINT = 768
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

/** For event handlers only. Never branch rendering on it: layout switches with CSS (`md:`). */
export function isMobileViewport() {
  return window.matchMedia(QUERY).matches
}

/**
 * Renders as false on the server and during hydration, then follows the viewport. Only for
 * details that don't change the HTML structure (e.g. hiding a hover tooltip on phones).
 */
export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, isMobileViewport, () => false)
}
