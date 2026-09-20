import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useEffect } from "react"
import { Controller, useForm } from "react-hook-form"

import { Button } from "@/components/ui/button"
import { Field, TextInput } from "@/components/ui/field"
import { FormDialog } from "@/components/ui/form-dialog"
import { api } from "@/lib/api"
import { CreateVolume, type CreateVolumeValues } from "@/lib/create-form"

export function CreateVolumeDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const client = useQueryClient()
  const form = useForm({
    resolver: zodResolver(CreateVolume),
    defaultValues: { name: "", driver: "local" },
  })

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: async ({ name, driver }: CreateVolumeValues) => {
      await api.volumeCreate(name, driver)
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["volumes"] })
      onOpenChange(false)
    },
  })

  useEffect(() => {
    if (!open) return
    form.reset({ name: "", driver: "local" })
    reset()
  }, [form, open, reset])

  return (
    <FormDialog
      open={open}
      title="Create volume"
      confirmLabel="Create"
      confirmIcon={<Plus />}
      pending={isPending}
      error={error ? String(error) : null}
      trigger={
        <Button variant="primary" icon={<Plus />}>
          New
        </Button>
      }
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
      <Controller
        name="driver"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field label="Driver" errors={[fieldState.error]}>
            <TextInput {...field} placeholder="local" aria-invalid={fieldState.invalid} />
          </Field>
        )}
      />
    </FormDialog>
  )
}
