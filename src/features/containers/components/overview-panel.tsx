import { useQuery } from "@tanstack/react-query"
import { Copy, CopyPlus, Eye, EyeOff } from "lucide-react"
import { useState, type ReactNode } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { TableSkeleton } from "@/components/ui/skeleton"
import { StatusChip } from "@/components/ui/status-dot"
import { Tooltip } from "@/components/ui/tooltip"
import { api } from "@/lib/api"
import { formatDotenv } from "@/lib/dotenv"
import { hostTcpPort, openPublishedPort } from "@/lib/open-port"
import { healthTone, overviewStateFromInspect } from "@/lib/overview-state"
import { overviewFromInspect } from "@/lib/run-from-inspect"
import type { ContainerRow } from "@/lib/types"

function Section({
  title,
  action,
  children,
  empty,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
  empty?: boolean
}) {
  return (
    <section className="border-border bg-elevated rounded-[12px] border p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-muted text-sm tracking-[-0.02em]">{title}</h2>
        {action}
      </div>
      <div className="mt-3">{empty ? <p className="text-faint text-sm">None</p> : children}</div>
    </section>
  )
}

export function OverviewPanel({ row, onRecreate }: { row: ContainerRow; onRecreate: () => void }) {
  const inspect = useQuery({
    queryKey: ["container-inspect", row.id],
    queryFn: () => api.containerInspect(row.id),
  })
  const overview = overviewFromInspect(inspect.data)
  const state = overviewStateFromInspect(inspect.data)
  const [showEnv, setShowEnv] = useState(false)
  const [openEnv, setOpenEnv] = useState<Set<string>>(() => new Set())
  const networks = state?.networks.length
    ? state.networks
    : (overview?.networks ?? []).map((name) => ({ name, ip: "" }))

  if (inspect.isLoading) {
    return (
      <div className="p-4">
        <TableSkeleton />
      </div>
    )
  }

  if (inspect.isError || !overview) {
    return (
      <p className="text-muted p-5">{inspect.error ? String(inspect.error) : "No inspect data."}</p>
    )
  }

  const env = overview.env

  async function copyEnv() {
    try {
      await navigator.clipboard.writeText(formatDotenv(env))
      toast.success("Copied .env")
    } catch (error) {
      toast.error(String(error))
    }
  }

  return (
    <div className="h-full min-h-0 overflow-auto p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-faint text-sm">Image</p>
          <p className="truncate">{overview.image}</p>
        </div>
        <Button icon={<CopyPlus />} onClick={onRecreate}>
          Recreate
        </Button>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <Section title="State">
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-faint text-sm">Health</dt>
                <dd className="mt-1 text-sm">
                  {state?.health ? (
                    <StatusChip state={healthTone(state.health)} label={state.health} />
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-faint text-sm">Exit code</dt>
                <dd className="mt-1 font-mono text-sm">
                  {state?.exitCode == null ? "—" : state.exitCode}
                </dd>
              </div>
              <div>
                <dt className="text-faint text-sm">Started</dt>
                <dd className="mt-1 text-sm">{state?.startedAt || "—"}</dd>
              </div>
              <div>
                <dt className="text-faint text-sm">Finished</dt>
                <dd className="mt-1 text-sm">{state?.finishedAt || "—"}</dd>
              </div>
            </dl>
          </Section>
        </div>
        <Section title="Command" empty={!overview.cmd}>
          <pre className="font-mono text-sm whitespace-pre-wrap">{overview.cmd}</pre>
        </Section>
        <Section title="Entrypoint" empty={!overview.entrypoint}>
          <pre className="font-mono text-sm whitespace-pre-wrap">{overview.entrypoint}</pre>
        </Section>
        <Section title="Ports" empty={!overview.ports.length}>
          <ul className="font-mono text-sm">
            {overview.ports.map((port) => {
              const host = hostTcpPort(port, true)
              return (
                <li key={port} className="flex items-center gap-2">
                  <span className="min-w-0 break-all">{port}</span>
                  {host ? (
                    <button
                      type="button"
                      className="text-muted hover:text-ink shrink-0 text-sm"
                      aria-label={`Open http://127.0.0.1:${host}`}
                      onClick={() => void openPublishedPort(host)}
                    >
                      Open
                    </button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </Section>
        <Section title="Restart" empty={!overview.restart}>
          <p className="text-sm">{overview.restart}</p>
        </Section>
        <Section title="Mounts" empty={!overview.mounts.length}>
          <ul className="font-mono text-sm">
            {overview.mounts.map((mount) => (
              <li key={mount} className="break-all">
                {mount}
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Networks" empty={!networks.length}>
          <ul className="text-sm">
            {networks.map((network) => (
              <li key={network.name} className="flex min-w-0 items-baseline gap-2">
                <span className="min-w-0 truncate">{network.name}</span>
                {network.ip ? <span className="text-muted font-mono">{network.ip}</span> : null}
              </li>
            ))}
          </ul>
        </Section>
        <div className="lg:col-span-2">
          <Section
            title="Environment"
            empty={!overview.env.length}
            action={
              overview.env.length ? (
                <div className="flex items-center gap-1">
                  <Tooltip label="Copy as .env">
                    <IconButton aria-label="Copy as .env" onClick={() => void copyEnv()}>
                      <Copy size={16} />
                    </IconButton>
                  </Tooltip>
                  <Button
                    variant="quiet"
                    className="min-w-36"
                    icon={showEnv ? <EyeOff /> : <Eye />}
                    onClick={() => {
                      setShowEnv((current) => !current)
                      setOpenEnv(new Set())
                    }}
                  >
                    {showEnv ? "Hide values" : "Show values"}
                  </Button>
                </div>
              ) : null
            }
          >
            <div className="overflow-auto">
              <table className="w-full text-left text-sm">
                <tbody>
                  {overview.env.map((item, index) => {
                    const id = `${item.key}-${index}`
                    const visible = showEnv || openEnv.has(id)
                    return (
                      <tr key={id} className="border-border border-t first:border-t-0">
                        <th className="text-muted w-[30%] max-w-0 truncate py-0 pr-3 font-mono font-medium">
                          {item.key}
                        </th>
                        <td className="py-0">
                          <div className="flex h-9 items-center gap-2">
                            <span
                              className="min-w-0 flex-1 truncate font-mono"
                              title={visible ? item.value : undefined}
                            >
                              {visible ? item.value : "••••••••"}
                            </span>
                            <IconButton
                              className="size-7 shrink-0"
                              aria-label={visible ? `Hide ${item.key}` : `Show ${item.key}`}
                              onClick={() => {
                                setOpenEnv((current) => {
                                  const next = new Set(current)
                                  if (next.has(id)) next.delete(id)
                                  else next.add(id)
                                  return next
                                })
                              }}
                            >
                              {visible ? <EyeOff size={14} /> : <Eye size={14} />}
                            </IconButton>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
      </div>
    </div>
  )
}
