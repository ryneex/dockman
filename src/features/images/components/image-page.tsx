import { useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, RefreshCw } from "lucide-react"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useNavigate, useParams } from "react-router-dom"

import { CopyId } from "@/components/common"
import { EmptyState } from "@/components/ui/empty-state"
import { TextInput } from "@/components/ui/field"
import { IconButton } from "@/components/ui/icon-button"
import { TableSkeleton } from "@/components/ui/skeleton"
import { Table, TCell, THead, TRow } from "@/components/ui/table"
import { formatAge, formatBytes, shortId } from "@/lib/format"
import { workingDirFromInspect } from "@/lib/image-hints"
import {
  capLayerFilePreview,
  useImageHistory,
  useImageInspect,
  useImageLayerDiffs,
  useImageLayerFile,
  useImages,
} from "@/lib/queries"
import {
  PREVIEW_MAX_BYTES,
  type FileKind,
  type ImageHistoryRow,
  type ImageLayerDiffs,
  type ImageRow,
  type LayerFile,
  type LayerFilePreview,
} from "@/lib/types"
import { cn } from "@/lib/utils"

import { ChangeTree } from "./change-tree"

function decodeParam(raw: string) {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function findImage(rows: ImageRow[] | undefined, raw: string) {
  const needle = raw.trim()
  if (!needle || !rows?.length) return undefined
  const exact = rows.find((row) => row.id === needle)
  if (exact) return exact
  const tagged = rows.find((row) => row.tags.includes(needle))
  if (tagged) return tagged
  const bare = needle.replace(/^sha256:/, "")
  const matches = rows.filter((row) => {
    const id = row.id.replace(/^sha256:/, "")
    return id.startsWith(bare) || row.id.endsWith(needle)
  })
  return matches.length === 1 ? matches[0] : undefined
}

function layerIndexForStage(stages: ImageHistoryRow[], index: number): number | null {
  const row = stages[index]
  if (!row || row.empty) return null
  return stages.slice(index + 1).filter((item) => !item.empty).length
}

function currentFiles(
  stages: ImageHistoryRow[],
  diffs: ImageLayerDiffs | undefined,
  index: number,
): LayerFile[] {
  if (!diffs || index < 0) return []
  const current = new Map<string, { path: string; size: number }>()
  for (let stage = 0; stage <= index; stage += 1) {
    const layerIndex = layerIndexForStage(stages, stage)
    if (layerIndex == null) continue
    for (const change of diffs.layers[layerIndex]?.changes ?? []) {
      if (change.kind === "deleted") current.delete(change.path)
      else current.set(change.path, { path: change.path, size: change.size })
    }
  }

  const thisLayer = layerIndexForStage(stages, index)
  const thisChanges = thisLayer != null ? (diffs.layers[thisLayer]?.changes ?? []) : []
  const thisByPath = new Map(thisChanges.map((change) => [change.path, change]))

  const rows: LayerFile[] = []
  for (const file of current.values()) {
    const change = thisByPath.get(file.path)
    rows.push({
      path: file.path,
      kind: change?.kind === "added" || change?.kind === "modified" ? change.kind : "unchanged",
      size: file.size,
    })
  }
  for (const change of thisChanges) {
    if (change.kind === "deleted" && !current.has(change.path)) {
      rows.push({ path: change.path, kind: "deleted", size: change.size })
    }
  }
  return rows
}

function lastWriteLayerIndex(
  stages: ImageHistoryRow[],
  diffs: ImageLayerDiffs | undefined,
  stageIndex: number,
  path: string,
): number | null {
  if (!diffs) return null
  for (let index = stageIndex; index >= 0; index -= 1) {
    const layerIndex = layerIndexForStage(stages, index)
    if (layerIndex == null) continue
    const change = diffs.layers[layerIndex]?.changes.find((item) => item.path === path)
    if (!change) continue
    if (change.kind === "deleted") return null
    return layerIndex
  }
  return null
}

const layerFileQueryKey = ["image-layer-file"] as const

export function ImagePage() {
  const { id: rawId = "" } = useParams()
  const id = decodeParam(rawId)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const images = useImages()
  const row = findImage(images.data, id)
  const history = useImageHistory(id)
  const inspect = useImageInspect(id || null)
  const diffs = useImageLayerDiffs(id)
  const workingDir = useMemo(() => workingDirFromInspect(inspect.data), [inspect.data])
  const [selected, setSelected] = useState(0)
  const [filter, setFilter] = useState("")
  const [filePath, setFilePath] = useState<string | null>(null)
  const [fileKind, setFileKind] = useState<FileKind | null>(null)
  const previewRequest = useRef(0)
  const [previewEpoch, setPreviewEpoch] = useState(0)

  const stages = useMemo(() => [...(history.data ?? [])].reverse(), [history.data])

  function dropLayerFileQuery() {
    previewRequest.current += 1
    setPreviewEpoch(previewRequest.current)
    void queryClient.cancelQueries({ queryKey: layerFileQueryKey })
    queryClient.removeQueries({ queryKey: layerFileQueryKey })
  }

  function clearSelectedFile() {
    dropLayerFileQuery()
    setFilePath(null)
    setFileKind(null)
  }

  useEffect(() => {
    setSelected(Math.max(0, stages.length - 1))
    setFilter("")
    previewRequest.current += 1
    setPreviewEpoch(previewRequest.current)
    setFilePath(null)
    setFileKind(null)
    void queryClient.cancelQueries({ queryKey: layerFileQueryKey })
    queryClient.removeQueries({ queryKey: layerFileQueryKey })
  }, [id, stages.length, queryClient])

  useEffect(() => {
    return () => {
      void queryClient.cancelQueries({ queryKey: layerFileQueryKey })
      queryClient.removeQueries({ queryKey: layerFileQueryKey })
    }
  }, [queryClient])

  const stage = stages[selected]
  const files = useMemo(
    () => currentFiles(stages, diffs.data, selected),
    [diffs.data, selected, stages],
  )
  const writeLayer =
    filePath && fileKind !== "deleted"
      ? lastWriteLayerIndex(stages, diffs.data, selected, filePath)
      : null
  const previewQuery = useImageLayerFile(
    id,
    writeLayer,
    fileKind === "deleted" ? null : filePath,
    previewEpoch,
  )
  const preview =
    filePath && fileKind !== "deleted"
      ? {
          ...previewQuery,
          data:
            previewQuery.data?.path === filePath
              ? capLayerFilePreview(previewQuery.data)
              : undefined,
        }
      : {
          data: undefined,
          isLoading: false,
          isError: false,
          error: null,
          refetch: () => undefined,
        }
  const title = row?.tags[0] || (id.startsWith("sha256:") ? shortId(id) : id || "Image")

  function selectStage(index: number) {
    setSelected(index)
    clearSelectedFile()
  }

  function selectFile(path: string, kind: FileKind) {
    dropLayerFileQuery()
    setFilePath(path)
    setFileKind(kind)
  }

  function closeFile() {
    clearSelectedFile()
  }

  if (history.isError) {
    return (
      <EmptyState
        title="Could not load image history"
        body={String(history.error)}
        action={{
          label: "Retry",
          onClick: () => void history.refetch(),
          icon: RefreshCw,
        }}
      />
    )
  }

  if (history.isLoading) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <TableSkeleton />
      </div>
    )
  }

  if (!stages.length) {
    return (
      <EmptyState
        title="No history"
        body="This image has no history entries."
        action={{ label: "Back to images", onClick: () => void navigate("/images") }}
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border shrink-0 border-b">
        <div className="flex items-center gap-3 px-4 py-3">
          <IconButton aria-label="Back to images" onClick={() => void navigate("/images")}>
            <ArrowLeft size={16} />
          </IconButton>
          <div className="min-w-0 flex-1">
            <h1 className="truncate tracking-[-0.03em]">{title}</h1>
            <div className="text-muted mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              {row ? <span className="tabular-nums">{formatBytes(row.size)}</span> : null}
              {row ? <span>{formatAge(row.created)}</span> : null}
              <CopyId id={row?.id ?? id} />
            </div>
          </div>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <aside className="border-border flex min-h-0 w-[min(36rem,46%)] shrink-0 flex-col border-r">
          <div className="px-4 py-2">
            <p className="text-muted text-sm">Stages</p>
          </div>
          <div className="min-h-0 flex-1">
            <Table cols={["w-[auto]", "w-20"]}>
              <THead columns={["Created by", "Size"]} />
              <tbody>
                {stages.map((item, index) => (
                  <TRow
                    key={`${item.created}-${index}`}
                    active={index === selected}
                    onClick={() => selectStage(index)}
                  >
                    <TCell>
                      <span
                        className={cn("font-mono text-sm", item.empty && "text-muted")}
                        title={item.created_by}
                      >
                        {item.created_by || "—"}
                      </span>
                    </TCell>
                    <TCell className="text-muted tabular-nums">{formatBytes(item.size)}</TCell>
                  </TRow>
                ))}
              </tbody>
            </Table>
          </div>
        </aside>
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <LayerPane
            emptyStage={Boolean(stage?.empty)}
            files={files}
            filter={filter}
            onFilter={setFilter}
            selectedPath={filePath}
            onSelectFile={selectFile}
            onCloseFile={closeFile}
            fileKind={fileKind}
            preview={preview}
            diffsError={diffs.isError ? String(diffs.error) : null}
            diffsLoading={diffs.isLoading}
            note={diffs.data?.note}
            workingDir={workingDir}
            onRetry={() => void diffs.refetch()}
          />
        </section>
      </div>
    </div>
  )
}

function LayerPane({
  emptyStage,
  files,
  filter,
  onFilter,
  selectedPath,
  onSelectFile,
  onCloseFile,
  fileKind,
  preview,
  diffsError,
  diffsLoading,
  note,
  workingDir,
  onRetry,
}: {
  emptyStage: boolean
  files: LayerFile[]
  filter: string
  onFilter: (value: string) => void
  selectedPath: string | null
  onSelectFile: (path: string, kind: FileKind) => void
  onCloseFile: () => void
  fileKind: FileKind | null
  preview: {
    data?: LayerFilePreview
    isLoading: boolean
    isError: boolean
    error: unknown
    refetch: () => unknown
  }
  diffsError: string | null
  diffsLoading: boolean
  note?: string | null
  workingDir: string
  onRetry: () => void
}) {
  const banner = note ? (
    <p className="text-muted border-border shrink-0 border-b px-4 py-2 text-sm">{note}</p>
  ) : null

  let body: ReactNode
  if (diffsError) {
    body = (
      <EmptyState
        title="Could not load layer changes"
        body={diffsError}
        action={{ label: "Retry", onClick: onRetry, icon: RefreshCw }}
      />
    )
  } else if (diffsLoading) {
    body = <TableSkeleton rows={10} cols={3} />
  } else if (!files.length) {
    body = (
      <EmptyState
        title="No files"
        body={
          emptyStage
            ? "This stage only updates image config, and no earlier layer added files."
            : "This layer did not leave any files in the image."
        }
      />
    )
  } else {
    body = selectedPath ? (
      <FilePreview
        key={selectedPath}
        path={selectedPath}
        kind={fileKind}
        data={preview.data}
        loading={preview.isLoading}
        error={preview.isError ? String(preview.error) : null}
        onRetry={() => void preview.refetch()}
        onBack={onCloseFile}
      />
    ) : (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-border flex shrink-0 items-center gap-3 border-b px-4 py-2">
          <TextInput
            value={filter}
            onChange={(event) => onFilter(event.target.value)}
            placeholder="Filter paths"
            spellCheck={false}
            aria-label="Filter paths"
          />
          <span className="text-faint shrink-0 text-sm tabular-nums">
            {files.length} path{files.length === 1 ? "" : "s"}
          </span>
        </div>
        <ChangeTree
          changes={files}
          filter={filter}
          selectedPath={selectedPath}
          onSelectFile={onSelectFile}
          workingDir={workingDir}
        />
      </div>
    )
  }

  return (
    <>
      {banner}
      {body}
    </>
  )
}

function FilePreview({
  path,
  kind,
  data,
  loading,
  error,
  onRetry,
  onBack,
}: {
  path: string | null
  kind: FileKind | null
  data?: LayerFilePreview
  loading: boolean
  error: string | null
  onRetry: () => void
  onBack: () => void
}) {
  const [showBody, setShowBody] = useState(true)
  const preview = data ? capLayerFilePreview(data) : undefined
  const text = (preview?.text ?? "").slice(0, PREVIEW_MAX_BYTES)

  function handleBack() {
    setShowBody(false)
    onBack()
  }

  let content: ReactNode
  if (!showBody || !path) {
    content = null
  } else if (kind === "deleted") {
    content = <EmptyState title="Deleted" body="This file was removed in this stage." />
  } else if (loading) {
    content = <TableSkeleton rows={8} cols={1} />
  } else if (error) {
    content = (
      <EmptyState
        title="Could not read file"
        body={error}
        action={{ label: "Retry", onClick: onRetry, icon: RefreshCw }}
      />
    )
  } else if (!preview) {
    content = <EmptyState title="No file selected" body="Select a file to preview its contents." />
  } else if (preview.kind === "binary") {
    content = (
      <EmptyState
        title="Binary file"
        body={`${formatBytes(preview.size)}${preview.truncated ? " · too large to preview" : ""}`}
      />
    )
  } else {
    content = (
      <pre className="text-ink min-h-0 flex-1 overflow-auto p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap">
        {text}
      </pre>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-border flex shrink-0 items-center gap-3 border-b px-4 py-2">
        <IconButton aria-label="Back to files" onClick={handleBack}>
          <ArrowLeft size={16} />
        </IconButton>
        <div className="text-muted flex min-w-0 flex-1 items-center font-mono text-sm">
          <span className="truncate" title={path ?? undefined}>
            {path}
          </span>
          {showBody && preview?.kind === "text" && preview.truncated ? (
            <span className="text-faint shrink-0"> · truncated to 256 KiB</span>
          ) : null}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{content}</div>
    </div>
  )
}
