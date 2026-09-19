import { useQuery } from "@tanstack/react-query"

import { api } from "@/lib/api"

const interval = 3000

export function useEngine() {
  return useQuery({
    queryKey: ["engine"],
    queryFn: api.engineInfo,
    refetchInterval: interval,
    retry: 1,
  })
}

export function useContainers() {
  return useQuery({
    queryKey: ["containers"],
    queryFn: api.listContainers,
    refetchInterval: interval,
  })
}

export function useImages() {
  return useQuery({
    queryKey: ["images"],
    queryFn: api.listImages,
    refetchInterval: interval,
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
