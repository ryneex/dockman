import { createContext, useContext, useMemo, useState, type ReactNode } from "react"

import {
  applyUiScale,
  loadSettings,
  saveSettings,
  type Settings,
  type UiScale,
} from "@/lib/settings"
import type { TerminalTarget } from "@/lib/types"

type SettingsContextValue = {
  settings: Settings
  setUiScale: (scale: UiScale) => void
  setTerminalApp: (terminalApp: string) => void
  setTerminalTarget: (terminalTarget: TerminalTarget) => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => loadSettings())

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      setUiScale: (uiScale) => {
        const next = { ...settings, uiScale }
        applyUiScale(uiScale)
        saveSettings(next)
        setSettings(next)
      },
      setTerminalApp: (terminalApp) => {
        const next = { ...settings, terminalApp }
        saveSettings(next)
        setSettings(next)
      },
      setTerminalTarget: (terminalTarget) => {
        const next = { ...settings, terminalTarget }
        saveSettings(next)
        setSettings(next)
      },
    }),
    [settings],
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider")
  return ctx
}
