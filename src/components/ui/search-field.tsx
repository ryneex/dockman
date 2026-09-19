import { Search } from "lucide-react"
import { forwardRef } from "react"

export const SearchField = forwardRef<
  HTMLInputElement,
  { value: string; onChange: (value: string) => void; placeholder?: string }
>(function SearchField({ value, onChange, placeholder = "Search current view" }, ref) {
  return (
    <label className="border-border bg-canvas flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[8px] border px-2.5">
      <Search size={14} className="text-faint shrink-0" />
      <input
        ref={ref}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="text-ink placeholder:text-faint min-w-0 flex-1 bg-transparent outline-none"
      />
      <kbd className="border-border text-faint rounded border px-1.5 py-0.5 text-xs">/</kbd>
    </label>
  )
})
