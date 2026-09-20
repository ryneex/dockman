import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, RefreshCw, ScanSearch, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { InspectDrawer, RowActions, UsedBy, usageNames } from "@/components/common"
import { ListPage } from "@/components/layouts"
import { useFilter } from "@/components/providers"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { IconButton } from "@/components/ui/icon-button"
import { TableSkeleton } from "@/components/ui/skeleton"
import { Table, TCell, THead, TRow } from "@/components/ui/table"
import { Tooltip } from "@/components/ui/tooltip"
import { api } from "@/lib/api"
import { matchesQuery } from "@/lib/format"
import { useVolumes } from "@/lib/queries"
import type { VolumeRow } from "@/lib/types"
import { useTableNav } from "@/lib/use-table-nav"

import { CreateVolumeDialog } from "./create-volume-dialog"

export function VolumesPage() {
  const query = useVolumes()
  const { query: filter } = useFilter()
  const client = useQueryClient()
  const [inspectName, setInspectName] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<VolumeRow | null>(null)

  const rows = useMemo(
    () =>
      (query.data ?? []).filter((row) =>
        matchesQuery(filter, row.name, row.driver, row.mountpoint, ...usageNames(row.used_by)),
      ),
    [filter, query.data],
  )

  const inspect = useQuery({
    queryKey: ["volume-inspect", inspectName],
    queryFn: () => api.volumeInspect(inspectName!),
    enabled: Boolean(inspectName),
  })

  const { index, setIndex } = useTableNav(rows, (row) => setInspectName(row.name))

  const remove = useMutation({
    mutationFn: (name: string) => api.volumeRemove(name),
    onSuccess: () => {
      setRemoveTarget(null)
      void client.invalidateQueries({ queryKey: ["volumes"] })
    },
    onError: (error) => toast.error(String(error)),
  })

  const body = query.isError ? (
    <EmptyState
      title="Could not list volumes"
      body={String(query.error)}
      action={{ label: "Retry", onClick: () => void query.refetch(), icon: RefreshCw }}
    />
  ) : query.isLoading ? (
    <TableSkeleton />
  ) : !query.data?.length ? (
    <EmptyState
      title="No volumes"
      body="No named volumes on this engine."
      action={{ label: "New", onClick: () => setCreateOpen(true), icon: Plus }}
    />
  ) : !rows.length ? (
    <EmptyState title="No matches" body="Nothing in this view matches the current filter." />
  ) : (
    <Table cols={["w-[24%]", "w-[12%]", "w-[22%]", "w-[42%]", "w-0"]}>
      <THead columns={["Name", "Driver", "Used by", "Mountpoint", ""]} />
      <tbody>
        {rows.map((row, rowIndex) => (
          <TRow key={row.name} active={rowIndex === index} onClick={() => setIndex(rowIndex)}>
            <TCell>{row.name}</TCell>
            <TCell className="text-muted">{row.driver}</TCell>
            <TCell>
              <UsedBy items={row.used_by} />
            </TCell>
            <TCell mono>{row.mountpoint}</TCell>
            <RowActions>
              <Tooltip label="Inspect">
                <IconButton
                  onClick={(event) => {
                    event.stopPropagation()
                    setInspectName(row.name)
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
    <ListPage action={<CreateVolumeDialog open={createOpen} onOpenChange={setCreateOpen} />}>
      {body}
      <InspectDrawer
        open={Boolean(inspectName)}
        title={inspectName ?? "Inspect volume"}
        data={inspect.data}
        loading={inspect.isLoading}
        onClose={() => setInspectName(null)}
      />
      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="Remove volume"
        description={`This will permanently remove ${removeTarget?.name ?? "this volume"}.`}
        confirmLabel="Remove"
        danger
        pending={remove.isPending}
        onConfirm={() => removeTarget && remove.mutate(removeTarget.name)}
        onClose={() => setRemoveTarget(null)}
      />
    </ListPage>
  )
}
