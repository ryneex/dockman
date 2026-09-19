import { Check } from "lucide-react"

import { useSettings } from "@/components/providers"
import { UI_SCALE_META, UI_SCALES } from "@/lib/settings"
import { cn } from "@/lib/utils"

export function SettingsPage() {
  const { settings, setUiScale } = useSettings()

  return (
    <div className="relative min-h-full overflow-auto p-6">
      <p className="text-faint text-sm">Preferences</p>
      <h1 className="mt-1 tracking-[-0.03em]">Settings</h1>
      <p className="text-muted mt-1 text-sm">Changes apply immediately and stay on this machine.</p>

      <section className="border-border bg-elevated mt-5 rounded-[12px] border p-5">
        <h2 className="tracking-[-0.03em]">Text size</h2>
        <p className="text-muted mt-1 text-sm">
          Scale type, tables, and controls. Default is larger than the old 13px UI.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {UI_SCALES.map((scale) => {
            const meta = UI_SCALE_META[scale]
            const selected = settings.uiScale === scale
            return (
              <button
                key={scale}
                type="button"
                onClick={() => setUiScale(scale)}
                className={cn(
                  "rounded-[12px] border p-4 text-left transition-colors",
                  selected
                    ? "border-accent bg-accent/10"
                    : "border-border bg-canvas hover:bg-hover",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="tracking-[-0.03em]">{meta.label}</p>
                  {selected ? <Check size={16} className="text-accent" /> : null}
                </div>
                <p className="text-muted mt-1 text-sm">{meta.hint}</p>
                <p className="text-faint mt-3 font-mono text-sm">{meta.px}px</p>
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}
