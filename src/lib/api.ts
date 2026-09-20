import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

import type {
  ContainerRow,
  EngineInfo,
  FsEntry,
  FsFile,
  HostTerminal,
  ImageRow,
  ImageSearchRow,
  LogChunk,
  NetworkRow,
  PruneResult,
  TermChunk,
  VolumeRow,
} from "@/lib/types"

export const api = {
  engineInfo: () => invoke<EngineInfo>("engine_info"),
  listContainers: () => invoke<ContainerRow[]>("list_containers"),
  containerStart: (id: string) => invoke<void>("container_start", { id }),
  containerStop: (id: string) => invoke<void>("container_stop", { id }),
  containerRestart: (id: string) => invoke<void>("container_restart", { id }),
  containerPause: (id: string) => invoke<void>("container_pause", { id }),
  containerUnpause: (id: string) => invoke<void>("container_unpause", { id }),
  containerRename: (id: string, name: string) => invoke<void>("container_rename", { id, name }),
  containerOpenTerminal: (id: string, terminal?: string | null) =>
    invoke<void>("container_open_terminal", { id, terminal: terminal || null }),
  listHostTerminals: () => invoke<HostTerminal[]>("list_host_terminals"),
  containerTermStart: (id: string) => invoke<void>("container_term_start", { id }),
  containerTermWrite: (id: string, data: string) =>
    invoke<void>("container_term_write", { id, data }),
  containerTermResize: (id: string, cols: number, rows: number) =>
    invoke<void>("container_term_resize", { id, cols, rows }),
  containerTermStop: (id: string) => invoke<void>("container_term_stop", { id }),
  containerRemove: (id: string) => invoke<void>("container_remove", { id }),
  containerInspect: (id: string) => invoke<unknown>("container_inspect", { id }),
  containerLogs: (id: string) => invoke<void>("container_logs", { id }),
  containerLogsStop: (id: string) => invoke<void>("container_logs_stop", { id }),
  listImages: () => invoke<ImageRow[]>("list_images"),
  imageInspect: (id: string) => invoke<unknown>("image_inspect", { id }),
  imageRemove: (id: string) => invoke<void>("image_remove", { id }),
  imagePull: (reference: string) => invoke<void>("image_pull", { reference }),
  imageSearch: (term: string) => invoke<ImageSearchRow[]>("image_search", { term }),
  containerCreate: (input: {
    image: string
    name?: string
    ports: string[]
    env: string[]
    cmd: string[]
    entrypoint: string[]
    mounts: string[]
    network?: string
    restart?: string
    start: boolean
  }) =>
    invoke<string>("container_create", {
      image: input.image,
      name: input.name || null,
      ports: input.ports,
      env: input.env,
      cmd: input.cmd,
      entrypoint: input.entrypoint,
      mounts: input.mounts,
      network: input.network || null,
      restart: input.restart || null,
      start: input.start,
    }),
  containersPrune: () => invoke<PruneResult>("containers_prune"),
  imagesPrune: () => invoke<PruneResult>("images_prune"),
  volumesPrune: () => invoke<PruneResult>("volumes_prune"),
  volumeCreate: (name: string, driver?: string) =>
    invoke<string>("volume_create", { name, driver }),
  networkCreate: (name: string, driver?: string) =>
    invoke<string>("network_create", { name, driver }),
  containerFsList: (id: string, path: string) =>
    invoke<FsEntry[]>("container_fs_list", { id, path }),
  containerFsRead: (id: string, path: string) => invoke<FsFile>("container_fs_read", { id, path }),
  containerFsWrite: (id: string, path: string, text: string) =>
    invoke<void>("container_fs_write", { id, path, text }),
  listVolumes: () => invoke<VolumeRow[]>("list_volumes"),
  volumeInspect: (name: string) => invoke<unknown>("volume_inspect", { name }),
  volumeRemove: (name: string) => invoke<void>("volume_remove", { name }),
  listNetworks: () => invoke<NetworkRow[]>("list_networks"),
  networkInspect: (id: string) => invoke<unknown>("network_inspect", { id }),
  networkRemove: (id: string) => invoke<void>("network_remove", { id }),
}

export function listenImagePull(
  onChunk: (chunk: LogChunk) => void,
  onEnd?: (id: string) => void,
): Promise<UnlistenFn> {
  const cleanups: UnlistenFn[] = []
  return Promise.all([
    listen<LogChunk>("image-pull", (event) => onChunk(event.payload)),
    listen<string>("image-pull-end", (event) => onEnd?.(event.payload)),
  ]).then((fns) => {
    cleanups.push(...fns)
    return () => {
      for (const fn of cleanups) fn()
    }
  })
}

export function listenContainerTerm(
  onChunk: (chunk: TermChunk) => void,
  onEnd?: (id: string) => void,
): Promise<UnlistenFn> {
  const cleanups: UnlistenFn[] = []
  return Promise.all([
    listen<TermChunk>("container-term", (event) => onChunk(event.payload)),
    listen<string>("container-term-end", (event) => onEnd?.(event.payload)),
  ]).then((fns) => {
    cleanups.push(...fns)
    return () => {
      for (const fn of cleanups) fn()
    }
  })
}

export function listenContainerLogs(
  onChunk: (chunk: LogChunk) => void,
  onEnd?: (id: string) => void,
): Promise<UnlistenFn> {
  const cleanups: UnlistenFn[] = []
  return Promise.all([
    listen<LogChunk>("container-logs", (event) => onChunk(event.payload)),
    listen<string>("container-logs-end", (event) => onEnd?.(event.payload)),
  ]).then((fns) => {
    cleanups.push(...fns)
    return () => {
      for (const fn of cleanups) fn()
    }
  })
}
