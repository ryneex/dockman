import { useQuery } from "@tanstack/react-query"
import { ChevronRight, File, Folder, Link2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { Drawer } from "@/components/ui/drawer"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/api"
import { formatBytes } from "@/lib/format"

function parentPath(path: string) {
  if (path === "/") return "/"
  const parts = path.split("/").filter(Boolean)
  parts.pop()
  return parts.length ? `/${parts.join("/")}` : "/"
}

function crumbs(path: string) {
  const parts = path.split("/").filter(Boolean)
  const items = [{ label: "/", path: "/" }]
  let current = ""
  for (const part of parts) {
    current += `/${part}`
    items.push({ label: part, path: current })
  }
  return items
}

function fsError(error: unknown) {
  const text = String(error)
  if (text.includes("too_large")) return "File is larger than 256 KB."
  if (text.includes("binary")) return "This file is not valid UTF-8 text."
  if (text.includes("not_a_file")) return "That path is not a file."
  return text
}

export function FilesDrawer({
  open,
  containerId,
  title,
  onClose,
}: {
  open: boolean
  containerId: string | null
  title: string
  onClose: () => void
}) {
  const [path, setPath] = useState("/")
  const [previewPath, setPreviewPath] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setPath("/")
    setPreviewPath(null)
  }, [open, containerId])

  const listing = useQuery({
    queryKey: ["container-fs", containerId, path],
    queryFn: () => api.containerFsList(containerId!, path),
    enabled: open && Boolean(containerId) && !previewPath,
  })

  const preview = useQuery({
    queryKey: ["container-fs-read", containerId, previewPath],
    queryFn: () => api.containerFsRead(containerId!, previewPath!),
    enabled: open && Boolean(containerId) && Boolean(previewPath),
    retry: false,
  })

  const trail = useMemo(() => crumbs(previewPath ?? path), [path, previewPath])

  function close() {
    setPath("/")
    setPreviewPath(null)
    onClose()
  }

  return (
    <Drawer open={open} title={title} onClose={close}>
      <div className="flex h-full min-h-0 flex-col">
        <nav className="border-border flex flex-wrap items-center gap-1 border-b px-4 py-2 text-sm">
          {trail.map((item, index) => (
            <span key={item.path} className="inline-flex items-center gap-1">
              {index > 0 ? <ChevronRight size={14} className="text-faint" /> : null}
              <button
                type="button"
                className="text-muted hover:text-ink"
                onClick={() => {
                  setPreviewPath(null)
                  setPath(item.path)
                }}
              >
                {item.label}
              </button>
            </span>
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-auto">
          {previewPath ? (
            preview.isLoading ? (
              <div className="grid gap-2 p-5">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-full" />
              </div>
            ) : preview.isError ? (
              <p className="text-muted p-5">{fsError(preview.error)}</p>
            ) : (
              <pre className="text-muted p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap select-text">
                {preview.data?.text}
              </pre>
            )
          ) : listing.isLoading ? (
            <div className="grid gap-2 p-5">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-5/6" />
              <Skeleton className="h-8 w-2/3" />
            </div>
          ) : listing.isError ? (
            <p className="text-muted p-5">{fsError(listing.error)}</p>
          ) : !listing.data?.length ? (
            <p className="text-faint p-5">This directory is empty.</p>
          ) : (
            <ul>
              {path !== "/" ? (
                <li>
                  <button
                    type="button"
                    className="text-muted hover:bg-hover flex w-full items-center gap-3 px-5 py-2.5 text-left"
                    onClick={() => setPath(parentPath(path))}
                  >
                    <Folder size={16} />
                    ..
                  </button>
                </li>
              ) : null}
              {listing.data.map((entry) => {
                const Icon = entry.kind === "dir" ? Folder : entry.kind === "symlink" ? Link2 : File
                return (
                  <li key={entry.path}>
                    <button
                      type="button"
                      className="hover:bg-hover flex w-full items-center gap-3 px-5 py-2.5 text-left"
                      onClick={() => {
                        if (entry.kind === "dir") setPath(entry.path)
                        else setPreviewPath(entry.path)
                      }}
                    >
                      <Icon size={16} className="text-muted shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                      <span className="text-faint shrink-0 text-sm">
                        {entry.kind === "dir" ? "dir" : formatBytes(entry.size)}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </Drawer>
  )
}
