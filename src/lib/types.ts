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
  compose_project: string | null
  compose_service: string | null
  compose_id: string | null
  compose_workdir: string | null
  compose_config_files: string | null
}

export type UsageRef = {
  id: string
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

export type ImageHistoryRow = {
  created_by: string
  size: number
  created: number
  empty: boolean
  id?: string | null
  comment?: string | null
}

export type LayerChangeKind = "added" | "modified" | "deleted"

export type FileKind = LayerChangeKind | "unchanged"

export type LayerChange = {
  path: string
  kind: LayerChangeKind
  size: number
}

export type LayerFile = {
  path: string
  kind: FileKind
  size: number
}

export type ImageLayerDiffs = {
  layers: { changes: LayerChange[] }[]
  note?: string | null
}

/** Max bytes fetched and rendered for an image layer file preview. */
export const PREVIEW_MAX_BYTES = 256 * 1024

export type LayerFilePreview = {
  path: string
  kind: "text" | "binary"
  size: number
  text: string | null
  truncated: boolean
}

export type PruneResult = {
  deleted: number
  space_reclaimed: number
}

export type DiskUsageKind = {
  size: number
  reclaimable: number
}

export type DiskUsage = {
  images: DiskUsageKind
  containers: DiskUsageKind
  volumes: DiskUsageKind
}

export type ContainerStats = {
  id: string
  cpu_percent: number
  memory_used: number
  memory_limit: number
  net_rx: number
  net_tx: number
}

export type EngineEvent = {
  type: string
  action: string
  actor_id: string
  actor_name: string
  time: number
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

export type StackRow = {
  id: string
  name: string
  service_count: number
  services: string[]
  updated_at: number
  last_project: string | null
  projects: string[]
}

export type StackDetail = {
  id: string
  name: string
  yaml: string
  updated_at: number
  last_project: string | null
  projects: string[]
}
