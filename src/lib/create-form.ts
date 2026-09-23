import { z } from "zod"

export function parseLines(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

function mountError(line: string) {
  const rest = line.endsWith(":ro") || line.endsWith(":rw") ? line.slice(0, -3) : line
  const sep = rest.lastIndexOf(":")
  if (sep <= 0) return `Invalid mount: ${line}`
  const source = rest.slice(0, sep)
  const target = rest.slice(sep + 1)
  if (!target.startsWith("/")) return `Container path must be absolute: ${line}`
  if (source.includes("/") && !source.startsWith("/")) return `Invalid mount: ${line}`
  return null
}

function refineLines(text: string, check: (line: string) => string | null, ctx: z.RefinementCtx) {
  for (const line of parseLines(text)) {
    const message = check(line)
    if (message) {
      ctx.addIssue({ code: "custom", message })
      return
    }
  }
}

export const RunContainer = z.object({
  image: z.string().trim().min(1, "Image is required"),
  name: z.string(),
  cmd: z.string(),
  entrypoint: z.string(),
  user: z.string(),
  workdir: z.string(),
  /** Memory limit as bytes ("536870912") or a Docker size ("512m", "1g"). Empty is unlimited. */
  memory: z.string().superRefine((text, ctx) => {
    const value = text.trim()
    if (!value) return
    if (!/^\d+(?:[kKmMgG]i?[bB]?)?$/.test(value)) {
      ctx.addIssue({ code: "custom", message: `Invalid memory limit: ${text}` })
    }
  }),
  ports: z.string().superRefine((text, ctx) => {
    refineLines(
      text,
      (line) =>
        /^\d{1,5}(?::\d{1,5})?(?:\/(?:tcp|udp))?$/.test(line)
          ? null
          : `Invalid port mapping: ${line}`,
      ctx,
    )
  }),
  mounts: z.string().superRefine((text, ctx) => {
    refineLines(text, mountError, ctx)
  }),
  env: z.string().superRefine((text, ctx) => {
    refineLines(
      text,
      (line) => (line.includes("=") ? null : `Env vars must be KEY=value (${line})`),
      ctx,
    )
  }),
  network: z.string(),
  restart: z.enum(["no", "on-failure", "always", "unless-stopped"]),
  start: z.boolean(),
})

export type RunContainerValues = z.infer<typeof RunContainer>

export const PullImage = z.object({
  reference: z.string().trim().min(1, "Image reference is required"),
})

export type PullImageValues = z.infer<typeof PullImage>

export const CreateVolume = z.object({
  name: z.string().trim().min(1, "Volume name is required"),
  driver: z.string().trim().min(1, "Driver is required"),
})

export type CreateVolumeValues = z.infer<typeof CreateVolume>

export const CreateNetwork = z.object({
  name: z.string().trim().min(1, "Network name is required"),
  driver: z.string().trim().min(1, "Driver is required"),
})

export type CreateNetworkValues = z.infer<typeof CreateNetwork>

export const RenameContainer = z.object({
  name: z.string().trim().min(1, "Name is required"),
})

export const CreateStack = z.object({
  name: z.string().trim().min(1, "Compose name is required"),
  yaml: z.string(),
})

export type CreateStackValues = z.infer<typeof CreateStack>

export const StackProject = z.object({
  project: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, "Use lowercase letters, digits, hyphens, or underscores"),
})

export type StackProjectValues = z.infer<typeof StackProject>

export const ComposeService = z.object({
  image: z.string(),
  command: z.string(),
  entrypoint: z.string(),
  user: z.string(),
  workdir: z.string(),
  memory: z.string().superRefine((text, ctx) => {
    const value = text.trim()
    if (!value) return
    if (!/^\d+(?:[kKmMgG]i?[bB]?)?$/.test(value)) {
      ctx.addIssue({ code: "custom", message: `Invalid memory limit: ${text}` })
    }
  }),
  ports: z.string().superRefine((text, ctx) => {
    refineLines(
      text,
      (line) =>
        /^\d{1,5}(?::\d{1,5})?(?:\/(?:tcp|udp))?$/.test(line)
          ? null
          : `Invalid port mapping: ${line}`,
      ctx,
    )
  }),
  env: z.string().superRefine((text, ctx) => {
    refineLines(
      text,
      (line) => (line.includes("=") ? null : `Env vars must be KEY=value (${line})`),
      ctx,
    )
  }),
  volumes: z.string().superRefine((text, ctx) => {
    refineLines(text, mountError, ctx)
  }),
  networks: z.string(),
  restart: z.enum(["", "no", "on-failure", "always", "unless-stopped"]),
  depends_on: z.string(),
  depends_healthy: z.string(),
  healthcheck: z.object({
    enabled: z.boolean(),
    test: z.string(),
    interval: z.string(),
    timeout: z.string(),
    retries: z.string().superRefine((text, ctx) => {
      const value = text.trim()
      if (!value) return
      if (!/^\d+$/.test(value) || Number(value) < 1) {
        ctx.addIssue({ code: "custom", message: `Invalid retries: ${text}` })
      }
    }),
  }),
})

export type ComposeServiceForm = z.infer<typeof ComposeService>

export type RenameContainerValues = z.infer<typeof RenameContainer>
