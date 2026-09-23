import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ChevronDown, Loader2, Play, Plus } from "lucide-react"
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { Controller, useForm, useWatch } from "react-hook-form"

import { ImageSearchResults } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ComboboxPopup } from "@/components/ui/combobox-popup"
import { Field, FieldPair, Select, TextArea, TextInput } from "@/components/ui/field"
import { FormDialog } from "@/components/ui/form-dialog"
import { api, listenImagePull } from "@/lib/api"
import { parseLines, RunContainer, type RunContainerValues } from "@/lib/create-form"
import { filterLocalImageTags, hubSearchTerm } from "@/lib/hub-search"
import { cmdFromInspect, exposedPortsFromInspect, resolveLocalImage } from "@/lib/image-hints"
import { useImageInspect, useImages, useNetworks } from "@/lib/queries"
import type { ImageSearchRow, RestartPolicy } from "@/lib/types"
import { useImageSearch } from "@/lib/use-image-search"
import { cn } from "@/lib/utils"

const RESTART_POLICIES: { value: RestartPolicy; label: string }[] = [
  { value: "no", label: "No" },
  { value: "on-failure", label: "On failure" },
  { value: "always", label: "Always" },
  { value: "unless-stopped", label: "Unless stopped" },
]

function hasAdvancedValues(values?: RunContainerValues | null) {
  if (!values) return false
  return Boolean(
    values.entrypoint.trim() || values.user.trim() || values.workdir.trim() || values.memory.trim(),
  )
}

const emptyValues: RunContainerValues = {
  image: "",
  name: "",
  cmd: "",
  entrypoint: "",
  user: "",
  workdir: "",
  memory: "",
  ports: "",
  mounts: "",
  env: "",
  network: "",
  restart: "no",
  start: true,
}

export function RunContainerDialog({
  open,
  initialImage = "",
  initialValues,
  replaceId,
  trigger,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  initialImage?: string
  initialValues?: RunContainerValues | null
  replaceId?: string | null
  trigger?: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (id: string) => void
}) {
  const images = useImages()
  const networks = useNetworks()
  const client = useQueryClient()
  const listId = useId()
  const [progress, setProgress] = useState<string[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [pendingLabel, setPendingLabel] = useState("Working…")
  const [pickedTerm, setPickedTerm] = useState<string | null>(null)
  const [active, setActive] = useState(-1)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  function log(line: string) {
    setProgress((current) => current.concat(line))
  }

  async function runStep<T>(
    label: string,
    task: () => Promise<T>,
    opts?: { tick?: boolean; limit?: number; pending?: string },
  ) {
    const started = Date.now()
    const pending = opts?.pending ?? label
    setPendingLabel(pending)
    const format = (secs: number) => {
      if (!opts?.tick) return label
      return opts.limit ? `${label} ${secs}s / ${opts.limit}s` : `${label} ${secs}s`
    }
    setStatus(format(0))
    const timer = opts?.tick
      ? window.setInterval(() => {
          setStatus(format(Math.floor((Date.now() - started) / 1000)))
        }, 250)
      : undefined
    try {
      const result = await task()
      const secs = Math.floor((Date.now() - started) / 1000)
      const done = label.replace(/…$/, "").trim()
      log(secs > 0 ? `${done} (${secs}s)` : done)
      return result
    } catch (error) {
      setStatus(null)
      throw error
    } finally {
      if (timer !== undefined) window.clearInterval(timer)
    }
  }

  const form = useForm({
    resolver: zodResolver(RunContainer),
    defaultValues: { ...emptyValues, image: initialImage },
  })
  const image = useWatch({ control: form.control, name: "image" })
  const start = useWatch({ control: form.control, name: "start" })
  const cmd = useWatch({ control: form.control, name: "cmd" })
  const ports = useWatch({ control: form.control, name: "ports" })
  const localImage = useMemo(() => resolveLocalImage(images.data, image), [image, images.data])
  const inspect = useImageInspect(localImage?.id ?? null, open)
  const suggestedPorts = useMemo(() => exposedPortsFromInspect(inspect.data), [inspect.data])
  const suggestedText = suggestedPorts.join("\n")
  const suggestedCmd = useMemo(() => cmdFromInspect(inspect.data).join("\n"), [inspect.data])
  const lastPorts = useRef("")
  const lastCmd = useRef("")
  const lastImageId = useRef<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: async (values: RunContainerValues) => {
      const imageRef = values.image
      const local = (images.data ?? []).some(
        (row) =>
          row.tags.includes(imageRef) ||
          row.id === imageRef ||
          row.id.endsWith(imageRef.replace(/^sha256:/, "")),
      )
      if (!local) {
        const unlisten = await listenImagePull((chunk) => {
          if (chunk.id !== imageRef && !chunk.id.startsWith(imageRef)) return
          setProgress((current) => {
            const next = current.concat(chunk.line)
            return next.length > 80 ? next.slice(-80) : next
          })
        })
        try {
          await runStep("Pulling image…", () => api.imagePull(imageRef), { pending: "Pulling…" })
        } finally {
          unlisten()
        }
        await client.invalidateQueries({ queryKey: ["images"] })
      }
      if (replaceId) {
        try {
          await runStep("Stopping container…", () => api.containerStop(replaceId), {
            tick: true,
            limit: 10,
            pending: "Stopping…",
          })
        } catch {
          log("Already stopped")
        }
        try {
          await runStep("Removing container…", () => api.containerRemove(replaceId), {
            pending: "Removing…",
          })
        } catch (error) {
          if (!String(error).toLowerCase().includes("no such")) throw error
          log("Already removed")
        }
      }
      return runStep(
        values.start ? "Creating and starting…" : "Creating container…",
        () =>
          api.containerCreate({
            image: imageRef,
            name: values.name.trim() || undefined,
            ports: parseLines(values.ports),
            env: parseLines(values.env),
            cmd: parseLines(values.cmd),
            entrypoint: parseLines(values.entrypoint),
            mounts: parseLines(values.mounts),
            network: values.network || undefined,
            restart: values.restart,
            user: values.user.trim() || undefined,
            workingDir: values.workdir.trim() || undefined,
            memory: values.memory.trim() || undefined,
            start: values.start,
          }),
        { pending: values.start ? "Starting…" : "Creating…" },
      )
    },
    onSuccess: async (id) => {
      setStatus(null)
      setPendingLabel("Working…")
      await client.invalidateQueries({ queryKey: ["containers"] })
      await client.invalidateQueries({ queryKey: ["engine"] })
      onOpenChange(false)
      onCreated?.(id)
    },
    onError: async () => {
      setStatus(null)
      setPendingLabel("Working…")
      await client.invalidateQueries({ queryKey: ["containers"] })
      await client.invalidateQueries({ queryKey: ["engine"] })
    },
  })

  useEffect(() => {
    if (!open) return
    form.reset({
      ...emptyValues,
      image: initialImage,
      ...initialValues,
    })
    setProgress([])
    setStatus(null)
    setPendingLabel("Working…")
    const imageRef = initialValues?.image || initialImage
    setPickedTerm(imageRef.trim() ? hubSearchTerm(imageRef) : null)
    setActive(-1)
    setAdvancedOpen(hasAdvancedValues(initialValues))
    lastPorts.current = initialValues?.ports ?? ""
    lastCmd.current = initialValues?.cmd ?? ""
    lastImageId.current = null
    reset()
  }, [form, initialImage, initialValues, open, reset])

  useEffect(() => {
    if (!open) {
      lastImageId.current = null
      return
    }
    const id = localImage?.id ?? null
    if (!id || !inspect.data) return

    const imageChanged = id !== lastImageId.current
    if (imageChanged) lastImageId.current = id

    const currentCmd = form.getValues("cmd")
    if (imageChanged || !currentCmd.trim() || currentCmd === lastCmd.current) {
      form.setValue("cmd", suggestedCmd)
      lastCmd.current = suggestedCmd
    }

    if (replaceId) return
    const currentPorts = form.getValues("ports")
    if (imageChanged || !currentPorts.trim() || currentPorts === lastPorts.current) {
      form.setValue("ports", suggestedText)
      lastPorts.current = suggestedText
    }
  }, [form, inspect.data, localImage?.id, open, replaceId, suggestedCmd, suggestedText])

  const tags = useMemo(() => (images.data ?? []).flatMap((row) => row.tags), [images.data])
  const term = hubSearchTerm(image)
  const localMatches = useMemo(() => filterLocalImageTags(tags, image), [image, tags])
  const showHub = localMatches.length === 0 && term.length >= 2
  const { results, searching, searchError } = useImageSearch(
    term,
    open && showHub && pickedTerm !== term,
  )
  const items = localMatches.length ? localMatches : results
  const showPanel =
    open && !isPending && pickedTerm !== term && (localMatches.length > 0 || term.length >= 2)
  const networkChoices = useMemo(
    () => [...(networks.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [networks.data],
  )

  useEffect(() => {
    const node = logRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [progress, status])

  const advancedError = Boolean(
    form.formState.errors.entrypoint ||
    form.formState.errors.user ||
    form.formState.errors.workdir ||
    form.formState.errors.memory,
  )

  useEffect(() => {
    if (advancedError) setAdvancedOpen(true)
  }, [advancedError])

  useEffect(() => {
    setActive(-1)
  }, [image, results, showPanel])

  function selectLocal(tag: string) {
    form.setValue("image", tag, { shouldValidate: true })
    form.setValue("ports", "")
    form.setValue("cmd", "")
    lastPorts.current = ""
    lastCmd.current = ""
    lastImageId.current = null
    setPickedTerm(hubSearchTerm(tag))
    setActive(-1)
  }

  function selectHub(row: ImageSearchRow) {
    form.setValue("image", row.name, { shouldValidate: true })
    form.setValue("ports", "")
    form.setValue("cmd", "")
    lastPorts.current = ""
    lastCmd.current = ""
    lastImageId.current = null
    setPickedTerm(row.name)
    setActive(-1)
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
      if (localMatches.length) selectLocal(localMatches[active]!)
      else selectHub(results[active]!)
    }
  }

  return (
    <FormDialog
      open={open}
      title={replaceId ? "Recreate container" : "Run container"}
      description={
        replaceId
          ? "This replaces the current container with the same name. The writable layer is lost; listed binds and volumes stay."
          : "Create a container from an image. Missing images are pulled from the public registry."
      }
      confirmLabel={replaceId ? "Recreate" : start ? "Run" : "Create"}
      pendingLabel={pendingLabel}
      confirmIcon={start ? <Play /> : <Plus />}
      pending={isPending}
      error={error ? String(error) : null}
      wide
      trigger={
        trigger ? (
          <Button variant="primary" icon={<Plus />}>
            New
          </Button>
        ) : undefined
      }
      aside={
        <Controller
          name="start"
          control={form.control}
          render={({ field }) => (
            <label className="text-muted flex items-center gap-2 text-sm">
              <Checkbox
                checked={field.value}
                onChange={(event) => field.onChange(event.target.checked)}
                aria-label="Start after create"
              />
              Start after create
            </label>
          )}
        />
      }
      onSubmit={form.handleSubmit((values) => mutate(values))}
      onOpenChange={onOpenChange}
    >
      <FieldPair
        left={{
          label: "Image",
          hint: "Local matches first. Otherwise Docker Hub. Any name:tag still works.",
          errors: [form.formState.errors.image],
          children: (
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
                      emptyHint={`No images match “${term}”. You can still run this name.`}
                      onSelectLocal={selectLocal}
                      onSelectHub={selectHub}
                    />
                  }
                >
                  <TextInput
                    {...field}
                    onKeyDown={onImageKeyDown}
                    placeholder="nginx:latest"
                    autoFocus
                    role="combobox"
                    aria-expanded={showPanel}
                    aria-controls={listId}
                    aria-autocomplete="list"
                    aria-invalid={fieldState.invalid}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </ComboboxPopup>
              )}
            />
          ),
        }}
        right={{
          label: "Name",
          hint: "Optional. Docker assigns one if empty.",
          errors: [form.formState.errors.name],
          children: (
            <Controller
              name="name"
              control={form.control}
              render={({ field, fieldState }) => (
                <TextInput {...field} placeholder="web" aria-invalid={fieldState.invalid} />
              )}
            />
          ),
        }}
      />
      <Field
        label="Command"
        hint={
          suggestedCmd
            ? cmd === suggestedCmd
              ? "Image CMD. One argument per line; clear to keep the image default."
              : "One argument per line. Overrides image CMD."
            : "One argument per line. Filled from the image CMD when a local image is selected."
        }
        errors={[form.formState.errors.cmd]}
      >
        <Controller
          name="cmd"
          control={form.control}
          render={({ field, fieldState }) => (
            <TextArea
              {...field}
              placeholder="nginx"
              className="min-h-20"
              aria-invalid={fieldState.invalid}
            />
          )}
        />
      </Field>
      <FieldPair
        left={{
          label: "Ports",
          hint: suggestedPorts.length ? (
            ports.trim() === suggestedText ? (
              `Image exposes ${suggestedPorts.join(", ")}. Proto suffixes like 53:53/udp work.`
            ) : (
              <>
                Image exposes {suggestedPorts.join(", ")}.{" "}
                <button
                  type="button"
                  className="text-accent hover:underline"
                  onClick={() => {
                    form.setValue("ports", suggestedText, { shouldValidate: true })
                    lastPorts.current = suggestedText
                  }}
                >
                  Use
                </button>
              </>
            )
          ) : (
            "One per line. 80, 8080:80, or 53:53/udp"
          ),
          errors: [form.formState.errors.ports],
          children: (
            <Controller
              name="ports"
              control={form.control}
              render={({ field, fieldState }) => (
                <TextArea
                  {...field}
                  placeholder={suggestedPorts[0] ? suggestedPorts.join("\n") : "8080:80\n53:53/udp"}
                  className="min-h-20"
                  aria-invalid={fieldState.invalid}
                />
              )}
            />
          ),
        }}
        right={{
          label: "Mounts",
          hint: "One per line. volume:/path or /host:/path[:ro]",
          errors: [form.formState.errors.mounts],
          children: (
            <Controller
              name="mounts"
              control={form.control}
              render={({ field, fieldState }) => (
                <TextArea
                  {...field}
                  placeholder={"data:/var/lib/data\n/tmp/app:/app:ro"}
                  className="min-h-20"
                  aria-invalid={fieldState.invalid}
                />
              )}
            />
          ),
        }}
      />
      <FieldPair
        left={{
          label: "Network",
          hint: "Empty uses Docker's default bridge.",
          errors: [form.formState.errors.network],
          children: (
            <Controller
              name="network"
              control={form.control}
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  items={[
                    { value: "", label: "Default" },
                    ...["host", "none"]
                      .filter((name) => !networkChoices.some((row) => row.name === name))
                      .map((name) => ({ value: name, label: name })),
                    ...networkChoices.map((row) => ({ value: row.name, label: row.name })),
                  ]}
                />
              )}
            />
          ),
        }}
        right={{
          label: "Restart",
          errors: [form.formState.errors.restart],
          children: (
            <Controller
              name="restart"
              control={form.control}
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  items={RESTART_POLICIES}
                />
              )}
            />
          ),
        }}
      />
      <Controller
        name="env"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field label="Environment" hint="One KEY=value per line" errors={[fieldState.error]}>
            <TextArea
              {...field}
              placeholder="FOO=bar"
              className="min-h-20"
              aria-invalid={fieldState.invalid}
            />
          </Field>
        )}
      />
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
            label="Entrypoint"
            hint="One argument per line. Empty keeps the image ENTRYPOINT."
            errors={[form.formState.errors.entrypoint]}
          >
            <Controller
              name="entrypoint"
              control={form.control}
              render={({ field, fieldState }) => (
                <TextArea
                  {...field}
                  placeholder="/docker-entrypoint.sh"
                  className="min-h-20"
                  aria-invalid={fieldState.invalid}
                />
              )}
            />
          </Field>
          <FieldPair
            left={{
              label: "User",
              hint: "UID, user, or user:group. Empty uses the image user.",
              errors: [form.formState.errors.user],
              children: (
                <Controller
                  name="user"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <TextInput
                      {...field}
                      placeholder="www-data"
                      aria-invalid={fieldState.invalid}
                    />
                  )}
                />
              ),
            }}
            right={{
              label: "Working dir",
              hint: "Absolute path. Empty uses the image WORKDIR.",
              errors: [form.formState.errors.workdir],
              children: (
                <Controller
                  name="workdir"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <TextInput {...field} placeholder="/app" aria-invalid={fieldState.invalid} />
                  )}
                />
              ),
            }}
          />
          <Field
            label="Memory"
            hint="Bytes or Docker size like 512m / 1g. Empty is unlimited."
            errors={[form.formState.errors.memory]}
          >
            <Controller
              name="memory"
              control={form.control}
              render={({ field, fieldState }) => (
                <TextInput {...field} placeholder="512m" aria-invalid={fieldState.invalid} />
              )}
            />
          </Field>
        </div>
      </div>
      {status || progress.length ? (
        <div
          ref={logRef}
          role="status"
          aria-live="polite"
          className="border-border bg-canvas text-muted max-h-28 overflow-auto rounded-[10px] border p-3 font-mono text-xs"
        >
          {progress.map((line, index) => (
            <p key={`${index}-${line}`}>{line}</p>
          ))}
          {status ? (
            <p className="text-ink flex items-center gap-2">
              <Loader2 className="size-3.5 shrink-0 animate-spin" />
              {status}
            </p>
          ) : null}
        </div>
      ) : null}
    </FormDialog>
  )
}
