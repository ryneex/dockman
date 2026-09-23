import { zodResolver } from "@hookform/resolvers/zod"
import { ChevronDown, Plus, X } from "lucide-react"
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react"
import { Controller, useForm, useWatch } from "react-hook-form"

import { ImageSearchResults } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ComboboxPopup } from "@/components/ui/combobox-popup"
import { Field, Select, TextArea, TextInput } from "@/components/ui/field"
import { IconButton } from "@/components/ui/icon-button"
import {
  emptyHealthcheck,
  type ComposeHealthcheck,
  type ComposeServiceValues,
} from "@/lib/compose-doc"
import { ComposeService, parseLines, type ComposeServiceForm } from "@/lib/create-form"
import { filterLocalImageTags, hubSearchTerm } from "@/lib/hub-search"
import { cmdFromInspect, exposedPortsFromInspect, resolveLocalImage } from "@/lib/image-hints"
import { useImageInspect, useImages } from "@/lib/queries"
import type { ImageSearchRow, RestartPolicy } from "@/lib/types"
import { useImageSearch } from "@/lib/use-image-search"
import { cn } from "@/lib/utils"

const RESTART_POLICIES: { value: RestartPolicy | ""; label: string }[] = [
  { value: "no", label: "No" },
  { value: "on-failure", label: "On failure" },
  { value: "always", label: "Always" },
  { value: "unless-stopped", label: "Unless stopped" },
  { value: "", label: "Unset" },
]

const PROTOS = [
  { value: "tcp", label: "tcp" },
  { value: "udp", label: "udp" },
]

type Proto = "tcp" | "udp"
type PortRow = { host: string; container: string; proto: Proto }
type VolumeRow = { source: string; dest: string; readOnly: boolean }
type EnvRow = { key: string; value: string }

function parsePortLine(line: string): PortRow {
  let proto: Proto = "tcp"
  let rest = line.trim()
  const slash = rest.lastIndexOf("/")
  if (slash >= 0) {
    const suffix = rest.slice(slash + 1).toLowerCase()
    if (suffix === "tcp" || suffix === "udp") {
      proto = suffix
      rest = rest.slice(0, slash)
    }
  }
  const sep = rest.lastIndexOf(":")
  if (sep === -1) return { host: "", container: rest, proto }
  return { host: rest.slice(0, sep), container: rest.slice(sep + 1), proto }
}

function serializePortRows(rows: PortRow[]) {
  return rows
    .map((row) => {
      const container = row.container.trim()
      if (!container) return ""
      const host = row.host.trim()
      const mapping = host ? `${host}:${container}` : container
      return row.proto === "udp" ? `${mapping}/udp` : mapping
    })
    .filter(Boolean)
    .join("\n")
}

function parseVolumeLine(line: string): VolumeRow {
  let readOnly = false
  let rest = line
  if (rest.endsWith(":ro")) {
    readOnly = true
    rest = rest.slice(0, -3)
  } else if (rest.endsWith(":rw")) {
    rest = rest.slice(0, -3)
  }
  const sep = rest.lastIndexOf(":")
  if (sep <= 0) return { source: rest, dest: "", readOnly }
  return { source: rest.slice(0, sep), dest: rest.slice(sep + 1), readOnly }
}

function serializeVolumeRows(rows: VolumeRow[]) {
  return rows
    .map((row) => {
      const source = row.source.trim()
      const dest = row.dest.trim()
      if (!source || !dest) return ""
      return row.readOnly ? `${source}:${dest}:ro` : `${source}:${dest}`
    })
    .filter(Boolean)
    .join("\n")
}

function parseEnvLine(line: string): EnvRow {
  const sep = line.indexOf("=")
  if (sep === -1) return { key: line, value: "" }
  return { key: line.slice(0, sep), value: line.slice(sep + 1) }
}

function serializeEnvRows(rows: EnvRow[]) {
  return rows
    .map((row) => {
      const key = row.key.trim()
      if (!key) return ""
      return `${key}=${row.value}`
    })
    .filter(Boolean)
    .join("\n")
}

function Section({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: ReactNode
  error?: { message?: string }
  children: ReactNode
}) {
  return (
    <div className="grid gap-1.5" data-invalid={Boolean(error?.message) || undefined}>
      <span className="text-muted text-sm">{label}</span>
      {children}
      {error?.message ? (
        <span role="alert" className="text-exited text-sm">
          {error.message}
        </span>
      ) : hint ? (
        <span className="text-faint text-sm">{hint}</span>
      ) : null}
    </div>
  )
}

export function ServiceForm({
  serviceName,
  values,
  skipMemory,
  keepDependsOnObject,
  otherServices,
  healthyServices,
  onChange,
  onRename,
}: {
  serviceName: string
  values: ComposeServiceValues
  skipMemory: boolean
  keepDependsOnObject: boolean
  otherServices: string[]
  healthyServices: string[]
  onChange: (values: ComposeServiceValues) => void
  onRename: (name: string) => void
}) {
  const form = useForm({
    resolver: zodResolver(ComposeService),
    defaultValues: values,
  })
  const listId = useId()
  const image = useWatch({ control: form.control, name: "image" })
  const command = useWatch({ control: form.control, name: "command" })
  const healthcheck = {
    ...emptyHealthcheck(),
    ...useWatch({ control: form.control, name: "healthcheck" }),
  }
  const dependsOn = useWatch({ control: form.control, name: "depends_on" }) ?? ""
  const dependsHealthy = useWatch({ control: form.control, name: "depends_healthy" }) ?? ""
  const images = useImages()
  const localImage = useMemo(() => resolveLocalImage(images.data, image), [image, images.data])
  const inspect = useImageInspect(localImage?.id ?? null)
  const suggestedPorts = useMemo(() => exposedPortsFromInspect(inspect.data), [inspect.data])
  const suggestedText = suggestedPorts.join("\n")
  const suggestedCmd = useMemo(() => cmdFromInspect(inspect.data).join("\n"), [inspect.data])
  const lastPorts = useRef(values.ports)
  const lastCmd = useRef(values.command)
  const lastImageId = useRef<string | null>(null)
  const onChangeRef = useRef(onChange)
  const [pickedTerm, setPickedTerm] = useState<string | null>(() =>
    values.image.trim() ? hubSearchTerm(values.image) : null,
  )
  const [active, setActive] = useState(-1)
  const [portRows, setPortRows] = useState(() => parseLines(values.ports).map(parsePortLine))
  const [volumeRows, setVolumeRows] = useState(() =>
    parseLines(values.volumes).map(parseVolumeLine),
  )
  const [envRows, setEnvRows] = useState(() => parseLines(values.env).map(parseEnvLine))
  const [advancedOpen, setAdvancedOpen] = useState(false)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  function emit(next: Partial<ComposeServiceForm>) {
    const merged = { ...form.getValues(), ...next }
    onChangeRef.current(merged)
  }

  const tags = useMemo(() => (images.data ?? []).flatMap((row) => row.tags), [images.data])
  const term = hubSearchTerm(image)
  const localMatches = useMemo(() => filterLocalImageTags(tags, image), [image, tags])
  const showHub = localMatches.length === 0 && term.length >= 2
  const { results, searching, searchError } = useImageSearch(term, showHub && pickedTerm !== term)
  const items = localMatches.length ? localMatches : results
  const showPanel = pickedTerm !== term && (localMatches.length > 0 || term.length >= 2)
  const portsText = serializePortRows(portRows)
  const selectedDepends = new Set(parseLines(dependsOn))
  const selectedHealthy = new Set(parseLines(dependsHealthy))

  useEffect(() => {
    setActive(-1)
  }, [image, results, showPanel])

  useEffect(() => {
    const id = localImage?.id ?? null
    if (!id || !inspect.data) return
    const imageChanged = id !== lastImageId.current
    if (imageChanged) lastImageId.current = id

    const currentCmd = form.getValues("command")
    if (imageChanged || !currentCmd.trim() || currentCmd === lastCmd.current) {
      form.setValue("command", suggestedCmd)
      lastCmd.current = suggestedCmd
      onChangeRef.current({ ...form.getValues(), command: suggestedCmd })
    }

    const currentPorts = form.getValues("ports")
    if (imageChanged || !currentPorts.trim() || currentPorts === lastPorts.current) {
      const rows = suggestedPorts.map((port) => ({
        host: "",
        container: port,
        proto: "tcp" as const,
      }))
      setPortRows(rows)
      form.setValue("ports", suggestedText)
      lastPorts.current = suggestedText
      onChangeRef.current({ ...form.getValues(), ports: suggestedText })
    }
  }, [form, inspect.data, localImage?.id, suggestedCmd, suggestedPorts, suggestedText])

  const advancedError = Boolean(
    form.formState.errors.command ||
    form.formState.errors.entrypoint ||
    form.formState.errors.user ||
    form.formState.errors.workdir ||
    form.formState.errors.memory ||
    form.formState.errors.networks,
  )

  useEffect(() => {
    if (advancedError) setAdvancedOpen(true)
  }, [advancedError])

  function patchHealthcheck(next: Partial<ComposeHealthcheck>) {
    const healthcheck = { ...form.getValues("healthcheck"), ...next }
    form.setValue("healthcheck", healthcheck)
    emit({ healthcheck })
  }

  function selectImage(next: string) {
    form.setValue("image", next, { shouldValidate: true })
    form.setValue("ports", "")
    form.setValue("command", "")
    setPortRows([])
    lastPorts.current = ""
    lastCmd.current = ""
    lastImageId.current = null
    setPickedTerm(hubSearchTerm(next))
    setActive(-1)
    emit({ image: next, ports: "", command: "" })
  }

  function patchPorts(rows: PortRow[]) {
    setPortRows(rows)
    const ports = serializePortRows(rows)
    form.setValue("ports", ports)
    lastPorts.current = ports
    emit({ ports })
  }

  function patchVolumes(rows: VolumeRow[]) {
    setVolumeRows(rows)
    const volumes = serializeVolumeRows(rows)
    form.setValue("volumes", volumes)
    emit({ volumes })
  }

  function patchEnv(rows: EnvRow[]) {
    setEnvRows(rows)
    const env = serializeEnvRows(rows)
    form.setValue("env", env)
    emit({ env })
  }

  function writeDepends(next: Set<string>, nextHealthy: Set<string>) {
    const names = otherServices.filter((service) => next.has(service))
    const healthy = names.filter((service) => nextHealthy.has(service))
    const depends_on = names.join("\n")
    const depends_healthy = healthy.join("\n")
    form.setValue("depends_on", depends_on)
    form.setValue("depends_healthy", depends_healthy)
    emit({ depends_on, depends_healthy })
  }

  function dismissSearch() {
    setPickedTerm(hubSearchTerm(image))
    setActive(-1)
  }

  function onImageKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && showPanel) {
      event.preventDefault()
      dismissSearch()
      return
    }
    if (!showPanel || !items.length) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActive((index) => (index + 1) % Math.max(items.length, 1))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((index) => (index <= 0 ? items.length - 1 : index - 1))
    } else if (event.key === "Enter" && active >= 0 && items[active]) {
      event.preventDefault()
      if (localMatches.length) selectImage(localMatches[active]!)
      else selectImage((results[active] as ImageSearchRow).name)
    }
  }

  return (
    <div className="grid gap-4">
      <Field label="Service name" hint="Compose service key.">
        <TextInput
          defaultValue={serviceName}
          key={serviceName}
          onBlur={(event) => {
            const next = event.target.value.trim()
            if (next && next !== serviceName) onRename(next)
          }}
        />
      </Field>
      <Field
        label="Image"
        hint="Local matches first. Otherwise Docker Hub. Same search as Run container."
        errors={[form.formState.errors.image]}
      >
        <Controller
          name="image"
          control={form.control}
          render={({ field, fieldState }) => (
            <ComboboxPopup
              open={showPanel}
              onDismiss={dismissSearch}
              popup={
                <ImageSearchResults
                  listId={listId}
                  localMatches={localMatches}
                  results={results}
                  searching={searching}
                  searchError={searchError}
                  active={active}
                  emptyHint={`No images match “${term}”. You can still use this name.`}
                  onSelectLocal={selectImage}
                  onSelectHub={(row) => selectImage(row.name)}
                />
              }
            >
              <TextInput
                {...field}
                onKeyDown={onImageKeyDown}
                placeholder="image:tag"
                role="combobox"
                aria-expanded={showPanel}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-invalid={fieldState.invalid}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  field.onChange(event)
                  emit({ image: event.target.value })
                }}
              />
            </ComboboxPopup>
          )}
        />
      </Field>
      <Section
        label="Ports"
        hint={
          suggestedPorts.length ? (
            portsText === suggestedText ? (
              `Image exposes ${suggestedPorts.join(", ")}. UDP via proto.`
            ) : (
              <>
                Image exposes {suggestedPorts.join(", ")}.{" "}
                <button
                  type="button"
                  className="text-accent hover:underline"
                  onClick={() => {
                    const rows = suggestedPorts.map((port) => ({
                      host: "",
                      container: port,
                      proto: "tcp" as const,
                    }))
                    patchPorts(rows)
                  }}
                >
                  Use
                </button>
              </>
            )
          ) : (
            "Host is optional. Empty host writes the container port only; host filled writes host:container."
          )
        }
        error={form.formState.errors.ports}
      >
        <div className="grid gap-2">
          {portRows.map((row, index) => (
            <div key={index} className="flex items-center gap-2">
              <TextInput
                value={row.host}
                placeholder="Host"
                aria-label="Host port"
                inputMode="numeric"
                className="min-w-0 flex-1"
                onChange={(event) => {
                  const next = portRows.slice()
                  next[index] = { ...row, host: event.target.value }
                  patchPorts(next)
                }}
              />
              <TextInput
                value={row.container}
                placeholder="Container"
                aria-label="Container port"
                inputMode="numeric"
                className="min-w-0 flex-1"
                onChange={(event) => {
                  const next = portRows.slice()
                  next[index] = { ...row, container: event.target.value }
                  patchPorts(next)
                }}
              />
              <div className="w-[5.5rem] shrink-0">
                <Select
                  value={row.proto}
                  onValueChange={(value) => {
                    const next = portRows.slice()
                    next[index] = { ...row, proto: value as Proto }
                    patchPorts(next)
                  }}
                  items={PROTOS}
                />
              </div>
              <IconButton
                aria-label="Remove port"
                onClick={() => patchPorts(portRows.filter((_, i) => i !== index))}
              >
                <X size={16} />
              </IconButton>
            </div>
          ))}
          <Button
            variant="quiet"
            icon={<Plus />}
            className="w-fit"
            onClick={() => patchPorts(portRows.concat({ host: "", container: "", proto: "tcp" }))}
          >
            Add port
          </Button>
        </div>
      </Section>
      <Section
        label="Volumes"
        hint="Named volume or host path in source. Destination is the container path."
        error={form.formState.errors.volumes}
      >
        <div className="grid gap-2">
          {volumeRows.map((row, index) => (
            <div key={index} className="flex items-center gap-2">
              <TextInput
                value={row.source}
                placeholder="data or /host/path"
                aria-label="Volume source"
                className="min-w-0 flex-1"
                onChange={(event) => {
                  const next = volumeRows.slice()
                  next[index] = { ...row, source: event.target.value }
                  patchVolumes(next)
                }}
              />
              <TextInput
                value={row.dest}
                placeholder="/container/path"
                aria-label="Volume destination"
                className="min-w-0 flex-1"
                onChange={(event) => {
                  const next = volumeRows.slice()
                  next[index] = { ...row, dest: event.target.value }
                  patchVolumes(next)
                }}
              />
              <label className="text-muted flex shrink-0 items-center gap-1.5 text-sm">
                <Checkbox
                  checked={row.readOnly}
                  aria-label="Read only"
                  onChange={(event) => {
                    const next = volumeRows.slice()
                    next[index] = { ...row, readOnly: event.target.checked }
                    patchVolumes(next)
                  }}
                />
                ro
              </label>
              <IconButton
                aria-label="Remove volume"
                onClick={() => patchVolumes(volumeRows.filter((_, i) => i !== index))}
              >
                <X size={16} />
              </IconButton>
            </div>
          ))}
          <Button
            variant="quiet"
            icon={<Plus />}
            className="w-fit"
            onClick={() =>
              patchVolumes(volumeRows.concat({ source: "", dest: "", readOnly: false }))
            }
          >
            Add volume
          </Button>
        </div>
      </Section>
      <Section label="Environment" hint="KEY and value." error={form.formState.errors.env}>
        <div className="grid gap-2">
          {envRows.map((row, index) => (
            <div key={index} className="flex items-center gap-2">
              <TextInput
                value={row.key}
                placeholder="KEY"
                aria-label="Environment key"
                className="min-w-0 flex-1"
                spellCheck={false}
                onChange={(event) => {
                  const next = envRows.slice()
                  next[index] = { ...row, key: event.target.value }
                  patchEnv(next)
                }}
              />
              <TextInput
                value={row.value}
                placeholder="value"
                aria-label="Environment value"
                className="min-w-0 flex-1"
                spellCheck={false}
                onChange={(event) => {
                  const next = envRows.slice()
                  next[index] = { ...row, value: event.target.value }
                  patchEnv(next)
                }}
              />
              <IconButton
                aria-label="Remove variable"
                onClick={() => patchEnv(envRows.filter((_, i) => i !== index))}
              >
                <X size={16} />
              </IconButton>
            </div>
          ))}
          <Button
            variant="quiet"
            icon={<Plus />}
            className="w-fit"
            onClick={() => patchEnv(envRows.concat({ key: "", value: "" }))}
          >
            Add variable
          </Button>
        </div>
      </Section>
      <Field label="Restart" errors={[form.formState.errors.restart]}>
        <Controller
          name="restart"
          control={form.control}
          render={({ field }) => (
            <Select
              value={field.value}
              onValueChange={(value) => {
                field.onChange(value)
                emit({ restart: value as ComposeServiceForm["restart"] })
              }}
              items={RESTART_POLICIES}
            />
          )}
        />
      </Field>
      <Section
        label="Depends on"
        hint={
          keepDependsOnObject
            ? "This depends_on uses conditions; edit them in YAML."
            : otherServices.length
              ? "Services that must start first."
              : "Add another service first."
        }
        error={form.formState.errors.depends_on}
      >
        {keepDependsOnObject ? null : otherServices.length ? (
          <div
            role="group"
            aria-label="Depends on"
            aria-invalid={form.formState.errors.depends_on ? true : undefined}
            className="border-border bg-canvas flex min-h-16 flex-col justify-center gap-1.5 rounded-[8px] border px-2.5 py-2"
          >
            {otherServices.map((name) => (
              <div key={name} className="grid gap-1">
                <div
                  className="flex cursor-pointer items-center gap-2"
                  onClick={() => {
                    const next = new Set(selectedDepends)
                    const nextHealthy = new Set(selectedHealthy)
                    if (next.has(name)) {
                      next.delete(name)
                      nextHealthy.delete(name)
                    } else {
                      next.add(name)
                    }
                    writeDepends(next, nextHealthy)
                  }}
                >
                  <Checkbox
                    checked={selectedDepends.has(name)}
                    aria-label={name}
                    onChange={(event) => {
                      const next = new Set(selectedDepends)
                      const nextHealthy = new Set(selectedHealthy)
                      if (event.target.checked) next.add(name)
                      else {
                        next.delete(name)
                        nextHealthy.delete(name)
                      }
                      writeDepends(next, nextHealthy)
                    }}
                  />
                  <span className="text-ink min-w-0 truncate text-sm">{name}</span>
                </div>
                {healthyServices.includes(name) ? (
                  <label className="text-muted ml-6 flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selectedHealthy.has(name)}
                      aria-label={`Wait until ${name} is healthy`}
                      onChange={(event) => {
                        const next = new Set(selectedDepends)
                        const nextHealthy = new Set(selectedHealthy)
                        if (event.target.checked) {
                          next.add(name)
                          nextHealthy.add(name)
                        } else {
                          nextHealthy.delete(name)
                        }
                        writeDepends(next, nextHealthy)
                      }}
                    />
                    Wait until healthy
                  </label>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </Section>
      <Section
        label="Healthcheck"
        hint={
          healthcheck.enabled
            ? "One line is CMD-SHELL. One argument per line is CMD. Empty interval, timeout, and retries use 5s / 5s / 5."
            : undefined
        }
      >
        <div className="grid gap-4">
          <label className="text-ink flex items-center gap-2 text-sm">
            <Checkbox
              checked={healthcheck.enabled}
              aria-label="Enable healthcheck"
              onChange={(event) => {
                patchHealthcheck({ enabled: event.target.checked })
              }}
            />
            Enable
          </label>
          {healthcheck.enabled ? (
            <>
              <Field
                label="Test command"
                hint="One line or one argument per line, same as command."
                errors={[form.formState.errors.healthcheck?.test]}
              >
                <Controller
                  name="healthcheck.test"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <TextArea
                      {...field}
                      placeholder="CMD-SHELL"
                      className="min-h-16"
                      aria-invalid={fieldState.invalid}
                      onChange={(event) => {
                        field.onChange(event)
                        patchHealthcheck({ test: event.target.value })
                      }}
                    />
                  )}
                />
              </Field>
              <Field
                label="Interval"
                hint="Default 5s."
                errors={[form.formState.errors.healthcheck?.interval]}
              >
                <Controller
                  name="healthcheck.interval"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <TextInput
                      {...field}
                      placeholder="5s"
                      aria-invalid={fieldState.invalid}
                      onChange={(event) => {
                        field.onChange(event)
                        patchHealthcheck({ interval: event.target.value })
                      }}
                    />
                  )}
                />
              </Field>
              <Field
                label="Timeout"
                hint="Default 5s."
                errors={[form.formState.errors.healthcheck?.timeout]}
              >
                <Controller
                  name="healthcheck.timeout"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <TextInput
                      {...field}
                      placeholder="5s"
                      aria-invalid={fieldState.invalid}
                      onChange={(event) => {
                        field.onChange(event)
                        patchHealthcheck({ timeout: event.target.value })
                      }}
                    />
                  )}
                />
              </Field>
              <Field
                label="Retries"
                hint="Default 5."
                errors={[form.formState.errors.healthcheck?.retries]}
              >
                <Controller
                  name="healthcheck.retries"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <TextInput
                      {...field}
                      placeholder="5"
                      inputMode="numeric"
                      aria-invalid={fieldState.invalid}
                      onChange={(event) => {
                        field.onChange(event)
                        patchHealthcheck({ retries: event.target.value })
                      }}
                    />
                  )}
                />
              </Field>
            </>
          ) : null}
        </div>
      </Section>
      <div className="border-border grid gap-4 border-t pt-4">
        <button
          type="button"
          className="text-muted hover:text-ink inline-flex items-center gap-1.5 text-sm"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          <ChevronDown
            size={16}
            className={cn("transition-transform", advancedOpen && "rotate-180")}
          />
          Advanced
        </button>
        <div className={advancedOpen ? "grid gap-4" : "hidden"}>
          <Field
            label="Command"
            hint={
              suggestedCmd
                ? command === suggestedCmd
                  ? "Image CMD. One argument per line; clear to keep the image default."
                  : "One argument per line. Overrides image CMD."
                : "One argument per line."
            }
            errors={[form.formState.errors.command]}
          >
            <Controller
              name="command"
              control={form.control}
              render={({ field, fieldState }) => (
                <TextArea
                  {...field}
                  className="min-h-16"
                  aria-invalid={fieldState.invalid}
                  onChange={(event) => {
                    field.onChange(event)
                    emit({ command: event.target.value })
                  }}
                />
              )}
            />
          </Field>
          <Field
            label="Entrypoint"
            hint="One argument per line."
            errors={[form.formState.errors.entrypoint]}
          >
            <Controller
              name="entrypoint"
              control={form.control}
              render={({ field, fieldState }) => (
                <TextArea
                  {...field}
                  className="min-h-16"
                  aria-invalid={fieldState.invalid}
                  onChange={(event) => {
                    field.onChange(event)
                    emit({ entrypoint: event.target.value })
                  }}
                />
              )}
            />
          </Field>
          <Field label="User" errors={[form.formState.errors.user]}>
            <Controller
              name="user"
              control={form.control}
              render={({ field, fieldState }) => (
                <TextInput
                  {...field}
                  aria-invalid={fieldState.invalid}
                  onChange={(event) => {
                    field.onChange(event)
                    emit({ user: event.target.value })
                  }}
                />
              )}
            />
          </Field>
          <Field label="Working dir" errors={[form.formState.errors.workdir]}>
            <Controller
              name="workdir"
              control={form.control}
              render={({ field, fieldState }) => (
                <TextInput
                  {...field}
                  placeholder="/app"
                  aria-invalid={fieldState.invalid}
                  onChange={(event) => {
                    field.onChange(event)
                    emit({ workdir: event.target.value })
                  }}
                />
              )}
            />
          </Field>
          <Field
            label="Memory"
            hint={
              skipMemory
                ? "This file uses deploy.resources; memory is left unchanged."
                : "Bytes or Docker size like 512m / 1g."
            }
            errors={[form.formState.errors.memory]}
          >
            <Controller
              name="memory"
              control={form.control}
              render={({ field, fieldState }) => (
                <TextInput
                  {...field}
                  placeholder="512m"
                  disabled={skipMemory}
                  aria-invalid={fieldState.invalid}
                  onChange={(event) => {
                    field.onChange(event)
                    emit({ memory: event.target.value })
                  }}
                />
              )}
            />
          </Field>
          <Field
            label="Networks"
            hint="One name per line. Declared at the top of the file."
            errors={[form.formState.errors.networks]}
          >
            <Controller
              name="networks"
              control={form.control}
              render={({ field, fieldState }) => (
                <TextArea
                  {...field}
                  placeholder="backend"
                  className="min-h-16"
                  aria-invalid={fieldState.invalid}
                  onChange={(event) => {
                    field.onChange(event)
                    emit({ networks: event.target.value })
                  }}
                />
              )}
            />
          </Field>
        </div>
      </div>
    </div>
  )
}
