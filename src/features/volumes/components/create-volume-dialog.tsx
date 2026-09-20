import { useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, TextInput } from "@/components/ui/field"
import { FormDialog } from "@/components/ui/form-dialog"
import { api } from "@/lib/api"

export function CreateVolumeDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const client = useQueryClient()
  const [name, setName] = useState("")
  const [driver, setDriver] = useState("local")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName("")
    setDriver("local")
    setPending(false)
    setError(null)
  }, [open])

  async function submit() {
    if (!name.trim()) {
      setError("Volume name is required")
      return
    }
    setPending(true)
    setError(null)
    try {
      await api.volumeCreate(name.trim(), driver.trim() || "local")
      await client.invalidateQueries({ queryKey: ["volumes"] })
      onOpenChange(false)
    } catch (err) {
      setError(String(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <FormDialog
      open={open}
      title="Create volume"
      confirmLabel="Create"
      confirmIcon={<Plus />}
      pending={pending}
      error={error}
      trigger={
        <Button variant="primary" icon={<Plus />}>
          New
        </Button>
      }
      onSubmit={() => void submit()}
      onOpenChange={onOpenChange}
    >
      <Field label="Name">
        <TextInput
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoFocus
          required
        />
      </Field>
      <Field label="Driver">
        <TextInput
          value={driver}
          onChange={(event) => setDriver(event.target.value)}
          placeholder="local"
        />
      </Field>
    </FormDialog>
  )
}
