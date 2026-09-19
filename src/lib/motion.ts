import type { Transition } from "framer-motion"

export const micro: Transition = { duration: 0.14, ease: [0.2, 0.8, 0.2, 1] }
export const route: Transition = { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }
export const panel: Transition = { type: "spring", stiffness: 380, damping: 34 }

export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

export function motionOrInstant<T extends Transition>(transition: T): Transition {
  return prefersReducedMotion() ? { duration: 0 } : transition
}
