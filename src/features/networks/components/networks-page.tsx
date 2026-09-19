import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, RefreshCw, ScanSearch, Trash2 } from "lucide-react"
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
import { api } from "@/lib/api"
import { matchesQuery } from "@/lib/format"
import { useNetworks } from "@/lib/queries"
import type { NetworkRow } from "@/lib/types"
import { useTableNav } from "@/lib/use-table-nav"

import { CreateNetworkDialog } from "./create-network-dialog"

export function NetworksPage() {
  const query = useNetworks()
  const { query: filter } = useFilter()
  const client = useQueryClient()
  const [inspectId, setInspectId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<NetworkRow | null>(null)

  usePageAction("New", () => setCreateOpen(true), Plus)

  const rows = useMemo(
    () =>
      (query.data ?? []).filter((row) =>
        matchesQuery(filter, row.name, row.driver, row.scope, row.id, ...usageNames(row.used_by)),
      ),
    [filter, query.data],
  )

  const inspect = useQuery({
    queryKey: ["network-inspect", inspectId],
    queryFn: () => api.networkInspect(inspectId!),
    enabled: Boolean(inspectId),
  })

  const { index, setIndex } = useTableNav(rows, (row) => setInspectId(row.id))
  const selected = inspectId ? rows.find((row) => row.id === inspectId) : undefined

  const remove = useMutation({
    mutationFn: (id: string) => api.networkRemove(id),
    onSuccess: () => {
      setRemoveTarget(null)
      void client.invalidateQueries({ queryKey: ["networks"] })
    },
    onError: (error) => toast.error(String(error)),
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
    <Table cols={["w-[22%]", "w-[14%]", "w-[12%]", "w-[24%]", "w-[28%]", "w-0"]}>
      <THead columns={["Name", "Driver", "Scope", "Used by", "ID", ""]} />
      <tbody>
        {rows.map((row, rowIndex) => (
          <TRow
            key={row.id || row.name}
            active={rowIndex === index}
            onClick={() => setIndex(rowIndex)}
          >
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
                  disabled={row.builtin || (row.used_by?.length ?? 0) > 0}
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
      <CreateNetworkDialog open={createOpen} onClose={() => setCreateOpen(false)} />
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
        onConfirm={() => removeTarget && remove.mutate(removeTarget.id)}
        onClose={() => setRemoveTarget(null)}
      />
    </>
  )
}
