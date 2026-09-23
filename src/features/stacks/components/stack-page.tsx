import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, Play, Plus, Save, Square, Trash2 } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { toast } from "sonner"

import { CopyId, RowName } from "@/components/common"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { TextArea, TextInput } from "@/components/ui/field"
import { IconButton } from "@/components/ui/icon-button"
import { TableSkeleton } from "@/components/ui/skeleton"
import { StatusChip, StatusDot } from "@/components/ui/status-dot"
import { Table, TCell, THead, TRow } from "@/components/ui/table"
import { PortList } from "@/features/containers/components/port-list"
import { api } from "@/lib/api"
import {
  addService,
  emptyService,
  listHealthyServices,
  listServices,
  parseCompose,
  readService,
  removeService,
  renameService,
  toYaml,
  uniqueServiceName,
  writeService,
  type ComposeDoc,
  type ComposeServiceFlags,
  type ComposeServiceValues,
} from "@/lib/compose-doc"
import { stackProjectGroups, type StackProjectGroup } from "@/lib/compose-groups"
import { formatAge } from "@/lib/format"
import { useComposeAvailable, useContainers, useStack } from "@/lib/queries"
import type { ContainerRow, StackDetail } from "@/lib/types"
import { cn } from "@/lib/utils"

import { ServiceForm } from "./service-form"
import { StackUpDialog } from "./stack-up-dialog"

type Tab = "services" | "yaml" | "projects"

function tabFromQuery(value: string | null): Tab {
  if (value === "yaml" || value === "projects" || value === "services") return value
  return "services"
}

export function StackPage() {
  const { id = "" } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const client = useQueryClient()
  const query = useStack(id)
  const containers = useContainers()
  const compose = useComposeAvailable()
  const [name, setName] = useState("")
  const [yaml, setYaml] = useState("")
  const [doc, setDoc] = useState<ComposeDoc | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const tab = tabFromQuery(searchParams.get("tab"))
  const [upOpen, setUpOpen] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)

  function selectTab(next: Tab) {
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current)
        if (next === "services") params.delete("tab")
        else params.set("tab", next)
        return params
      },
      { replace: true },
    )
  }
  const flags = useRef<Record<string, ComposeServiceFlags>>({})
  const loaded = useRef<string | null>(null)

  useEffect(() => {
    if (!query.data || loaded.current === query.data.id + String(query.data.updated_at)) return
    loaded.current = query.data.id + String(query.data.updated_at)
    setName(query.data.name)
    applyYaml(query.data.yaml, false)
    setDirty(false)
  }, [query.data])

  function applyYaml(text: string, markDirty: boolean) {
    setYaml(text)
    try {
      const parsed = parseCompose(text)
      setDoc(parsed)
      setParseError(null)
      const names = listServices(parsed)
      setSelected((current) => (current && names.includes(current) ? current : (names[0] ?? null)))
      if (markDirty) setDirty(true)
    } catch (error) {
      setDoc(null)
      setParseError(error instanceof Error ? error.message : String(error))
      if (markDirty) setDirty(true)
    }
  }

  function patch(mutator: (next: ComposeDoc) => void) {
    if (!doc) return
    const next = doc.clone() as ComposeDoc
    mutator(next)
    setDoc(next)
    setYaml(toYaml(next))
    setDirty(true)
  }

  const services = useMemo(() => (doc ? listServices(doc) : []), [doc])
  const healthyServices = useMemo(() => (doc ? listHealthyServices(doc) : []), [doc])
  const selectedRead = selected && doc ? readService(doc, selected) : null
  if (selected && selectedRead) flags.current[selected] = selectedRead.flags

  const save = useMutation({
    mutationFn: async () => {
      if (parseError) throw new Error(parseError)
      await api.stackWrite(id, name, yaml)
    },
    onSuccess: async () => {
      setDirty(false)
      loaded.current = null
      toast.success("Saved compose")
      await Promise.all([
        client.invalidateQueries({ queryKey: ["stack", id] }),
        client.invalidateQueries({ queryKey: ["stacks"] }),
      ])
    },
    onError: (error) => toast.error(String(error)),
  })

  const remove = useMutation({
    mutationFn: () => api.stackDelete(id),
    onSuccess: async () => {
      toast.success("Removed compose")
      await client.invalidateQueries({ queryKey: ["stacks"] })
      void navigate("/stacks")
    },
    onError: (error) => toast.error(String(error)),
  })

  if (query.isError) {
    return (
      <EmptyState
        title="Could not load compose"
        body={String(query.error)}
        action={{ label: "Back to compose", onClick: () => void navigate("/stacks") }}
      />
    )
  }

  if (query.isLoading || !query.data) {
    return (
      <div className="p-4">
        <TableSkeleton />
      </div>
    )
  }

  const defaultProject = query.data.last_project || query.data.id

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border shrink-0 border-b">
        <div className="flex items-center gap-3 px-4 py-3">
          <IconButton aria-label="Back to compose" onClick={() => void navigate("/stacks")}>
            <ArrowLeft size={16} />
          </IconButton>
          <div className="min-w-0 flex-1">
            <TextInput
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setDirty(true)
              }}
              className="h-9 max-w-md text-base tracking-[-0.03em]"
              aria-label="Compose name"
            />
            <p className="text-faint mt-1 text-sm">
              {services.length} service{services.length === 1 ? "" : "s"}
              {dirty ? " · unsaved" : ""}
              {compose.data === false ? " · docker compose not found" : ""}
            </p>
          </div>
          <Button
            icon={<Save />}
            disabled={!dirty || Boolean(parseError)}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
          <Button
            variant="primary"
            icon={<Play />}
            disabled={Boolean(parseError) || compose.data === false}
            onClick={() => setUpOpen(true)}
          >
            Up
          </Button>
          <IconButton aria-label="Remove compose" onClick={() => setRemoveOpen(true)}>
            <Trash2 size={16} />
          </IconButton>
        </div>
        <nav className="flex gap-1 px-4">
          {(
            [
              ["services", "Services"],
              ["yaml", "YAML"],
              ["projects", "Projects"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => selectTab(value)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
                tab === value
                  ? "border-accent text-ink"
                  : "text-muted hover:text-ink border-transparent",
              )}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "yaml" ? (
          <TextArea
            value={yaml}
            onChange={(event) => applyYaml(event.target.value, true)}
            spellCheck={false}
            className="h-full min-h-full resize-none rounded-none border-0 font-mono text-sm"
          />
        ) : tab === "projects" ? (
          <StackProjects
            stack={query.data}
            containers={containers.data ?? []}
            composeAvailable={compose.data !== false}
          />
        ) : parseError || !doc ? (
          <EmptyState
            title="YAML does not parse"
            body={parseError ?? "Fix the compose file in the YAML tab."}
            action={{ label: "Open YAML", onClick: () => selectTab("yaml") }}
          />
        ) : (
          <div className="flex h-full min-h-0">
            <aside className="border-border flex w-56 shrink-0 flex-col border-r">
              <div className="flex items-center justify-between px-3 py-2">
                <p className="text-muted text-sm">Services</p>
                <IconButton
                  aria-label="Add service"
                  onClick={() => {
                    patch((next) => {
                      const added = addService(next, uniqueServiceName(next))
                      setSelected(added)
                    })
                  }}
                >
                  <Plus size={16} />
                </IconButton>
              </div>
              <ul className="min-h-0 flex-1 overflow-auto px-2 pb-2">
                {services.map((service) => (
                  <li key={service}>
                    <button
                      type="button"
                      onClick={() => setSelected(service)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-sm",
                        selected === service
                          ? "bg-accent-glow text-ink"
                          : "text-muted hover:bg-hover hover:text-ink",
                      )}
                    >
                      <span className="min-w-0 truncate">{service}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
            <div className="min-h-0 flex-1 overflow-auto p-4">
              {selected && selectedRead ? (
                <div className="mx-auto grid max-w-3xl gap-4">
                  <div className="flex justify-end">
                    <Button
                      variant="quiet"
                      icon={<Trash2 />}
                      onClick={() => {
                        const current = selected
                        patch((next) => {
                          removeService(next, current)
                          const names = listServices(next)
                          setSelected(names[0] ?? null)
                        })
                      }}
                    >
                      Remove service
                    </Button>
                  </div>
                  <ServiceForm
                    key={selected}
                    serviceName={selected}
                    values={selectedRead.values}
                    skipMemory={selectedRead.flags.skipMemory}
                    keepDependsOnObject={selectedRead.flags.keepDependsOnObject}
                    otherServices={services.filter((name) => name !== selected)}
                    healthyServices={healthyServices.filter((name) => name !== selected)}
                    onChange={(values: ComposeServiceValues) => {
                      const current = selected
                      const serviceFlags = flags.current[current]
                      patch((next) => writeService(next, current, values, serviceFlags))
                    }}
                    onRename={(nextName) => {
                      try {
                        patch((next) => {
                          const renamed = renameService(next, selected, nextName)
                          setSelected(renamed)
                        })
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : String(error))
                      }
                    }}
                  />
                </div>
              ) : (
                <EmptyState
                  title="No services"
                  body="Add a service, or paste Compose YAML."
                  action={{
                    label: "Add service",
                    onClick: () => {
                      patch((next) => {
                        const added = addService(next, uniqueServiceName(next), emptyService())
                        setSelected(added)
                      })
                    },
                  }}
                />
              )}
            </div>
          </div>
        )}
      </div>
      {upOpen ? (
        <StackUpDialog
          open
          mode="up"
          stackId={id}
          stackName={name}
          defaultProject={defaultProject}
          onOpenChange={(open) => {
            if (!open) setUpOpen(false)
          }}
        />
      ) : null}
      <ConfirmDialog
        open={removeOpen}
        title="Remove compose"
        description={`Delete “${name}” from Dockman? Running containers are not removed.`}
        confirmLabel="Remove"
        danger
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
        onClose={() => setRemoveOpen(false)}
      />
    </div>
  )
}

function projectCountLabel(group: StackProjectGroup) {
  if (group.running > 0) {
    return `${group.running} running`
  }
  const n = group.containers.length
  return `${n} container${n === 1 ? "" : "s"}`
}

function StackProjects({
  stack,
  containers,
  composeAvailable,
}: {
  stack: StackDetail
  containers: ContainerRow[]
  composeAvailable: boolean
}) {
  const groups = useMemo(() => stackProjectGroups(stack, containers), [stack, containers])
  const [downTarget, setDownTarget] = useState<string | null>(null)

  if (!groups.length) {
    return <EmptyState title="No projects yet" body="Start this compose with a project name." />
  }

  return (
    <div className="h-full min-h-0 overflow-auto p-4">
      <div className="grid gap-4">
        {groups.map((group) => (
          <section
            key={group.name}
            className="border-border bg-elevated overflow-hidden rounded-[12px] border"
          >
            <header className="border-border flex items-center gap-2 border-b px-4 py-3">
              <StatusDot state={group.live ? "running" : "exited"} />
              <h2 className="min-w-0 truncate text-sm tracking-[-0.02em]">{group.name}</h2>
              {group.last ? <span className="text-faint shrink-0 text-sm">Last</span> : null}
              <span className="text-muted ml-auto shrink-0 text-sm">
                {group.live ? "Live" : "Stopped"} · {projectCountLabel(group)}
              </span>
              <Button
                icon={<Square />}
                disabled={!composeAvailable}
                onClick={() => setDownTarget(group.name)}
              >
                Down
              </Button>
            </header>
            {group.containers.length ? (
              <Table
                cols={["w-[16%]", "w-[12%]", "w-[18%]", "w-[16%]", "w-[18%]", "w-[8%]", "w-[12%]"]}
              >
                <THead columns={["Name", "Service", "Image", "Status", "Ports", "Age", "ID"]} />
                <tbody>
                  {group.containers.map((row) => (
                    <TRow key={row.id}>
                      <TCell>
                        <RowName
                          to={`/containers/${row.id}`}
                          state={{
                            from: `/stacks/${stack.id}?tab=projects`,
                            fromLabel: stack.name,
                          }}
                        >
                          {row.name || "—"}
                        </RowName>
                      </TCell>
                      <TCell className="text-muted">{row.compose_service || "—"}</TCell>
                      <TCell className="text-muted">{row.image}</TCell>
                      <TCell truncate={false}>
                        <StatusChip state={row.state} label={row.status} />
                      </TCell>
                      <TCell truncate={false}>
                        <PortList ports={row.ports} />
                      </TCell>
                      <TCell className="text-muted">{formatAge(row.created)}</TCell>
                      <TCell>
                        <CopyId id={row.id} />
                      </TCell>
                    </TRow>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="text-faint px-4 py-3 text-sm">No containers</p>
            )}
          </section>
        ))}
      </div>
      {downTarget ? (
        <StackUpDialog
          open
          mode="down"
          lockProject
          stackId={stack.id}
          stackName={stack.name}
          defaultProject={downTarget}
          onOpenChange={(open) => {
            if (!open) setDownTarget(null)
          }}
        />
      ) : null}
    </div>
  )
}
