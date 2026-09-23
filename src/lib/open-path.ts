import { openPath } from "@tauri-apps/plugin-opener"
import { toast } from "sonner"

/** Open a host directory or file with the system default app (file manager for dirs). */
export async function openHostPath(path: string) {
  try {
    await openPath(path)
  } catch (error) {
    toast.error(String(error))
  }
}
