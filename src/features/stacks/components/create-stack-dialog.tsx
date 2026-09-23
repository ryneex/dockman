import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useEffect } from "react"
import { Controller, useForm } from "react-hook-form"
import { useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Field, TextArea, TextInput } from "@/components/ui/field"
import { FormDialog } from "@/components/ui/form-dialog"
import { api } from "@/lib/api"
import { CreateStack, type CreateStackValues } from "@/lib/create-form"

export function CreateStackDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const client = useQueryClient()
  const navigate = useNavigate()
  const form = useForm({
    resolver: zodResolver(CreateStack),
    defaultValues: { name: "", yaml: "" },
  })

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: async ({ name, yaml }: CreateStackValues) => {
      return api.stackCreate(name, yaml)
    },
    onSuccess: async (id) => {
      await client.invalidateQueries({ queryKey: ["stacks"] })
      onOpenChange(false)
      void navigate(`/stacks/${id}`)
    },
  })

  useEffect(() => {
    if (!open) return
    form.reset({ name: "", yaml: "" })
    reset()
  }, [form, open, reset])

  return (
    <FormDialog
      open={open}
      title="New compose"
      description="Saved in Dockman as compose.yml. Paste existing Compose to import."
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
        name="yaml"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field
            label="Compose YAML"
            hint="Optional. Leave empty for a blank services map."
            errors={[fieldState.error]}
          >
            <TextArea
              {...field}
              placeholder={"services:\n  app:\n    image: image:tag"}
              className="min-h-40"
              aria-invalid={fieldState.invalid}
            />
          </Field>
        )}
      />
    </FormDialog>
  )
}
