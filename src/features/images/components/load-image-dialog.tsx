import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { FileUp } from "lucide-react"
import { useEffect } from "react"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import { Field, TextInput } from "@/components/ui/field"
import { FormDialog } from "@/components/ui/form-dialog"
import { api } from "@/lib/api"

const LoadImage = z.object({
  srcPath: z.string().trim().min(1, "Source path is required"),
})

type LoadImageValues = z.infer<typeof LoadImage>

export function LoadImageDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const client = useQueryClient()
  const form = useForm({
    resolver: zodResolver(LoadImage),
    defaultValues: { srcPath: "" },
  })

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: async ({ srcPath }: LoadImageValues) => {
      await api.imageLoad(srcPath)
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["images"] }),
        client.invalidateQueries({ queryKey: ["engine"] }),
      ])
      toast.success("Loaded image archive")
      onOpenChange(false)
    },
  })

  useEffect(() => {
    if (!open) return
    form.reset({ srcPath: "" })
    reset()
  }, [form, open, reset])

  return (
    <FormDialog
      open={open}
      title="Load image"
      description="Import a tar archive from an absolute path on this machine."
      confirmLabel="Load"
      pendingLabel="Loading…"
      confirmIcon={<FileUp />}
      pending={isPending}
      error={error ? String(error) : null}
      trigger={<Button icon={<FileUp />}>Load</Button>}
      onSubmit={form.handleSubmit((values) => mutate(values))}
      onOpenChange={onOpenChange}
    >
      <Controller
        name="srcPath"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field
            label="Archive"
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
