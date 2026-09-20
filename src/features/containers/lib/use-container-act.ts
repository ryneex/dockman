import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { api } from "@/lib/api"
import type { ContainerRow } from "@/lib/types"

export type ContainerOp = "start" | "stop" | "restart" | "pause" | "unpause"

export function useContainerAct() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, op }: { id: string; op: ContainerOp }) => {
      if (op === "start") return api.containerStart(id)
      if (op === "stop") return api.containerStop(id)
      if (op === "pause") return api.containerPause(id)
      if (op === "unpause") return api.containerUnpause(id)
      return api.containerRestart(id)
    },
    onMutate: async ({ id, op }) => {
      await client.cancelQueries({ queryKey: ["containers"] })
      const previous = client.getQueryData<ContainerRow[]>(["containers"])
      client.setQueryData<ContainerRow[]>(["containers"], (current = []) =>
        current.map((row) =>
          row.id === id
            ? {
                ...row,
                state:
                  op === "stop"
                    ? "exited"
                    : op === "pause"
                      ? "paused"
                      : op === "unpause" || op === "start"
                        ? "running"
                        : row.state,
                status:
                  op === "restart"
                    ? "restarting..."
                    : op === "stop"
                      ? "stopping..."
                      : op === "pause"
                        ? "pausing..."
                        : op === "unpause"
                          ? "resuming..."
                          : "starting...",
              }
            : row,
        ),
      )
      return { previous }
    },
    onError: (error, _vars, ctx) => {
      if (ctx?.previous) client.setQueryData(["containers"], ctx.previous)
      toast.error(String(error))
    },
    onSettled: () => client.invalidateQueries({ queryKey: ["containers"] }),
  })
}
