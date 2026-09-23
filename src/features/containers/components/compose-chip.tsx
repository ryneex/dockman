import { Link } from "react-router-dom"

import { Chip } from "@/components/ui/chip"
import { stackIdForProject } from "@/lib/compose-groups"
import { useStacks } from "@/lib/queries"

export function ComposeChip({
  project,
  service,
}: {
  project: string | null
  service: string | null
}) {
  const stacks = useStacks()
  const projectKey = project?.trim() ?? ""
  if (!projectKey) return null

  const serviceName = service?.trim() ?? ""
  const title = serviceName ? `${projectKey} / ${serviceName}` : "Compose"
  const stackId = stackIdForProject(stacks.data ?? [], projectKey)
  const chip = (
    <Chip className={stackId ? "hover:text-ink shrink-0" : "shrink-0"}>{projectKey}</Chip>
  )

  if (!stackId) {
    return (
      <span title={title} aria-label={`Compose ${projectKey}`}>
        {chip}
      </span>
    )
  }

  return (
    <Link
      to={`/stacks/${stackId}`}
      title={title}
      aria-label={`Compose ${projectKey}`}
      className="min-w-0 shrink-0"
      onClick={(event) => event.stopPropagation()}
    >
      {chip}
    </Link>
  )
}
