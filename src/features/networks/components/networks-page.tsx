import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, RefreshCw, ScanSearch, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { CopyId, InspectDrawer, RowActions, UsedBy, usageNames } from "@/components/common"
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
import { api } from "@/lib/api"
import { matchesQuery } from "@/lib/format"
import { isUnused } from "@/lib/housekeeping"
import { useNetworks } from "@/lib/queries"
import type { NetworkRow } from "@/lib/types"
import { useSelection } from "@/lib/use-selection"
import { useTableNav } from "@/lib/use-table-nav"

import { CreateNetworkDialog } from "./create-network-dialog"

function canRemove(row: NetworkRow) {
  return !row.builtin && isUnused(row)
}

export function NetworksPage() {
  const query = useNetworks()
  const { query: filter } = useFilter()
  const client = useQueryClient()
  const [inspectId, setInspectId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<NetworkRow | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)

  const rows = useMemo(
    () =>
      (query.data ?? []).filter((row) =>
        matchesQuery(filter, row.name, row.driver, row.scope, row.id, ...usageNames(row.used_by)),
      ),
    [filter, query.data],
  )
  const selection = useSelection(rows, (row) => row.id, canRemove)

  const inspect = useQuery({
    queryKey: ["network-inspect", inspectId],
    queryFn: () => api.networkInspect(inspectId!),
    enabled: Boolean(inspectId),
  })

  const { index, setIndex } = useTableNav(rows, (row) => setInspectId(row.id))
  const selected = inspectId ? rows.find((row) => row.id === inspectId) : undefined

  const remove = useMutation({
    mutationFn: async (ids: string[]) => {
      const errors: string[] = []
      for (const id of ids) {
        try {
          await api.networkRemove(id)
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
      toast.success(ids.length > 1 ? `Removed ${ids.length} networks` : "Removed network")
    },
    onError: (error) => toast.error(String(error)),
    onSettled: () => void client.invalidateQueries({ queryKey: ["networks"] }),
  })

  const body = query.isError ? (
    <EmptyState
      title="Could not list networks"
      body={String(query.error)}
      action={{ label: "Retry", onClick: () => void query.refetch(), icon: RefreshCw }}
    />
  ) : query.isLoading ? (
    <TableSkeleton />
  ) : !query.data?.length ? (
    <EmptyState
      title="No networks"
      body="No networks on this engine."
      action={{ label: "New", onClick: () => setCreateOpen(true), icon: Plus }}
    />
  ) : !rows.length ? (
    <EmptyState title="No matches" body="Nothing in this view matches the current filter." />
  ) : (
    <Table cols={["w-12", "w-[20%]", "w-[12%]", "w-[12%]", "w-[22%]", "w-[24%]", "w-0"]}>
      <THead
        columns={[
          <Checkbox
            key="all"
            checked={selection.allSelected}
            indeterminate={selection.someSelected && !selection.allSelected}
            onChange={() => selection.toggleAll()}
            aria-label="Select unused networks"
          />,
          "Name",
          "Driver",
          "Scope",
          "Used by",
          "ID",
          "",
        ]}
      />
      <tbody>
        {rows.map((row, rowIndex) => (
          <TRow
            key={row.id || row.name}
            active={rowIndex === index}
            onClick={() => setIndex(rowIndex)}
          >
            <TCell truncate={false}>
              <Checkbox
                checked={selection.ids.has(row.id)}
                disabled={!canRemove(row)}
                onChange={() => selection.toggle(row.id)}
                aria-label={`Select ${row.name}`}
              />
            </TCell>
            <TCell>{row.name}</TCell>
            <TCell className="text-muted">{row.driver}</TCell>
            <TCell className="text-muted">{row.scope}</TCell>
            <TCell>
              <UsedBy items={row.used_by} />
            </TCell>
            <TCell>
              <CopyId id={row.id} />
            </TCell>
            <RowActions>
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
                  row.builtin
                    ? "Default network"
                    : row.used_by?.length
                      ? `In use by ${usageNames(row.used_by).join(", ")}`
                      : "Remove"
                }
              >
                <IconButton
                  danger
                  disabled={!canRemove(row)}
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
          <CreateNetworkDialog open={createOpen} onOpenChange={setCreateOpen} />
        </>
      }
    >
      {body}
      <InspectDrawer
        open={Boolean(inspectId)}
        title={selected?.name ?? "Inspect network"}
        data={inspect.data}
        loading={inspect.isLoading}
        onClose={() => setInspectId(null)}
      />
      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="Remove network"
        description={`This will remove ${removeTarget?.name ?? "this network"}.`}
        confirmLabel="Remove"
        danger
        pending={remove.isPending}
        onConfirm={() => removeTarget && remove.mutate([removeTarget.id])}
        onClose={() => setRemoveTarget(null)}
      />
      <ConfirmDialog
        open={bulkOpen}
        title="Remove networks"
        description={`This will remove ${selection.selected.length} unused networks.`}
        confirmLabel="Remove"
        danger
        pending={remove.isPending}
        onConfirm={() => remove.mutate(selection.selected.map((row) => row.id))}
        onClose={() => setBulkOpen(false)}
      />
    </ListPage>
  )
}
