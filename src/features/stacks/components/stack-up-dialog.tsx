import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, Play, Square } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"

import { Checkbox } from "@/components/ui/checkbox"
import { Field, TextInput } from "@/components/ui/field"
import { FormDialog } from "@/components/ui/form-dialog"
import { api, listenStackCompose } from "@/lib/api"
import { StackProject, type StackProjectValues } from "@/lib/create-form"

function downDescription(project: string, lockProject: boolean, volumes: boolean) {
  if (volumes) {
    return lockProject
      ? `Run docker compose down -v for “${project}”? Named volumes for this project are removed.`
      : "Runs docker compose down -v. Named volumes for this project are removed."
  }
  return lockProject
    ? `Run docker compose down for “${project}”?`
    : "Runs docker compose down for this project."
}

export function StackUpDialog({
  open,
  mode,
  stackId,
  stackName,
  defaultProject,
  lockProject = false,
  onOpenChange,
}: {
  open: boolean
  mode: "up" | "down"
  stackId: string
  stackName: string
  defaultProject: string
  lockProject?: boolean
  onOpenChange: (open: boolean) => void
}) {
  const client = useQueryClient()
  const [progress, setProgress] = useState<string[]>([])
  const [volumes, setVolumes] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  const form = useForm({
    resolver: zodResolver(StackProject),
    defaultValues: { project: defaultProject },
  })

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: async ({ project }: StackProjectValues) => {
      if (mode === "up") await api.stackUp(stackId, project)
      else await api.stackDown(stackId, project, volumes)
    },
    onSuccess: async (_data, values) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["stacks"] }),
        client.invalidateQueries({ queryKey: ["stack", stackId] }),
        client.invalidateQueries({ queryKey: ["containers"] }),
        client.invalidateQueries({ queryKey: ["networks"] }),
        client.invalidateQueries({ queryKey: ["volumes"] }),
        client.invalidateQueries({ queryKey: ["engine"] }),
      ])
      toast.success(mode === "up" ? `Started ${values.project}` : `Stopped ${values.project}`)
      onOpenChange(false)
    },
  })

  useEffect(() => {
    if (!open) return
    form.reset({ project: defaultProject })
    setProgress([])
    setVolumes(false)
    reset()
  }, [defaultProject, form, open, reset])

  useEffect(() => {
    if (!open) return
    let gone = false
    let stop: (() => void) | undefined
    void listenStackCompose(
      (chunk) => {
        if (gone || chunk.id !== stackId) return
        setProgress((current) => current.concat(chunk.line))
      },
      () => undefined,
    ).then((unlisten) => {
      if (gone) unlisten()
      else stop = unlisten
    })
    return () => {
      gone = true
      stop?.()
    }
  }, [open, stackId])

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight)
  }, [progress, isPending])

  const starting = mode === "up"
  const showLog = progress.length > 0 || (starting && isPending)

  return (
    <FormDialog
      open={open}
      compact={!starting}
      title={starting ? `Start ${stackName}` : `Stop ${defaultProject}`}
      description={
        starting
          ? "Runs docker compose up -d with this project name. Containers are prefixed by Compose."
          : downDescription(defaultProject, lockProject, volumes)
      }
      confirmLabel={starting ? "Up" : "Down"}
      pendingLabel={starting ? "Starting…" : "Stopping…"}
      confirmIcon={starting ? <Play /> : <Square />}
      pending={isPending}
      error={error ? String(error) : null}
      onSubmit={form.handleSubmit((values) => mutate(values))}
      onOpenChange={onOpenChange}
    >
      {lockProject ? (
        <input type="hidden" {...form.register("project")} />
      ) : (
        <Controller
          name="project"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field
              label="Project name"
              hint="Lowercase letters, digits, hyphens, or underscores."
              errors={[fieldState.error]}
            >
              <TextInput
                {...field}
                autoFocus
                aria-invalid={fieldState.invalid}
                spellCheck={false}
              />
            </Field>
          )}
        />
      )}
      {starting ? null : (
        <label className="text-muted flex items-center gap-2 text-sm">
          <Checkbox
            checked={volumes}
            onChange={(event) => setVolumes(event.target.checked)}
            aria-label="Remove volumes"
          />
          Remove volumes
        </label>
      )}
      {showLog ? (
        <div
          ref={logRef}
          role="status"
          className="border-border bg-canvas text-muted max-h-36 overflow-auto rounded-[10px] border p-3 font-mono text-xs"
        >
          {progress.map((line, index) => (
            <p key={`${index}-${line}`}>{line}</p>
          ))}
          {isPending ? (
            <p className="text-ink flex items-center gap-2">
              <Loader2 className="size-3.5 shrink-0 animate-spin" />
              {starting ? "Starting…" : "Stopping…"}
            </p>
          ) : null}
        </div>
      ) : null}
    </FormDialog>
  )
}
