import { useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useEffect, useState } from "react"

import { Field, TextInput } from "@/components/ui/field"
import { FormDialog } from "@/components/ui/form-dialog"
import { api } from "@/lib/api"

export function CreateNetworkDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = useQueryClient()
  const [name, setName] = useState("")
  const [driver, setDriver] = useState("bridge")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName("")
    setDriver("bridge")
    setPending(false)
    setError(null)
  }, [open])

  async function submit() {
    if (!name.trim()) {
      setError("Network name is required")
      return
    }
    setPending(true)
    setError(null)
    try {
      await api.networkCreate(name.trim(), driver.trim() || "bridge")
      await client.invalidateQueries({ queryKey: ["networks"] })
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
      title="Create network"
      confirmLabel="Create"
      confirmIcon={<Plus />}
      pending={pending}
      error={error}
      onSubmit={() => void submit()}
      onClose={onClose}
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
          placeholder="bridge"
        />
      </Field>
    </FormDialog>
  )
}
