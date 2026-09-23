import { useEffect, useState } from "react"

import { JsonView } from "@/components/common"
import { Drawer } from "@/components/ui/drawer"
import { Skeleton } from "@/components/ui/skeleton"
import type { ImageRow } from "@/lib/types"
import { cn } from "@/lib/utils"

import { ImageOverview } from "./image-overview"

const panes = [
  { id: "summary", label: "Summary" },
  { id: "json", label: "JSON" },
] as const

export function ImageInspectDrawer({
  open,
  title,
  row,
  data,
  loading,
  error,
  onClose,
}: {
  open: boolean
  title: string
  row?: ImageRow
  data: unknown
  loading?: boolean
  error?: string | null
  onClose: () => void
}) {
  const [pane, setPane] = useState<(typeof panes)[number]["id"]>("summary")

  useEffect(() => {
    if (open) setPane("summary")
  }, [open, row?.id])

  return (
    <Drawer open={open} title={title} onClose={onClose}>
      <nav className="border-border flex shrink-0 gap-1 border-b px-4">
        {panes.map((item) => (
          <button
            key={item.id}
            type="button"
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
              pane === item.id
                ? "border-accent text-ink"
                : "text-muted hover:text-ink border-transparent",
            )}
            onClick={() => setPane(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {loading ? (
        <div className="grid gap-2 p-4">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      ) : error ? (
        <p className="text-muted p-5">{error}</p>
      ) : pane === "summary" && row ? (
        <ImageOverview row={row} inspect={data} />
      ) : (
        <JsonView value={data} />
      )}
    </Drawer>
  )
}
