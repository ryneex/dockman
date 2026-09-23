import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Download, Eraser, FileDown, Play, RefreshCw, ScanSearch, Tag, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { CopyId, RowActions, RowName, UsedBy, usageNames } from "@/components/common"
import { ListPage } from "@/components/layouts"
import { useFilter } from "@/components/providers"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { IconButton } from "@/components/ui/icon-button"
import { TableSkeleton } from "@/components/ui/skeleton"
import { Table, TCell, THead, TRow } from "@/components/ui/table"
import { Tooltip } from "@/components/ui/tooltip"
import { RunContainerDialog } from "@/features/containers"
import { api } from "@/lib/api"
import { formatAge, formatBytes, matchesQuery } from "@/lib/format"
import { isUnused, pruneMessage } from "@/lib/housekeeping"
import { useImageInspect, useImages } from "@/lib/queries"
import type { ImageRow } from "@/lib/types"
import { useSelection } from "@/lib/use-selection"
import { useTableNav } from "@/lib/use-table-nav"

import { ImageInspectDrawer } from "./image-inspect-drawer"
import { LoadImageDialog } from "./load-image-dialog"
import { PullImageDialog } from "./pull-image-dialog"
import { SaveImageDialog } from "./save-image-dialog"
import { TagImageDialog } from "./tag-image-dialog"

export function ImagesPage() {
  const query = useImages()
  const { query: filter } = useFilter()
  const client = useQueryClient()
  const navigate = useNavigate()
  const [inspectId, setInspectId] = useState<string | null>(null)
  const [pullOpen, setPullOpen] = useState(false)
  const [loadOpen, setLoadOpen] = useState(false)
  const [runImage, setRunImage] = useState<string | null>(null)
  const [tagTarget, setTagTarget] = useState<ImageRow | null>(null)
  const [saveTarget, setSaveTarget] = useState<ImageRow | null>(null)
  const [removeTarget, setRemoveTarget] = useState<ImageRow | null>(null)
  const [pruneOpen, setPruneOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)

  const rows = useMemo(
    () =>
      (query.data ?? []).filter((row) =>
        matchesQuery(
          filter,
          row.id,
          row.dangling ? "dangling" : "",
          row.tags.join(" "),
          ...usageNames(row.used_by),
        ),
      ),
    [filter, query.data],
  )
  const unused = useMemo(() => (query.data ?? []).filter(isUnused), [query.data])
  const danglingCount = unused.filter((row) => row.dangling).length
  const selection = useSelection(rows, (row) => row.id, isUnused)

  const inspect = useImageInspect(inspectId)

  const { index, setIndex } = useTableNav(
    rows,
    (row) => void navigate(`/images/${encodeURIComponent(row.id)}`),
  )
  const selected = inspectId ? rows.find((row) => row.id === inspectId) : undefined

  const remove = useMutation({
    mutationFn: async (ids: string[]) => {
      const errors: string[] = []
      for (const id of ids) {
        try {
          await api.imageRemove(id)
        } catch (error) {
          errors.push(String(error))
        }
      }
      if (errors.length) throw new Error(errors[0])
    },
    onSuccess: (_data, ids) => {
      setRemoveTarget(null)
      setBulkOpen(false)
      selection.clear()
      toast.success(ids.length > 1 ? `Removed ${ids.length} images` : "Removed image")
    },
    onError: (error) => toast.error(String(error)),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["images"] })
      void client.invalidateQueries({ queryKey: ["engine"] })
    },
  })

  const prune = useMutation({
    mutationFn: api.imagesPrune,
    onSuccess: (result) => {
      setPruneOpen(false)
      toast.success(pruneMessage("images", result))
    },
    onError: (error) => toast.error(String(error)),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["images"] })
      void client.invalidateQueries({ queryKey: ["engine"] })
    },
  })

  const body = query.isError ? (
    <EmptyState
      title="Could not list images"
      body={String(query.error)}
      action={{ label: "Retry", onClick: () => void query.refetch(), icon: RefreshCw }}
    />
  ) : query.isLoading ? (
    <TableSkeleton />
  ) : !query.data?.length ? (
    <EmptyState
      title="No images"
      body="This engine has no local images."
      action={{ label: "Pull", onClick: () => setPullOpen(true), icon: Download }}
    />
  ) : !rows.length ? (
    <EmptyState title="No matches" body="Nothing in this view matches the current filter." />
  ) : (
    <Table cols={["w-12", "w-[32%]", "w-[20%]", "w-[12%]", "w-[10%]", "w-[18%]", "w-0"]}>
      <THead
        columns={[
          <Checkbox
            key="all"
            checked={selection.allSelected}
            indeterminate={selection.someSelected && !selection.allSelected}
            onChange={() => selection.toggleAll()}
            aria-label="Select unused images"
          />,
          "Tags",
          "Used by",
          "Size",
          "Age",
          "ID",
          "",
        ]}
      />
      <tbody>
        {rows.map((row, rowIndex) => (
          <TRow key={row.id} active={rowIndex === index}>
            <TCell truncate={false}>
              <Checkbox
                checked={selection.ids.has(row.id)}
                disabled={!isUnused(row)}
                onChange={() => selection.toggle(row.id)}
                aria-label={`Select ${row.tags[0] || row.id}`}
              />
            </TCell>
            <TCell truncate={false}>
              <span className="inline-flex min-w-0 items-center gap-2">
                <RowName
                  className="min-w-0"
                  to={`/images/${encodeURIComponent(row.id)}`}
                  onClick={() => setIndex(rowIndex)}
                >
                  {row.tags.join(", ") || "<none>"}
                </RowName>
                {row.dangling ? (
                  <span className="bg-hover text-faint shrink-0 rounded-full px-2 py-0.5 text-xs">
                    dangling
                  </span>
                ) : null}
              </span>
            </TCell>
            <TCell>
              <UsedBy items={row.used_by} />
            </TCell>
            <TCell className="text-muted tabular-nums">{formatBytes(row.size)}</TCell>
            <TCell className="text-muted">{formatAge(row.created)}</TCell>
            <TCell>
              <CopyId id={row.id} />
            </TCell>
            <RowActions>
              <Tooltip label="Run">
                <IconButton
                  onClick={(event) => {
                    event.stopPropagation()
                    setRunImage(row.tags[0] || row.id)
                  }}
                >
                  <Play size={16} />
                </IconButton>
              </Tooltip>
              <Tooltip label="Inspect">
                <IconButton
                  onClick={(event) => {
                    event.stopPropagation()
                    setInspectId(row.id)
                  }}
                >
                  <ScanSearch size={16} />
                </IconButton>
              </Tooltip>
              <Tooltip label="Tag">
                <IconButton
                  onClick={(event) => {
                    event.stopPropagation()
                    setTagTarget(row)
                  }}
                >
                  <Tag size={16} />
                </IconButton>
              </Tooltip>
              <Tooltip label="Save">
                <IconButton
                  onClick={(event) => {
                    event.stopPropagation()
                    setSaveTarget(row)
                  }}
                >
                  <FileDown size={16} />
                </IconButton>
              </Tooltip>
              <Tooltip
                label={
                  row.used_by?.length ? `In use by ${usageNames(row.used_by).join(", ")}` : "Remove"
                }
              >
                <IconButton
                  danger
                  disabled={(row.used_by?.length ?? 0) > 0}
                  onClick={(event) => {
                    event.stopPropagation()
                    setRemoveTarget(row)
                  }}
                >
                  <Trash2 size={16} />
                </IconButton>
              </Tooltip>
            </RowActions>
          </TRow>
        ))}
      </tbody>
    </Table>
  )

  return (
    <ListPage
      action={
        <>
          {selection.selected.length ? (
            <Button variant="danger" icon={<Trash2 />} onClick={() => setBulkOpen(true)}>
              Remove {selection.selected.length}
            </Button>
          ) : null}
          <Button icon={<Eraser />} disabled={!unused.length} onClick={() => setPruneOpen(true)}>
            Prune unused
          </Button>
          <LoadImageDialog open={loadOpen} onOpenChange={setLoadOpen} />
          <PullImageDialog open={pullOpen} onOpenChange={setPullOpen} />
        </>
      }
    >
      {body}
      <RunContainerDialog
        open={Boolean(runImage)}
        initialImage={runImage ?? ""}
        onOpenChange={(next) => {
          if (!next) setRunImage(null)
        }}
      />
      <ImageInspectDrawer
        open={Boolean(inspectId)}
        title={selected?.tags[0] ?? "Inspect image"}
        row={selected}
        data={inspect.data}
        loading={inspect.isLoading}
        error={inspect.isError ? String(inspect.error) : null}
        onClose={() => setInspectId(null)}
      />
      <TagImageDialog
        open={Boolean(tagTarget)}
        idOrName={tagTarget?.id ?? null}
        currentTag={tagTarget?.tags[0] ?? ""}
        onOpenChange={(next) => {
          if (!next) setTagTarget(null)
        }}
      />
      <SaveImageDialog
        open={Boolean(saveTarget)}
        idOrName={saveTarget?.id ?? null}
        currentTag={saveTarget?.tags[0] ?? ""}
        onOpenChange={(next) => {
          if (!next) setSaveTarget(null)
        }}
      />
      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="Remove image"
        description={`This will remove ${removeTarget?.tags[0] ?? removeTarget?.id ?? "this image"}.`}
        confirmLabel="Remove"
        danger
        pending={remove.isPending}
        onConfirm={() => removeTarget && remove.mutate([removeTarget.id])}
        onClose={() => setRemoveTarget(null)}
      />
      <ConfirmDialog
        open={bulkOpen}
        title="Remove images"
        description={`This will remove ${selection.selected.length} unused images.`}
        confirmLabel="Remove"
        danger
        pending={remove.isPending}
        onConfirm={() => remove.mutate(selection.selected.map((row) => row.id))}
        onClose={() => setBulkOpen(false)}
      />
      <ConfirmDialog
        open={pruneOpen}
        title="Prune unused images"
        description={
          danglingCount
            ? `This will remove ${unused.length} unused images, including ${danglingCount} dangling.`
            : `This will remove ${unused.length} unused images.`
        }
        confirmLabel="Prune"
        danger
        pending={prune.isPending}
        onConfirm={() => prune.mutate()}
        onClose={() => setPruneOpen(false)}
      />
    </ListPage>
  )
}
