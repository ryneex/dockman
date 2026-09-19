import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Download, Play, RefreshCw, ScanSearch, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { CopyId, InspectDrawer, RowActions, UsedBy, usageNames } from "@/components/common"
import { useFilter, usePageAction } from "@/components/providers"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { IconButton } from "@/components/ui/icon-button"
import { TableSkeleton } from "@/components/ui/skeleton"
import { Table, TCell, THead, TRow } from "@/components/ui/table"
import { Tooltip } from "@/components/ui/tooltip"
import { RunContainerDialog } from "@/features/containers"
import { api } from "@/lib/api"
import { formatAge, formatBytes, matchesQuery } from "@/lib/format"
import { useImages } from "@/lib/queries"
import type { ImageRow } from "@/lib/types"
import { useTableNav } from "@/lib/use-table-nav"

import { PullImageDialog } from "./pull-image-dialog"

export function ImagesPage() {
  const query = useImages()
  const { query: filter } = useFilter()
  const client = useQueryClient()
  const [inspectId, setInspectId] = useState<string | null>(null)
  const [pullOpen, setPullOpen] = useState(false)
  const [runImage, setRunImage] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<ImageRow | null>(null)

  usePageAction("Pull", () => setPullOpen(true), Download)

  const rows = useMemo(
    () =>
      (query.data ?? []).filter((row) =>
        matchesQuery(filter, row.id, row.tags.join(" "), ...usageNames(row.used_by)),
      ),
    [filter, query.data],
  )

  const inspect = useQuery({
    queryKey: ["image-inspect", inspectId],
    queryFn: () => api.imageInspect(inspectId!),
    enabled: Boolean(inspectId),
  })

  const { index, setIndex } = useTableNav(rows, (row) => setInspectId(row.id))
  const selected = inspectId ? rows.find((row) => row.id === inspectId) : undefined

  const remove = useMutation({
    mutationFn: (id: string) => api.imageRemove(id),
    onSuccess: () => {
      setRemoveTarget(null)
      void client.invalidateQueries({ queryKey: ["images"] })
    },
    onError: (error) => toast.error(String(error)),
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
    <Table cols={["w-[34%]", "w-[22%]", "w-[12%]", "w-[10%]", "w-[22%]", "w-0"]}>
      <THead columns={["Tags", "Used by", "Size", "Age", "ID", ""]} />
      <tbody>
        {rows.map((row, rowIndex) => (
          <TRow key={row.id} active={rowIndex === index} onClick={() => setIndex(rowIndex)}>
            <TCell>{row.tags.join(", ") || "<none>"}</TCell>
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
    <>
      {body}
      <PullImageDialog open={pullOpen} onClose={() => setPullOpen(false)} />
      <RunContainerDialog
        open={Boolean(runImage)}
        initialImage={runImage ?? ""}
        onClose={() => setRunImage(null)}
      />
      <InspectDrawer
        open={Boolean(inspectId)}
        title={selected?.tags[0] ?? "Inspect image"}
        data={inspect.data}
        loading={inspect.isLoading}
        onClose={() => setInspectId(null)}
      />
      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="Remove image"
        description={`This will remove ${removeTarget?.tags[0] ?? removeTarget?.id ?? "this image"}.`}
        confirmLabel="Remove"
        danger
        pending={remove.isPending}
        onConfirm={() => removeTarget && remove.mutate(removeTarget.id)}
        onClose={() => setRemoveTarget(null)}
      />
    </>
  )
}
