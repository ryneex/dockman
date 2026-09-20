import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Pencil } from "lucide-react"
import { useEffect } from "react"
import { Controller, useForm } from "react-hook-form"

import { Field, TextInput } from "@/components/ui/field"
import { FormDialog } from "@/components/ui/form-dialog"
import { api } from "@/lib/api"
import { RenameContainer, type RenameContainerValues } from "@/lib/create-form"

export function RenameContainerDialog({
  open,
  id,
  name,
  onOpenChange,
}: {
  open: boolean
  id: string | null
  name: string
  onOpenChange: (open: boolean) => void
}) {
  const client = useQueryClient()
  const form = useForm({
    resolver: zodResolver(RenameContainer),
    defaultValues: { name },
  })

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: async ({ name }: RenameContainerValues) => {
      if (!id) throw new Error("Container is required")
      await api.containerRename(id, name)
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["containers"] })
      onOpenChange(false)
    },
  })

  useEffect(() => {
    if (!open) return
    form.reset({ name })
    reset()
  }, [form, name, open, reset])

  return (
    <FormDialog
      open={open}
      title="Rename container"
      confirmLabel="Rename"
      confirmIcon={<Pencil />}
      pending={isPending}
      error={error ? String(error) : null}
      onSubmit={form.handleSubmit((values) => mutate(values))}
      onOpenChange={onOpenChange}
    >
      <Controller
        name="name"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field label="Name" errors={[fieldState.error]}>
            <TextInput {...field} autoFocus aria-invalid={fieldState.invalid} />
          </Field>
        )}
      />
    </FormDialog>
  )
}
