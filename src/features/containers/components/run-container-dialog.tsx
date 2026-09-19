import { useQueryClient } from "@tanstack/react-query"
import { Play, Plus } from "lucide-react"
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react"

import { ImageSearchResults } from "@/components/common"
import { Field, TextArea, TextInput } from "@/components/ui/field"
import { FormDialog } from "@/components/ui/form-dialog"
import { api, listenImagePull } from "@/lib/api"
import { parseEnv, parsePorts } from "@/lib/create-form"
import { filterLocalImageTags, hubSearchTerm } from "@/lib/hub-search"
import { useImages } from "@/lib/queries"
import type { ImageSearchRow } from "@/lib/types"
import { useImageSearch } from "@/lib/use-image-search"

export function RunContainerDialog({
  open,
  initialImage = "",
  onClose,
}: {
  open: boolean
  initialImage?: string
  onClose: () => void
}) {
  const images = useImages()
  const client = useQueryClient()
  const listId = useId()
  const [image, setImage] = useState(initialImage)
  const [name, setName] = useState("")
  const [ports, setPorts] = useState("")
  const [env, setEnv] = useState("")
  const [start, setStart] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string[]>([])
  const [pickedTerm, setPickedTerm] = useState<string | null>(null)
  const [active, setActive] = useState(-1)

  useEffect(() => {
    if (!open) return
    setImage(initialImage)
    setName("")
    setPorts("")
    setEnv("")
    setStart(true)
    setPending(false)
    setError(null)
    setProgress([])
    setPickedTerm(initialImage.trim() ? hubSearchTerm(initialImage) : null)
    setActive(-1)
  }, [open, initialImage])

  const tags = useMemo(() => (images.data ?? []).flatMap((row) => row.tags), [images.data])
  const term = hubSearchTerm(image)
  const localMatches = useMemo(() => filterLocalImageTags(tags, image), [image, tags])
  const showPanel =
    open && !pending && pickedTerm !== term && (localMatches.length > 0 || term.length >= 2)
  const showHub = showPanel && localMatches.length === 0 && term.length >= 2
  const { results, searching, searchError } = useImageSearch(term, showHub)

  const items = localMatches.length ? localMatches : results

  useEffect(() => {
    setActive(-1)
  }, [image, results, showPanel])

  function selectLocal(tag: string) {
    setImage(tag)
    setPickedTerm(hubSearchTerm(tag))
    setActive(-1)
    setError(null)
  }

  function selectHub(row: ImageSearchRow) {
    setImage(row.name)
    setPickedTerm(row.name)
    setActive(-1)
    setError(null)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
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

  async function submit() {
    const imageRef = image.trim()
    if (!imageRef) {
      setError("Image is required")
      return
    }
    const portResult = parsePorts(ports)
    if (!portResult.ok) {
      setError(portResult.error)
      return
    }
    const envResult = parseEnv(env)
    if (!envResult.ok) {
      setError(envResult.error)
      return
    }

    setPending(true)
    setError(null)
    setProgress([])

    const local = (images.data ?? []).some(
      (row) =>
        row.tags.includes(imageRef) ||
        row.id === imageRef ||
        row.id.endsWith(imageRef.replace(/^sha256:/, "")),
    )

    try {
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
        name: name.trim() || undefined,
        ports: portResult.ports,
        env: envResult.env,
        start,
      })
      await client.invalidateQueries({ queryKey: ["containers"] })
      onClose()
    } catch (err) {
      setError(String(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <FormDialog
      open={open}
      title="Run container"
      description="Create a container from an image. Missing images are pulled from the public registry."
      confirmLabel={start ? "Run" : "Create"}
      confirmIcon={start ? <Play /> : <Plus />}
      pending={pending}
      error={error}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <Field
        label="Image"
        hint="Local matches first. Otherwise Docker Hub. Any name:tag still works."
      >
        <TextInput
          value={image}
          onChange={(event) => setImage(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="nginx:latest"
          autoFocus
          required
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
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
      <Field label="Name" hint="Optional. Docker assigns one if empty.">
        <TextInput
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="web"
        />
      </Field>
      <Field label="Ports" hint="One per line. 8080:80 or 80">
        <TextArea
          value={ports}
          onChange={(event) => setPorts(event.target.value)}
          placeholder="8080:80"
        />
      </Field>
      <Field label="Environment" hint="One KEY=value per line">
        <TextArea
          value={env}
          onChange={(event) => setEnv(event.target.value)}
          placeholder="FOO=bar"
        />
      </Field>
      <label className="text-muted flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={start}
          onChange={(event) => setStart(event.target.checked)}
          className="accent-accent size-4"
        />
        Start after create
      </label>
      {progress.length ? (
        <pre className="border-border bg-canvas text-muted max-h-28 overflow-auto rounded-[10px] border p-3 font-mono text-xs">
          {progress.join("\n")}
        </pre>
      ) : null}
    </FormDialog>
  )
}
