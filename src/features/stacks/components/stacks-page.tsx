import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Trash2 } from "lucide-react"
import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { RowActions, RowName } from "@/components/common"
import { ListPage } from "@/components/layouts"
import { useFilter } from "@/components/providers"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { IconButton } from "@/components/ui/icon-button"
import { TableSkeleton } from "@/components/ui/skeleton"
import { StatusDot } from "@/components/ui/status-dot"
import { Table, TCell, THead, TRow } from "@/components/ui/table"
import { Tooltip } from "@/components/ui/tooltip"
import { api } from "@/lib/api"
import { stackRuntime } from "@/lib/compose-groups"
import { formatAge, matchesQuery } from "@/lib/format"
import { useComposeAvailable, useContainers, useStacks } from "@/lib/queries"
import type { StackRow } from "@/lib/types"
import { useTableNav } from "@/lib/use-table-nav"

import { CreateStackDialog } from "./create-stack-dialog"

export function StacksPage() {
  const query = useStacks()
  const containers = useContainers()
  const compose = useComposeAvailable()
  const { query: filter } = useFilter()
  const client = useQueryClient()
  const navigate = useNavigate()
  const [createOpen, setCreateOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<StackRow | null>(null)
  const engineRows = containers.data ?? []

  const rows = useMemo(
    () =>
      (query.data ?? []).filter((row) =>
        matchesQuery(
          filter,
          row.name,
          row.id,
          row.last_project ?? "",
          ...(row.projects ?? []),
          ...(row.services ?? []),
        ),
      ),
    [filter, query.data],
  )

  const { index, setIndex } = useTableNav(rows, (row) => void navigate(`/stacks/${row.id}`))

  const remove = useMutation({
    mutationFn: (id: string) => api.stackDelete(id),
    onSuccess: () => {
      setRemoveTarget(null)
      toast.success("Removed compose")
    },
    onError: (error) => toast.error(String(error)),
    onSettled: () => void client.invalidateQueries({ queryKey: ["stacks"] }),
  })

  const body = query.isError ? (
    <EmptyState title="Could not load compose files" body={String(query.error)} />
  ) : query.isLoading ? (
    <TableSkeleton />
  ) : !query.data?.length ? (
    <EmptyState
      title="No compose files yet"
      body="Save a compose.yml in Dockman. Add services visually or paste YAML, then start it with a project name."
    />
  ) : !rows.length ? (
    <EmptyState title="No matches" body="Nothing in this view matches the current filter." />
  ) : (
    <Table cols={["w-[30%]", "w-[28%]", "w-[20%]", "w-[14%]", "w-0"]}>
      <THead columns={["Name", "Status", "Last project", "Updated", ""]} />
      <tbody>
        {rows.map((row, rowIndex) => {
          const runtime = stackRuntime(row, engineRows)
          return (
            <TRow key={row.id} active={rowIndex === index}>
              <TCell>
                <RowName to={`/stacks/${row.id}`} onClick={() => setIndex(rowIndex)}>
                  {row.name}
                </RowName>
              </TCell>
              <TCell truncate={false}>
                <span className="inline-flex max-w-full min-w-0 items-center gap-2 overflow-hidden">
                  {runtime.services.length ? (
                    <span className="inline-flex items-center gap-1">
                      {runtime.services.map((service) => (
                        <Tooltip key={service.name} label={`${service.name} (${service.state})`}>
                          <StatusDot state={service.state} />
                        </Tooltip>
                      ))}
                    </span>
                  ) : null}
                  <span className="text-muted truncate">{runtime.label}</span>
                </span>
              </TCell>
              <TCell className="text-muted">{row.last_project || "—"}</TCell>
              <TCell className="text-muted">{formatAge(row.updated_at)}</TCell>
              <RowActions>
                <Tooltip label="Remove">
                  <IconButton
                    danger
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
          )
        })}
      </tbody>
    </Table>
  )

  return (
    <ListPage action={<CreateStackDialog open={createOpen} onOpenChange={setCreateOpen} />}>
      {compose.data === false ? (
        <p className="text-muted px-4 py-3 text-sm">
          Docker Compose is not on PATH. You can still edit compose files; Up and Down need `docker
          compose`.
        </p>
      ) : null}
      {body}
      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="Remove compose"
        description={
          removeTarget
            ? `Delete “${removeTarget.name}” from Dockman? Running containers are not removed.`
            : ""
        }
        confirmLabel="Remove"
        danger
        pending={remove.isPending}
        onConfirm={() => removeTarget && remove.mutate(removeTarget.id)}
        onClose={() => setRemoveTarget(null)}
      />
    </ListPage>
  )
}
