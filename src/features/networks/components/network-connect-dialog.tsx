import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Link2, Unplug } from "lucide-react"
import { useEffect, useMemo } from "react"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import { Field, Select } from "@/components/ui/field"
import { FormDialog } from "@/components/ui/form-dialog"
import { IconButton } from "@/components/ui/icon-button"
import { StatusDot } from "@/components/ui/status-dot"
import { api } from "@/lib/api"
import { useContainers } from "@/lib/queries"
import type { NetworkRow } from "@/lib/types"

const ConnectContainer = z.object({
  container: z.string().trim().min(1, "Container is required"),
})

type ConnectContainerValues = z.infer<typeof ConnectContainer>

function canAttach(network: NetworkRow) {
  return network.name !== "host" && network.name !== "none"
}

export function NetworkConnectDialog({
  open,
  network,
  onOpenChange,
}: {
  open: boolean
  network: NetworkRow | null
  onOpenChange: (open: boolean) => void
}) {
  const client = useQueryClient()
  const containers = useContainers()
  const attached = network?.used_by ?? []
  const attachable = network ? canAttach(network) : false

  const available = useMemo(() => {
    const connected = new Set(
      (network?.used_by ?? []).flatMap((item) => [item.id, item.name].filter(Boolean)),
    )
    return (containers.data ?? [])
      .filter((row) => !connected.has(row.id) && !connected.has(row.name))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [containers.data, network?.used_by])

  const canSubmit = attachable && available.length > 0

  const form = useForm({
    resolver: zodResolver(ConnectContainer),
    defaultValues: { container: "" },
  })

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: async ({ container }: ConnectContainerValues) => {
      if (!network) throw new Error("Network is required")
      await api.networkConnect(network.id, container)
    },
    onSuccess: async () => {
      form.reset({ container: "" })
      toast.success("Connected container")
      await client.invalidateQueries({ queryKey: ["networks"] })
      await client.invalidateQueries({ queryKey: ["containers"] })
    },
  })

  const disconnect = useMutation({
    mutationFn: async (container: string) => {
      if (!network) throw new Error("Network is required")
      await api.networkDisconnect(network.id, container)
    },
    onSuccess: async () => {
      toast.success("Disconnected container")
      await client.invalidateQueries({ queryKey: ["networks"] })
      await client.invalidateQueries({ queryKey: ["containers"] })
    },
    onError: (err) => toast.error(String(err)),
  })

  useEffect(() => {
    if (!open) return
    form.reset({ container: "" })
    reset()
  }, [form, open, reset, network?.id])

  return (
    <FormDialog
      open={open}
      title={network ? `Containers on ${network.name}` : "Network containers"}
      description={
        attachable
          ? "Connect another container, or disconnect one already attached. Multi-network apps need connect, not just the run-dialog network."
          : "The host and none networks do not accept extra endpoints. Disconnect is still attempted if Docker allows it."
      }
      confirmLabel={canSubmit ? "Connect" : "Done"}
      confirmIcon={canSubmit ? <Link2 /> : undefined}
      pending={isPending}
      error={error ? String(error) : null}
      onSubmit={
        canSubmit
          ? form.handleSubmit((values) => mutate(values))
          : (event) => {
              event.preventDefault()
              onOpenChange(false)
            }
      }
      onOpenChange={onOpenChange}
    >
      {canSubmit ? (
        <Controller
          name="container"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field label="Container" errors={[fieldState.error]}>
              <Select
                value={field.value}
                onValueChange={field.onChange}
                items={[
                  { value: "", label: "Select a container" },
                  ...available.map((row) => ({
                    value: row.id,
                    label: `${row.name} (${row.state})`,
                  })),
                ]}
              />
            </Field>
          )}
        />
      ) : attachable ? (
        <p className="text-faint text-sm">
          {containers.data?.length
            ? "Every container is already on this network."
            : "No containers on this engine."}
        </p>
      ) : null}
      <div className="grid gap-1.5">
        <span className="text-muted text-sm">Connected</span>
        {attached.length ? (
          <ul className="border-border divide-border divide-y rounded-[8px] border">
            {attached.map((item) => (
              <li
                key={item.id || item.name}
                className="flex items-center gap-2 px-2.5 py-2 text-sm"
              >
                <StatusDot state={item.state} />
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                <span className="text-muted shrink-0">{item.state}</span>
                <IconButton
                  danger
                  disabled={disconnect.isPending}
                  onClick={() => disconnect.mutate(item.id || item.name)}
                  aria-label={`Disconnect ${item.name}`}
                >
                  <Unplug size={16} />
                </IconButton>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-faint text-sm">No containers on this network.</p>
        )}
      </div>
    </FormDialog>
  )
}
