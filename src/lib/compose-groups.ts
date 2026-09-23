import { matchesQuery } from "@/lib/format"
import type { ContainerRow, StackRow } from "@/lib/types"

export type StackProjectFields = Pick<StackRow, "id" | "last_project" | "projects">

export function stackProjectKey(stack: Pick<StackRow, "id" | "last_project">) {
  const project = stack.last_project?.trim()
  return project || stack.id
}

export function knownStackProjects(stack: StackProjectFields) {
  const names = new Set<string>()
  for (const name of stack.projects ?? []) {
    const trimmed = name.trim()
    if (trimmed) names.add(trimmed)
  }
  const last = stack.last_project?.trim()
  if (last) names.add(last)
  return names
}

export function stackIdForProject(
  stacks: StackProjectFields[],
  project: string | null | undefined,
) {
  const key = project?.trim()
  if (!key) return undefined
  return stacks.find((stack) => knownStackProjects(stack).has(key))?.id
}

function containerMatchesStack(
  row: Pick<ContainerRow, "compose_project">,
  stack: StackProjectFields,
) {
  const project = row.compose_project?.trim()
  return Boolean(project && knownStackProjects(stack).has(project))
}

export function liveProjectNames(stack: StackProjectFields, containers: ContainerRow[]) {
  const known = knownStackProjects(stack)
  const live = new Set<string>()
  for (const row of containers) {
    const name = row.compose_project?.trim()
    if (name && known.has(name)) live.add(name)
  }
  return live
}

export function containersForProject(containers: ContainerRow[], projectName: string) {
  return containers.filter((row) => row.compose_project?.trim() === projectName)
}

export type StackProjectGroup = {
  name: string
  last: boolean
  live: boolean
  running: number
  containers: ContainerRow[]
}

export function stackProjectGroups(
  stack: StackProjectFields,
  containers: ContainerRow[],
): StackProjectGroup[] {
  const last = stack.last_project?.trim() ?? ""
  const live = liveProjectNames(stack, containers)
  const names = [...knownStackProjects(stack)].sort((a, b) => {
    if (a === last && b !== last) return -1
    if (b === last && a !== last) return 1
    return a.localeCompare(b)
  })
  return names.map((name) => {
    const members = containersForProject(containers, name)
    return {
      name,
      last: Boolean(last) && last === name,
      live: live.has(name),
      running: members.filter((row) => row.state === "running").length,
      containers: members,
    }
  })
}

function stateRank(state: string) {
  if (state === "running") return 0
  if (state === "restarting") return 1
  if (state === "paused") return 2
  return 3
}

function bestContainerState(rows: Array<{ state: string }>) {
  if (!rows.length) return "created"
  return rows.reduce(
    (best, row) => (stateRank(row.state) < stateRank(best) ? row.state : best),
    rows[0].state,
  )
}

export function containerMatchesQuery(query: string, row: ContainerRow) {
  return matchesQuery(
    query,
    row.name,
    row.image,
    row.id,
    row.state,
    row.status,
    row.ports.join(" "),
    row.compose_project ?? "",
    row.compose_service ?? "",
    row.compose_id ?? "",
  )
}

function liveProjectsLabel(count: number) {
  if (count <= 0) return "Not started"
  if (count === 1) return "1 live"
  return `${count} live projects`
}

function uniqueMemberServices(rows: ContainerRow[]) {
  const names: string[] = []
  for (const row of rows) {
    const name = row.compose_service?.trim()
    if (name && !names.includes(name)) names.push(name)
  }
  return names
}

function serviceReplicas(members: ContainerRow[], name: string) {
  return members.filter((row) => row.compose_service?.trim() === name)
}

export type StackServiceStatus = {
  name: string
  state: string
  running: boolean
}

export type StackRuntime = {
  running: number
  total: number
  liveProjects: number
  label: string
  services: StackServiceStatus[]
}

export function stackRuntime(stack: StackRow, containers: ContainerRow[]): StackRuntime {
  const members = containers.filter((row) => containerMatchesStack(row, stack))
  const yamlServices = (stack.services ?? []).map((name) => name.trim()).filter(Boolean)
  const defined = yamlServices.length ? yamlServices : uniqueMemberServices(members)
  const services = defined.map((name) => {
    const replicas = serviceReplicas(members, name)
    return {
      name,
      state: bestContainerState(replicas),
      running: replicas.some((row) => row.state === "running"),
    }
  })
  const running = services.filter((service) => service.running).length
  const liveProjects = liveProjectNames(stack, containers).size
  return {
    running,
    total: services.length,
    liveProjects,
    label: liveProjectsLabel(liveProjects),
    services,
  }
}
