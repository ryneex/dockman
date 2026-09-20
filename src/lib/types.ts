export type EngineInfo = {
  name: string
  server_version: string
  operating_system: string
  architecture: string
  ncpu: number
  mem_total: number
  containers: number
  containers_running: number
  containers_paused: number
  containers_stopped: number
  images: number
}

export type ContainerRow = {
  id: string
  name: string
  image: string
  status: string
  state: string
  ports: string[]
  created: number
}

export type UsageRef = {
  name: string
  state: string
}

export type ImageRow = {
  id: string
  tags: string[]
  size: number
  created: number
  dangling: boolean
  used_by: UsageRef[]
}

export type PruneResult = {
  deleted: number
  space_reclaimed: number
}

export type RestartPolicy = "no" | "on-failure" | "always" | "unless-stopped"

export type TerminalTarget = "external" | "embedded"

export type HostTerminal = {
  id: string
  label: string
}

export type TermChunk = {
  id: string
  data: string
}

export type ImageSearchRow = {
  name: string
  description: string
  official: boolean
  stars: number
}

export type VolumeRow = {
  name: string
  driver: string
  mountpoint: string
  created_at: string | null
  used_by: UsageRef[]
}

export type NetworkRow = {
  id: string
  name: string
  driver: string
  scope: string
  builtin: boolean
  used_by: UsageRef[]
}

export type LogChunk = {
  id: string
  line: string
}

export type FsEntry = {
  name: string
  path: string
  kind: string
  size: number
}

export type FsFile = {
  path: string
  text: string
}
