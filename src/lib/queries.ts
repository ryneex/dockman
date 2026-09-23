import { useQueries, useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { api } from "@/lib/api"
import { PREVIEW_MAX_BYTES, type ContainerStats, type LayerFilePreview } from "@/lib/types"

const interval = 3000

export function useEngine() {
  return useQuery({
    queryKey: ["engine"],
    queryFn: api.engineInfo,
    refetchInterval: interval,
    retry: 1,
  })
}

export function useSystemDf() {
  return useQuery({
    queryKey: ["system-df"],
    queryFn: api.systemDf,
    refetchInterval: interval,
  })
}

export function useEngineEvents() {
  return useQuery({
    queryKey: ["engine-events"],
    queryFn: () => api.engineEvents(),
    refetchInterval: interval,
  })
}

export function useContainers() {
  return useQuery({
    queryKey: ["containers"],
    queryFn: api.listContainers,
    refetchInterval: interval,
  })
}

export function useContainerStats(id: string | null, enabled = true) {
  return useQuery({
    queryKey: ["container-stats", id],
    queryFn: () => api.containerStats(id!),
    enabled: Boolean(id) && enabled,
    refetchInterval: interval,
  })
}

export function useContainerStatsMap(ids: string[]) {
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["container-stats", id],
      queryFn: () => api.containerStats(id),
      refetchInterval: interval,
    })),
  })

  return useMemo(() => {
    const map = new Map<string, ContainerStats>()
    ids.forEach((id, index) => {
      const stats = results[index]?.data
      if (stats) map.set(id, stats)
    })
    return map
  }, [ids, results])
}

export function useImages() {
  return useQuery({
    queryKey: ["images"],
    queryFn: api.listImages,
    refetchInterval: interval,
  })
}

export function useImageInspect(id: string | null, enabled = true) {
  return useQuery({
    queryKey: ["image-inspect", id],
    queryFn: () => api.imageInspect(id!),
    enabled: Boolean(id) && enabled,
    staleTime: 5 * 60 * 1000,
  })
}

export function useImageHistory(id: string | null) {
  return useQuery({
    queryKey: ["image-history", id],
    queryFn: () => api.imageHistory(id!),
    enabled: Boolean(id),
    staleTime: 5 * 60 * 1000,
  })
}

export function useImageLayerDiffs(id: string | null) {
  return useQuery({
    queryKey: ["image-layer-diffs", id],
    queryFn: () => api.imageLayerDiffs(id!),
    enabled: Boolean(id),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })
}

export function capLayerFilePreview(preview: LayerFilePreview): LayerFilePreview {
  const text = preview.text
  if (typeof text !== "string" || text.length <= PREVIEW_MAX_BYTES) return preview
  return {
    ...preview,
    text: text.slice(0, PREVIEW_MAX_BYTES),
    truncated: true,
  }
}

export function useImageLayerFile(
  id: string | null,
  layerIndex: number | null,
  path: string | null,
  epoch = 0,
) {
  return useQuery({
    queryKey: ["image-layer-file", id, layerIndex, path, epoch],
    queryFn: async ({ signal }) => {
      const preview = capLayerFilePreview(await api.imageLayerFile(id!, layerIndex!, path!))
      if (signal.aborted) throw new DOMException("Aborted", "AbortError")
      return preview
    },
    enabled: Boolean(id) && layerIndex != null && Boolean(path),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
}

export function useVolumes() {
  return useQuery({
    queryKey: ["volumes"],
    queryFn: api.listVolumes,
    refetchInterval: interval,
  })
}

export function useNetworks() {
  return useQuery({
    queryKey: ["networks"],
    queryFn: api.listNetworks,
    refetchInterval: interval,
  })
}

export function useComposeAvailable() {
  return useQuery({
    queryKey: ["compose-available"],
    queryFn: api.composeAvailable,
    staleTime: 60_000,
  })
}

export function useStacks() {
  return useQuery({
    queryKey: ["stacks"],
    queryFn: api.stackList,
  })
}

export function useStack(id: string | null) {
  return useQuery({
    queryKey: ["stack", id],
    queryFn: () => api.stackRead(id!),
    enabled: Boolean(id),
  })
}
