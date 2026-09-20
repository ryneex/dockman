import type { TerminalTarget } from "@/lib/types"

export const UI_SCALES = ["compact", "default", "comfortable"] as const

export type UiScale = (typeof UI_SCALES)[number]

export type Settings = {
  uiScale: UiScale
  terminalApp: string
  terminalTarget: TerminalTarget
}

export const UI_SCALE_META: Record<UiScale, { label: string; hint: string; px: number }> = {
  compact: { label: "Compact", hint: "Smaller type, more rows on screen", px: 13 },
  default: { label: "Default", hint: "Readable without feeling oversized", px: 15 },
  comfortable: { label: "Comfortable", hint: "Largest type and controls", px: 17 },
}

export const DEFAULT_SETTINGS: Settings = {
  uiScale: "default",
  terminalApp: "auto",
  terminalTarget: "external",
}

const STORAGE_KEY = "dockman.settings.v1"

function isUiScale(value: unknown): value is UiScale {
  return UI_SCALES.includes(value as UiScale)
}

function isTerminalApp(value: unknown): value is string {
  return typeof value === "string" && (value === "auto" || /^[A-Za-z0-9._-]{1,64}$/.test(value))
}

function isTerminalTarget(value: unknown): value is TerminalTarget {
  return value === "external" || value === "embedded"
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<Settings>
    return {
      uiScale: isUiScale(parsed.uiScale) ? parsed.uiScale : DEFAULT_SETTINGS.uiScale,
      terminalApp: isTerminalApp(parsed.terminalApp)
        ? parsed.terminalApp
        : DEFAULT_SETTINGS.terminalApp,
      terminalTarget: isTerminalTarget(parsed.terminalTarget)
        ? parsed.terminalTarget
        : DEFAULT_SETTINGS.terminalTarget,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: Settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

export function applyUiScale(scale: UiScale) {
  document.documentElement.dataset.uiScale = scale
}

export function applyStoredSettings() {
  applyUiScale(loadSettings().uiScale)
}
