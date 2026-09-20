import { useQueryClient } from "@tanstack/react-query"
import { Download } from "lucide-react"
import { useEffect, useId, useState, type KeyboardEvent } from "react"

import { ImageSearchResults } from "@/components/common"
import { Button } from "@/components/ui/button"
import { Field, TextInput } from "@/components/ui/field"
import { FormDialog } from "@/components/ui/form-dialog"
import { api, listenImagePull } from "@/lib/api"
import { hubSearchTerm } from "@/lib/hub-search"
import type { ImageSearchRow } from "@/lib/types"
import { useImageSearch } from "@/lib/use-image-search"

export function PullImageDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const client = useQueryClient()
  const listId = useId()
  const [reference, setReference] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string[]>([])
  const [pickedTerm, setPickedTerm] = useState<string | null>(null)
  const [active, setActive] = useState(-1)

  const term = hubSearchTerm(reference)
  const showResults = open && !pending && term.length >= 2 && pickedTerm !== term
  const { results, searching, searchError } = useImageSearch(term, showResults)

  useEffect(() => {
    if (!open) return
    setReference("")
    setPending(false)
    setError(null)
    setProgress([])
    setPickedTerm(null)
    setActive(-1)
  }, [open])

  useEffect(() => {
    setActive(-1)
  }, [results, showResults])

  function selectResult(row: ImageSearchRow) {
    setReference(row.name)
    setPickedTerm(row.name)
    setActive(-1)
    setError(null)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!showResults || (!results.length && event.key !== "Escape")) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActive((index) => (index + 1) % Math.max(results.length, 1))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((index) => (index <= 0 ? results.length - 1 : index - 1))
    } else if (event.key === "Enter" && active >= 0 && results[active]) {
      event.preventDefault()
      selectResult(results[active])
    }
  }

  async function submit() {
    const ref = reference.trim()
    if (!ref) {
      setError("Image reference is required")
      return
    }
    setPending(true)
    setError(null)
    setProgress([])
    const unlisten = await listenImagePull((chunk) => {
      setProgress((current) => {
        const next = current.concat(chunk.line)
        return next.length > 80 ? next.slice(-80) : next
      })
    })
    try {
      await api.imagePull(ref)
      await client.invalidateQueries({ queryKey: ["images"] })
      onOpenChange(false)
    } catch (err) {
      setError(String(err))
    } finally {
      unlisten()
      setPending(false)
    }
  }

  return (
    <FormDialog
      open={open}
      title="Pull image"
      description="Search Docker Hub or type a name:tag. Tag defaults to latest."
      confirmLabel="Pull"
      confirmIcon={<Download />}
      pending={pending}
      error={error}
      trigger={
        <Button variant="primary" icon={<Download />}>
          Pull
        </Button>
      }
      onSubmit={() => void submit()}
      onOpenChange={onOpenChange}
    >
      <Field label="Image" hint="Pick a result or pull any exact name:tag.">
        <TextInput
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="nginx:latest"
          autoFocus
          required
          role="combobox"
          aria-expanded={showResults}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      {showResults ? (
        <ImageSearchResults
          listId={listId}
          results={results}
          searching={searching}
          searchError={searchError}
          active={active}
          emptyHint={`No images match “${term}”. You can still pull this name.`}
          onSelectHub={selectResult}
        />
      ) : null}
      {progress.length ? (
        <pre className="border-border bg-canvas text-muted max-h-28 overflow-auto rounded-[10px] border p-3 font-mono text-xs">
          {progress.join("\n")}
        </pre>
      ) : null}
    </FormDialog>
  )
}
