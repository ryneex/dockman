import { Eye, EyeOff } from "lucide-react"
import { useState, type ReactNode } from "react"
import { Link } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { formatAge, formatBytes } from "@/lib/format"
import { cmdFromInspect, envFromInspect, exposedPortSpecsFromInspect } from "@/lib/image-hints"
import type { ImageRow } from "@/lib/types"

function Fact({
  label,
  children,
  empty,
  action,
}: {
  label: string
  children: ReactNode
  empty?: boolean
  action?: ReactNode
}) {
  return (
    <section className="border-border border-b px-4 py-3 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted text-sm">{label}</p>
        {action}
      </div>
      <div className="mt-1.5">{empty ? <p className="text-faint text-sm">None</p> : children}</div>
    </section>
  )
}

export function ImageOverview({ row, inspect }: { row: ImageRow; inspect: unknown }) {
  const cmd = cmdFromInspect(inspect)
  const ports = exposedPortSpecsFromInspect(inspect)
  const env = envFromInspect(inspect)
  const [showEnv, setShowEnv] = useState(false)
  const [openEnv, setOpenEnv] = useState<Set<string>>(() => new Set())

  return (
    <div>
      <Fact label="Tags" empty={!row.tags.length}>
        <ul className="font-mono text-sm">
          {row.tags.map((tag) => (
            <li key={tag} className="break-all">
              {tag}
            </li>
          ))}
        </ul>
      </Fact>
      <Fact label="Size">
        <p className="tabular-nums">{formatBytes(row.size)}</p>
      </Fact>
      <Fact label="Created">
        <p>{formatAge(row.created)}</p>
      </Fact>
      <Fact label="Used by" empty={!row.used_by.length}>
        <ul className="grid gap-1 text-sm">
          {row.used_by.map((item) => (
            <li key={item.id || item.name} className="flex min-w-0 items-center gap-2">
              {item.id ? (
                <Link
                  to={`/containers/${item.id}`}
                  className="text-accent min-w-0 truncate hover:underline"
                >
                  {item.name}
                </Link>
              ) : (
                <span className="min-w-0 truncate">{item.name}</span>
              )}
              <span className="text-faint shrink-0">{item.state}</span>
            </li>
          ))}
        </ul>
      </Fact>
      <Fact label="CMD" empty={!cmd.length}>
        <pre className="font-mono text-sm whitespace-pre-wrap">{cmd.join(" ")}</pre>
      </Fact>
      <Fact label="Exposed ports" empty={!ports.length}>
        <ul className="font-mono text-sm">
          {ports.map((port) => (
            <li key={port}>{port}</li>
          ))}
        </ul>
      </Fact>
      <Fact
        label="Environment"
        empty={!env.length}
        action={
          env.length ? (
            <Button
              variant="quiet"
              className="h-7 min-w-28"
              icon={showEnv ? <EyeOff /> : <Eye />}
              onClick={() => {
                setShowEnv((current) => !current)
                setOpenEnv(new Set())
              }}
            >
              {showEnv ? "Hide values" : "Show values"}
            </Button>
          ) : null
        }
      >
        <div className="overflow-auto">
          <table className="w-full text-left text-sm">
            <tbody>
              {env.map((item, index) => {
                const id = `${item.key}-${index}`
                const visible = showEnv || openEnv.has(id)
                return (
                  <tr key={id} className="border-border border-t first:border-t-0">
                    <th className="text-muted w-[36%] max-w-0 truncate py-0 pr-3 font-mono font-medium">
                      {item.key}
                    </th>
                    <td className="py-0">
                      <div className="flex h-8 items-center gap-2">
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
      </Fact>
    </div>
  )
}
