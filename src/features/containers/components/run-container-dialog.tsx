import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Play, Plus } from "lucide-react"
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { Controller, useForm, useWatch } from "react-hook-form"

import { ImageSearchResults } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldPair, Select, TextArea, TextInput } from "@/components/ui/field"
import { FormDialog } from "@/components/ui/form-dialog"
import { api, listenImagePull } from "@/lib/api"
import { parseLines, RunContainer, type RunContainerValues } from "@/lib/create-form"
import { filterLocalImageTags, hubSearchTerm } from "@/lib/hub-search"
import { exposedPortsFromInspect, resolveLocalImage } from "@/lib/image-hints"
import { useImageInspect, useImages, useNetworks } from "@/lib/queries"
import type { ImageSearchRow, RestartPolicy } from "@/lib/types"
import { useImageSearch } from "@/lib/use-image-search"

const RESTART_POLICIES: { value: RestartPolicy; label: string }[] = [
  { value: "no", label: "No" },
  { value: "on-failure", label: "On failure" },
  { value: "always", label: "Always" },
  { value: "unless-stopped", label: "Unless stopped" },
]

const emptyValues: RunContainerValues = {
  image: "",
  name: "",
  cmd: "",
  entrypoint: "",
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
  trigger,
  onOpenChange,
}: {
  open: boolean
  initialImage?: string
  trigger?: boolean
  onOpenChange: (open: boolean) => void
}) {
  const images = useImages()
  const networks = useNetworks()
  const client = useQueryClient()
  const listId = useId()
  const [progress, setProgress] = useState<string[]>([])
  const [pickedTerm, setPickedTerm] = useState<string | null>(null)
  const [active, setActive] = useState(-1)

  const form = useForm({
    resolver: zodResolver(RunContainer),
    defaultValues: { ...emptyValues, image: initialImage },
  })
  const image = useWatch({ control: form.control, name: "image" })
  const start = useWatch({ control: form.control, name: "start" })
  const ports = useWatch({ control: form.control, name: "ports" })
  const localImage = useMemo(() => resolveLocalImage(images.data, image), [image, images.data])
  const inspect = useImageInspect(localImage?.id ?? null, open)
  const suggestedPorts = useMemo(() => exposedPortsFromInspect(inspect.data), [inspect.data])
  const suggestedText = suggestedPorts.join("\n")
  const lastSuggestion = useRef("")
  const lastImageId = useRef<string | null>(null)

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
          await api.imagePull(imageRef)
        } finally {
          unlisten()
        }
        await client.invalidateQueries({ queryKey: ["images"] })
      }
      await api.containerCreate({
        image: imageRef,
        name: values.name.trim() || undefined,
        ports: parseLines(values.ports),
        env: parseLines(values.env),
        cmd: parseLines(values.cmd),
        entrypoint: parseLines(values.entrypoint),
        mounts: parseLines(values.mounts),
        network: values.network || undefined,
        restart: values.restart,
        start: values.start,
      })
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["containers"] })
      onOpenChange(false)
    },
  })

  useEffect(() => {
    if (!open) return
    form.reset({ ...emptyValues, image: initialImage })
    setProgress([])
    setPickedTerm(initialImage.trim() ? hubSearchTerm(initialImage) : null)
    setActive(-1)
    lastSuggestion.current = ""
    lastImageId.current = null
    reset()
  }, [form, initialImage, open, reset])

  useEffect(() => {
    if (!open) {
      lastImageId.current = null
      return
    }
    const id = localImage?.id ?? null
    if (id !== lastImageId.current) {
      lastImageId.current = id
      form.setValue("ports", suggestedText)
      lastSuggestion.current = suggestedText
      return
    }
    const current = form.getValues("ports")
    if (current.trim() && current !== lastSuggestion.current) return
    form.setValue("ports", suggestedText)
    lastSuggestion.current = suggestedText
  }, [form, localImage?.id, open, suggestedText])

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
    setActive(-1)
  }, [image, results, showPanel])

  function selectLocal(tag: string) {
    form.setValue("image", tag, { shouldValidate: true })
    form.setValue("ports", "")
    lastSuggestion.current = ""
    lastImageId.current = null
    setPickedTerm(hubSearchTerm(tag))
    setActive(-1)
  }

  function selectHub(row: ImageSearchRow) {
    form.setValue("image", row.name, { shouldValidate: true })
    form.setValue("ports", "")
    lastSuggestion.current = ""
    lastImageId.current = null
    setPickedTerm(row.name)
    setActive(-1)
  }

  function onImageKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!showPanel || (!items.length && event.key !== "Escape")) return
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
      title="Run container"
      description="Create a container from an image. Missing images are pulled from the public registry."
      confirmLabel={start ? "Run" : "Create"}
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
      {showPanel ? (
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
      ) : null}
      <FieldPair
        left={{
          label: "Command",
          hint: "One argument per line. Overrides image CMD.",
          errors: [form.formState.errors.cmd],
          children: (
            <Controller
              name="cmd"
              control={form.control}
              render={({ field, fieldState }) => (
                <TextArea
                  {...field}
                  placeholder={"nginx -g daemon off;"}
                  className="min-h-20"
                  aria-invalid={fieldState.invalid}
                />
              )}
            />
          ),
        }}
        right={{
          label: "Entrypoint",
          hint: "One argument per line. Overrides image ENTRYPOINT.",
          errors: [form.formState.errors.entrypoint],
          children: (
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
          ),
        }}
      />
      <FieldPair
        left={{
          label: "Ports",
          hint: suggestedPorts.length ? (
            ports.trim() === suggestedText ? (
              `Image exposes ${suggestedPorts.join(", ")}`
            ) : (
              <>
                Image exposes {suggestedPorts.join(", ")}.{" "}
                <button
                  type="button"
                  className="text-accent hover:underline"
                  onClick={() => {
                    form.setValue("ports", suggestedText, { shouldValidate: true })
                    lastSuggestion.current = suggestedText
                  }}
                >
                  Use
                </button>
              </>
            )
          ) : (
            "One per line. 8080:80 or 80"
          ),
          errors: [form.formState.errors.ports],
          children: (
            <Controller
              name="ports"
              control={form.control}
              render={({ field, fieldState }) => (
                <TextArea
                  {...field}
                  placeholder={suggestedPorts[0] ? suggestedPorts.join("\n") : "8080:80"}
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
      {progress.length ? (
        <pre className="border-border bg-canvas text-muted max-h-28 overflow-auto rounded-[10px] border p-3 font-mono text-xs">
          {progress.join("\n")}
        </pre>
      ) : null}
    </FormDialog>
  )
}
