import { useQueries, useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { api } from "@/lib/api"
import type { ContainerStats } from "@/lib/types"

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
