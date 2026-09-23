import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Tag } from "lucide-react"
import { useEffect } from "react"
import { Controller, useForm } from "react-hook-form"
import { z } from "zod"

import { Field, TextInput } from "@/components/ui/field"
import { FormDialog } from "@/components/ui/form-dialog"
import { api } from "@/lib/api"
import { splitImageRef } from "@/lib/image-hints"

const TagImage = z.object({
  repo: z.string().trim().min(1, "Repository is required"),
  tag: z.string(),
})

type TagImageValues = z.infer<typeof TagImage>

export function TagImageDialog({
  open,
  idOrName,
  currentTag,
  onOpenChange,
}: {
  open: boolean
  idOrName: string | null
  currentTag: string
  onOpenChange: (open: boolean) => void
}) {
  const client = useQueryClient()
  const defaults = splitImageRef(currentTag)
  const form = useForm({
    resolver: zodResolver(TagImage),
    defaultValues: defaults,
  })

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: async ({ repo, tag }: TagImageValues) => {
      if (!idOrName) throw new Error("Image is required")
      await api.imageTag(idOrName, repo, tag.trim() || undefined)
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["images"] }),
        client.invalidateQueries({ queryKey: ["image-inspect"] }),
        client.invalidateQueries({ queryKey: ["engine"] }),
      ])
      onOpenChange(false)
    },
  })

  useEffect(() => {
    if (!open) return
    form.reset(splitImageRef(currentTag))
    reset()
  }, [currentTag, form, open, reset])

  return (
    <FormDialog
      open={open}
      title="Tag image"
      description="Empty tag is stored as latest."
      confirmLabel="Tag"
      confirmIcon={<Tag />}
      pending={isPending}
      error={error ? String(error) : null}
      onSubmit={form.handleSubmit((values) => mutate(values))}
      onOpenChange={onOpenChange}
    >
      <Controller
        name="repo"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field label="Repository" hint="Name or registry/name" errors={[fieldState.error]}>
            <TextInput
              {...field}
              placeholder="nginx"
              autoFocus
              aria-invalid={fieldState.invalid}
              spellCheck={false}
            />
          </Field>
        )}
      />
      <Controller
        name="tag"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field label="Tag" hint="Defaults to latest" errors={[fieldState.error]}>
            <TextInput
              {...field}
              placeholder="latest"
              aria-invalid={fieldState.invalid}
              spellCheck={false}
            />
          </Field>
        )}
      />
    </FormDialog>
  )
}
