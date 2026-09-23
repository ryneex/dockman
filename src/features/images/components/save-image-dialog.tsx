import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import { FileDown } from "lucide-react"
import { useEffect } from "react"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import { Field, TextInput } from "@/components/ui/field"
import { FormDialog } from "@/components/ui/form-dialog"
import { api } from "@/lib/api"

const SaveImage = z.object({
  destPath: z.string().trim().min(1, "Destination path is required"),
})

type SaveImageValues = z.infer<typeof SaveImage>

function defaultDestPath(tag: string) {
  const base = (tag.trim() || "image").replace(/[/:]/g, "-")
  return `/tmp/${base}.tar`
}

export function SaveImageDialog({
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
  const form = useForm({
    resolver: zodResolver(SaveImage),
    defaultValues: { destPath: defaultDestPath(currentTag) },
  })

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: async ({ destPath }: SaveImageValues) => {
      if (!idOrName) throw new Error("Image is required")
      await api.imageSave(idOrName, destPath)
      return destPath
    },
    onSuccess: (destPath) => {
      toast.success(`Saved to ${destPath}`)
      onOpenChange(false)
    },
  })

  useEffect(() => {
    if (!open) return
    form.reset({ destPath: defaultDestPath(currentTag) })
    reset()
  }, [currentTag, form, open, reset])

  return (
    <FormDialog
      open={open}
      title="Save image"
      description="Write a tar archive to an absolute path on this machine."
      confirmLabel="Save"
      pendingLabel="Saving…"
      confirmIcon={<FileDown />}
      pending={isPending}
      error={error ? String(error) : null}
      onSubmit={form.handleSubmit((values) => mutate(values))}
      onOpenChange={onOpenChange}
    >
      <Controller
        name="destPath"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field
            label="Destination"
            hint="Tilde paths are not expanded. Example: /home/you/nginx-latest.tar"
            errors={[fieldState.error]}
          >
            <TextInput
              {...field}
              placeholder="/tmp/image.tar"
              autoFocus
              aria-invalid={fieldState.invalid}
              spellCheck={false}
            />
          </Field>
        )}
      />
    </FormDialog>
  )
}
