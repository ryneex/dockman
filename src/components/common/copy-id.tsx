import { toast } from "sonner"

import { shortId } from "@/lib/format"

export function CopyId({ id }: { id: string }) {
  return (
    <button
      type="button"
      className="text-muted hover:text-ink font-mono text-sm"
      onClick={async (event) => {
        event.stopPropagation()
        await navigator.clipboard.writeText(id)
        toast.success("Copied ID")
      }}
    >
      {shortId(id)}
    </button>
  )
}
