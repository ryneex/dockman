import { Select as BaseSelect } from "@base-ui/react/select"
import { Check, ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

export type SelectOption = {
  value: string
  label: string
}

export function Select({
  value,
  onValueChange,
  items,
  disabled,
  className,
}: {
  value: string
  onValueChange: (value: string) => void
  items: SelectOption[]
  disabled?: boolean
  className?: string
}) {
  const selectedLabel = items.find((item) => item.value === value)?.label ?? value

  return (
    <BaseSelect.Root
      value={value}
      items={items}
      disabled={disabled}
      modal={false}
      onValueChange={(next) => {
        if (next != null) onValueChange(next)
      }}
    >
      <BaseSelect.Trigger
        disabled={disabled}
        className={cn(
          "border-border bg-canvas text-ink focus-visible:border-border-strong group flex h-9 w-full items-center gap-2 rounded-[8px] border px-2.5 text-left outline-none",
          "data-popup-open:border-border-strong",
          "disabled:pointer-events-none disabled:opacity-40",
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate">{selectedLabel}</span>
        <BaseSelect.Icon className="text-faint inline-flex shrink-0">
          <ChevronDown
            size={16}
            className="transition-transform group-data-popup-open:rotate-180"
          />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner
          side="bottom"
          align="start"
          sideOffset={6}
          alignItemWithTrigger={false}
          className="z-[60] outline-none"
        >
          <BaseSelect.Popup className="border-border bg-elevated w-[var(--anchor-width)] min-w-48 overflow-hidden rounded-[10px] border shadow-2xl shadow-black/50 outline-none">
            <BaseSelect.List className="max-h-56 overflow-auto py-1">
              {items.map((item) => (
                <BaseSelect.Item
                  key={item.value || item.label}
                  value={item.value}
                  label={item.label}
                  className={cn(
                    "text-ink data-highlighted:bg-hover flex cursor-default items-center gap-2 px-2.5 py-2 text-sm outline-none select-none",
                  )}
                >
                  <BaseSelect.ItemText className="text-ink min-w-0 flex-1 truncate">
                    {item.label}
                  </BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator className="text-accent inline-flex size-3.5 shrink-0 items-center justify-center">
                    <Check size={14} />
                  </BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  )
}
