import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Download } from "lucide-react"
import { useEffect, useId, useState, type KeyboardEvent } from "react"
import { Controller, useForm, useWatch } from "react-hook-form"

import { ImageSearchResults } from "@/components/common"
import { Button } from "@/components/ui/button"
import { ComboboxPopup } from "@/components/ui/combobox-popup"
import { Field, TextInput } from "@/components/ui/field"
import { FormDialog } from "@/components/ui/form-dialog"
import { api, listenImagePull } from "@/lib/api"
import { PullImage, type PullImageValues } from "@/lib/create-form"
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
  const [progress, setProgress] = useState<string[]>([])
  const [pickedTerm, setPickedTerm] = useState<string | null>(null)
  const [active, setActive] = useState(-1)

  const form = useForm({
    resolver: zodResolver(PullImage),
    defaultValues: { reference: "" },
  })
  const reference = useWatch({ control: form.control, name: "reference" })

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: async ({ reference }: PullImageValues) => {
      const unlisten = await listenImagePull((chunk) => {
        setProgress((current) => {
          const next = current.concat(chunk.line)
          return next.length > 80 ? next.slice(-80) : next
        })
      })
      try {
        await api.imagePull(reference)
      } finally {
        unlisten()
      }
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["images"] })
      onOpenChange(false)
    },
  })

  const term = hubSearchTerm(reference)
  const showResults = open && !isPending && term.length >= 2 && pickedTerm !== term
  const { results, searching, searchError } = useImageSearch(term, showResults)

  useEffect(() => {
    if (!open) return
    form.reset({ reference: "" })
    setProgress([])
    setPickedTerm(null)
    setActive(-1)
    reset()
  }, [form, open, reset])

  useEffect(() => {
    setActive(-1)
  }, [results, showResults])

  function selectResult(row: ImageSearchRow) {
    form.setValue("reference", row.name, { shouldValidate: true })
    setPickedTerm(row.name)
    setActive(-1)
  }

  function dismissSearch() {
    setPickedTerm(hubSearchTerm(reference))
    setActive(-1)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && showResults) {
      event.preventDefault()
      dismissSearch()
      return
    }
    if (!showResults || !results.length) return
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

  return (
    <FormDialog
      open={open}
      title="Pull image"
      description="Search Docker Hub or type a name:tag. Tag defaults to latest."
      confirmLabel="Pull"
      confirmIcon={<Download />}
      pending={isPending}
      error={error ? String(error) : null}
      trigger={
        <Button variant="primary" icon={<Download />}>
          Pull
        </Button>
      }
      onSubmit={form.handleSubmit((values) => mutate(values))}
      onOpenChange={onOpenChange}
    >
      <Controller
        name="reference"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field
            label="Image"
            hint="Pick a result or pull any exact name:tag."
            errors={[fieldState.error]}
          >
            <ComboboxPopup
              open={showResults}
              onDismiss={dismissSearch}
              popup={
                <ImageSearchResults
                  listId={listId}
                  results={results}
                  searching={searching}
                  searchError={searchError}
                  active={active}
                  emptyHint={`No images match “${term}”. You can still pull this name.`}
                  onSelectHub={selectResult}
                />
              }
            >
              <TextInput
                {...field}
                onKeyDown={onKeyDown}
                placeholder="nginx:latest"
                autoFocus
                role="combobox"
                aria-expanded={showResults}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-invalid={fieldState.invalid}
                autoComplete="off"
                spellCheck={false}
              />
            </ComboboxPopup>
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
