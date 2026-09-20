import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronRight, File, Folder, Link2, Save } from "lucide-react"
import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Drawer } from "@/components/ui/drawer"
import { TextInput } from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/api"
import { formatBytes } from "@/lib/format"
import type { FsEntry } from "@/lib/types"

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

function normalizePath(raw: string) {
  const trimmed = raw.trim() || "/"
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`
}

function fsError(error: unknown) {
  const text = String(error)
  if (text.includes("too_large")) return "This file is too large to open here."
  if (text.includes("binary")) return "This file is not valid UTF-8 text."
  if (text.includes("not_a_file")) return "That path is not a file."
  return text
}

export function FilesPanel({ containerId }: { containerId: string }) {
  const client = useQueryClient()
  const [path, setPath] = useState("/")
  const [filePath, setFilePath] = useState<string | null>(null)
  const [pathDraft, setPathDraft] = useState("/")
  const [filter, setFilter] = useState("")
  const [draft, setDraft] = useState("")

  const currentPath = filePath ?? path

  useEffect(() => {
    setPath("/")
    setFilePath(null)
    setPathDraft("/")
    setFilter("")
    setDraft("")
  }, [containerId])

  useEffect(() => {
    setPathDraft(currentPath)
  }, [currentPath])

  const listing = useQuery({
    queryKey: ["container-fs", containerId, path],
    queryFn: () => api.containerFsList(containerId, path),
    enabled: !filePath,
    retry: false,
  })

  const file = useQuery({
    queryKey: ["container-fs-read", containerId, filePath],
    queryFn: () => api.containerFsRead(containerId, filePath!),
    enabled: Boolean(filePath),
    retry: false,
  })

  useEffect(() => {
    if (file.data) setDraft(file.data.text)
  }, [file.data])

  const save = useMutation({
    mutationFn: async () => {
      if (!filePath) throw new Error("File is required")
      await api.containerFsWrite(containerId, filePath, draft)
    },
    onSuccess: async () => {
      toast.success("Saved")
      await client.invalidateQueries({ queryKey: ["container-fs-read", containerId, filePath] })
      await client.invalidateQueries({ queryKey: ["container-fs", containerId] })
    },
    onError: (error) => toast.error(fsError(error)),
  })

  const trail = useMemo(() => crumbs(currentPath), [currentPath])
  const dirty = file.data != null && draft !== file.data.text
  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    const items = listing.data ?? []
    if (!needle) return items
    return items.filter((entry) => entry.name.toLowerCase().includes(needle))
  }, [filter, listing.data])

  function goDir(next: string) {
    setFilePath(null)
    setFilter("")
    setPath(normalizePath(next))
  }

  function goFile(next: string) {
    setFilter("")
    setFilePath(normalizePath(next))
  }

  function onPathSubmit(event: FormEvent) {
    event.preventDefault()
    goDir(pathDraft)
  }

  function openEntry(entry: FsEntry) {
    if (entry.kind === "file") goFile(entry.path)
    else goDir(entry.path)
  }

  function onEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key === "s") {
      event.preventDefault()
      if (dirty && !save.isPending) save.mutate()
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border shrink-0 border-b">
        <nav className="flex flex-wrap items-center gap-1 px-4 pt-2 text-sm">
          {trail.map((item, index) => (
            <span key={item.path} className="inline-flex items-center gap-1">
              {index > 0 ? <ChevronRight size={14} className="text-faint" /> : null}
              <button
                type="button"
                className="text-muted hover:text-ink"
                onClick={() => goDir(item.path)}
              >
                {item.label}
              </button>
            </span>
          ))}
        </nav>
        <form className="flex min-w-0 items-center gap-2 px-4 py-2" onSubmit={onPathSubmit}>
          <TextInput
            value={pathDraft}
            onChange={(event) => setPathDraft(event.target.value)}
            spellCheck={false}
            className="min-w-0 font-mono text-sm"
            aria-label="Path"
          />
          {filePath ? (
            <Button
              className="shrink-0"
              variant="primary"
              icon={<Save />}
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          ) : (
            <Button className="shrink-0" type="submit">
              Go
            </Button>
          )}
        </form>
      </div>
      {filePath ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {file.isLoading ? (
            <div className="grid gap-2 p-5">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-full" />
            </div>
          ) : file.isError ? (
            <div className="p-5">
              <p className="text-muted">{fsError(file.error)}</p>
              <Button className="mt-3" onClick={() => goDir(parentPath(filePath))}>
                Back
              </Button>
            </div>
          ) : (
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onEditorKeyDown}
              spellCheck={false}
              className="text-ink placeholder:text-faint min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-sm leading-relaxed outline-none"
            />
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-border shrink-0 border-b px-4 py-2">
            <TextInput
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter this folder"
              spellCheck={false}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {listing.isLoading ? (
              <div className="grid gap-2 p-5">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-5/6" />
                <Skeleton className="h-8 w-2/3" />
              </div>
            ) : listing.isError ? (
              <p className="text-muted p-5">{fsError(listing.error)}</p>
            ) : !listing.data?.length ? (
              <p className="text-faint p-5">This directory is empty.</p>
            ) : !rows.length ? (
              <p className="text-faint p-5">No names match this filter.</p>
            ) : (
              <ul>
                {path !== "/" ? (
                  <li>
                    <button
                      type="button"
                      className="text-muted hover:bg-hover flex w-full items-center gap-3 px-5 py-2.5 text-left"
                      onClick={() => goDir(parentPath(path))}
                    >
                      <Folder size={16} />
                      ..
                    </button>
                  </li>
                ) : null}
                {rows.map((entry) => {
                  const Icon =
                    entry.kind === "dir" ? Folder : entry.kind === "symlink" ? Link2 : File
                  return (
                    <li key={entry.path}>
                      <button
                        type="button"
                        className="hover:bg-hover flex w-full items-center gap-3 px-5 py-2.5 text-left"
                        onClick={() => openEntry(entry)}
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
      )}
    </div>
  )
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
  return (
    <Drawer open={open} title={title} onClose={onClose}>
      {open && containerId ? <FilesPanel containerId={containerId} /> : null}
    </Drawer>
  )
}
