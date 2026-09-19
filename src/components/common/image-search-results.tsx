import { BadgeCheck, HardDrive, Loader2, Star } from "lucide-react"

import { formatCount } from "@/lib/format"
import type { ImageSearchRow } from "@/lib/types"
import { cn } from "@/lib/utils"

export function ImageSearchResults({
  listId,
  localMatches,
  results,
  searching,
  searchError,
  active,
  emptyHint,
  onSelectLocal,
  onSelectHub,
}: {
  listId: string
  localMatches?: string[]
  results: ImageSearchRow[]
  searching: boolean
  searchError: string | null
  active: number
  emptyHint: string
  onSelectLocal?: (tag: string) => void
  onSelectHub: (row: ImageSearchRow) => void
}) {
  return (
    <div
      id={listId}
      role="listbox"
      className="border-border bg-canvas overflow-hidden rounded-[10px] border"
    >
      {localMatches?.length ? (
        <ul className="max-h-56 overflow-auto py-1">
          {localMatches.map((tag, index) => (
            <li key={tag} role="option" aria-selected={index === active}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelectLocal?.(tag)}
                className={cn(
                  "flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors",
                  index === active ? "bg-hover" : "hover:bg-hover",
                )}
              >
                <span className="text-ink min-w-0 truncate font-mono text-sm">{tag}</span>
                <span className="bg-hover text-muted ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-xs">
                  <HardDrive size={12} />
                  Local
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : searching && !results.length && !searchError ? (
        <p className="text-muted flex items-center gap-2 px-3 py-2.5 text-sm">
          <Loader2 size={14} className="text-faint animate-spin" />
          Searching Docker Hub…
        </p>
      ) : searchError ? (
        <p className="text-exited px-3 py-2.5 text-sm">{searchError}</p>
      ) : !searching && !results.length ? (
        <p className="text-muted px-3 py-2.5 text-sm">{emptyHint}</p>
      ) : (
        <ul className="max-h-56 overflow-auto py-1">
          {results.map((row, index) => (
            <li key={row.name} role="option" aria-selected={index === active}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelectHub(row)}
                className={cn(
                  "flex w-full flex-col gap-0.5 px-2.5 py-2 text-left transition-colors",
                  index === active ? "bg-hover" : "hover:bg-hover",
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="text-ink min-w-0 truncate font-mono text-sm">{row.name}</span>
                  {row.official ? (
                    <span className="bg-accent-glow text-accent inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-xs">
                      <BadgeCheck size={12} />
                      Official
                    </span>
                  ) : null}
                  <span className="text-faint ml-auto inline-flex shrink-0 items-center gap-1 text-xs tabular-nums">
                    <Star size={12} />
                    {formatCount(row.stars)}
                  </span>
                </span>
                {row.description ? (
                  <span className="text-muted line-clamp-1 text-xs">{row.description}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
