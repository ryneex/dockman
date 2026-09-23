import {
  isMap,
  isSeq,
  parseDocument,
  Scalar,
  type Document,
  type ParsedNode,
  YAMLMap,
  YAMLSeq,
} from "yaml"

import { parseLines } from "@/lib/create-form"
import type { RestartPolicy } from "@/lib/types"

export type ComposeDoc = Document.Parsed<ParsedNode, true>

export type ComposeHealthcheck = {
  enabled: boolean
  test: string
  interval: string
  timeout: string
  retries: string
}

export type ComposeServiceValues = {
  image: string
  command: string
  entrypoint: string
  user: string
  workdir: string
  memory: string
  ports: string
  env: string
  volumes: string
  networks: string
  restart: RestartPolicy | ""
  depends_on: string
  depends_healthy: string
  healthcheck: ComposeHealthcheck
}

export type ComposeServiceFlags = {
  skipMemory: boolean
  keepDependsOnObject: boolean
  keepNetworksObject: boolean
}

const RESTARTS: RestartPolicy[] = ["no", "on-failure", "always", "unless-stopped"]
const HEALTHCHECK_KNOWN = new Set(["test", "interval", "timeout", "retries", "disable"])
const DEPENDS_CONDITIONS = new Set(["service_healthy", "service_started"])

export function emptyHealthcheck(): ComposeHealthcheck {
  return { enabled: false, test: "", interval: "", timeout: "", retries: "" }
}

export function emptyService(): ComposeServiceValues {
  return {
    image: "",
    command: "",
    entrypoint: "",
    user: "",
    workdir: "",
    memory: "",
    ports: "",
    env: "",
    volumes: "",
    networks: "",
    restart: "no",
    depends_on: "",
    depends_healthy: "",
    healthcheck: emptyHealthcheck(),
  }
}

export function parseCompose(text: string): ComposeDoc {
  const doc = parseDocument(text, { prettyErrors: true, strict: false })
  if (doc.errors.length) {
    throw new Error(doc.errors[0]?.message ?? "Invalid YAML")
  }
  return doc
}

function asBlock<T>(node: T): T {
  if (isMap(node) || isSeq(node)) node.flow = false
  return node
}

function blockNode(doc: ComposeDoc, value: unknown) {
  return asBlock(doc.createNode(value))
}

export function toYaml(doc: ComposeDoc) {
  return doc.toString()
}

function asMap(value: unknown): YAMLMap | null {
  return isMap(value) ? value : null
}

function scalarString(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  if (typeof value === "object" && value !== null && "value" in value) {
    const inner = (value as { value: unknown }).value
    if (inner == null) return ""
    if (typeof inner === "string" || typeof inner === "number" || typeof inner === "boolean") {
      return String(inner)
    }
  }
  return ""
}

function seqStrings(value: unknown): string[] {
  if (!isSeq(value)) {
    const one = scalarString(value)
    return one ? [one] : []
  }
  return value.items.map((item) => scalarString(item)).filter((item) => item.length > 0)
}

function joinLines(values: string[]) {
  return values.join("\n")
}

function argsToLines(value: unknown) {
  if (isSeq(value)) return joinLines(seqStrings(value))
  return scalarString(value)
}

function portLine(value: unknown): string {
  const short = scalarString(value)
  if (short) return short
  const map = asMap(value)
  if (!map) return ""
  const target = scalarString(map.get("target"))
  const published = scalarString(map.get("published"))
  const proto = scalarString(map.get("protocol")).toLowerCase()
  if (!target) return ""
  const mapping = published && published !== target ? `${published}:${target}` : target
  return proto && proto !== "tcp" ? `${mapping}/${proto}` : mapping
}

function envLines(value: unknown): string[] {
  if (isSeq(value)) return seqStrings(value)
  const map = asMap(value)
  if (!map) return []
  return map.items
    .map((pair) => {
      const key = scalarString(pair.key)
      if (!key) return ""
      return `${key}=${scalarString(pair.value)}`
    })
    .filter(Boolean)
}

function volumeLine(value: unknown): string {
  const short = scalarString(value)
  if (short) return short
  const map = asMap(value)
  if (!map) return ""
  const source = scalarString(map.get("source"))
  const target = scalarString(map.get("target"))
  if (!source || !target) return ""
  const readOnly = map.get("read_only") === true || scalarString(map.get("read_only")) === "true"
  return readOnly ? `${source}:${target}:ro` : `${source}:${target}`
}

function nameList(value: unknown): { names: string[]; object: boolean } {
  if (isSeq(value)) return { names: seqStrings(value), object: false }
  const map = asMap(value)
  if (!map) return { names: [], object: false }
  return {
    names: map.items.map((pair) => scalarString(pair.key)).filter(Boolean),
    object: true,
  }
}

function dependsOnInfo(value: unknown): {
  names: string[]
  healthy: string[]
  keepObject: boolean
} {
  if (isSeq(value)) return { names: seqStrings(value), healthy: [], keepObject: false }
  const map = asMap(value)
  if (!map) return { names: [], healthy: [], keepObject: false }

  const names: string[] = []
  const healthy: string[] = []
  let keepObject = false
  for (const pair of map.items) {
    const name = scalarString(pair.key)
    if (!name) continue
    names.push(name)
    const spec = asMap(pair.value)
    if (!spec) {
      if (pair.value != null && scalarString(pair.value) !== "") keepObject = true
      continue
    }
    const keys = spec.items.map((item) => scalarString(item.key)).filter(Boolean)
    const extra = keys.filter((key) => key !== "condition")
    const condition = scalarString(spec.get("condition"))
    if (extra.length || (condition && !DEPENDS_CONDITIONS.has(condition))) keepObject = true
    if (condition === "service_healthy") healthy.push(name)
  }
  return { names, healthy, keepObject }
}

function healthcheckTestOf(value: unknown): { text: string; none: boolean } {
  if (value == null) return { text: "", none: false }
  if (isSeq(value)) {
    const items = seqStrings(value)
    if (!items.length) return { text: "", none: false }
    const head = items[0]?.toUpperCase()
    if (head === "NONE") return { text: "", none: true }
    if (head === "CMD-SHELL") return { text: items.slice(1).join(" "), none: false }
    if (head === "CMD") return { text: joinLines(items.slice(1)), none: false }
    return { text: joinLines(items), none: false }
  }
  const scalar = scalarString(value)
  if (scalar.toUpperCase() === "NONE") return { text: "", none: true }
  return { text: scalar, none: false }
}

function healthcheckOf(value: unknown): ComposeHealthcheck {
  const map = asMap(value)
  if (!map) return emptyHealthcheck()
  const disable =
    map.get("disable") === true || scalarString(map.get("disable")).toLowerCase() === "true"
  const test = healthcheckTestOf(map.get("test"))
  return {
    enabled: !disable && !test.none,
    test: test.text,
    interval: scalarString(map.get("interval")),
    timeout: scalarString(map.get("timeout")),
    retries: scalarString(map.get("retries")),
  }
}

function flowSeq(doc: ComposeDoc, items: string[]) {
  const seq = doc.createNode(items)
  if (isSeq(seq)) {
    seq.flow = true
    for (const item of seq.items) {
      if (item instanceof Scalar) item.type = "QUOTE_DOUBLE"
    }
  }
  return seq
}

function writeHealthcheckTest(doc: ComposeDoc, path: Array<string | number>, text: string) {
  const lines = parseLines(text)
  if (!lines.length) {
    doc.deleteIn(path)
    return
  }
  if (lines.length === 1) {
    doc.setIn(path, flowSeq(doc, ["CMD-SHELL", lines[0] ?? ""]))
    return
  }
  doc.setIn(path, flowSeq(doc, ["CMD", ...lines]))
}

function writeHealthcheck(
  doc: ComposeDoc,
  service: string,
  values: ComposeHealthcheck,
  existing: unknown,
) {
  const path = ["services", service, "healthcheck"]
  const map = asMap(existing)
  const extras = map
    ? map.items.filter((pair) => !HEALTHCHECK_KNOWN.has(scalarString(pair.key)))
    : []
  const owned = extras.length === 0

  if (!values.enabled) {
    if (owned) {
      doc.deleteIn(path)
      return
    }
    doc.deleteIn([...path, "test"])
    const after = asMap(doc.getIn(path))
    if (after && after.items.length === 0) doc.deleteIn(path)
    return
  }

  if (!asMap(doc.getIn(path))) {
    doc.setIn(path, blockNode(doc, {}))
  }
  const next = asMap(doc.getIn(path))
  if (next) asBlock(next)

  writeHealthcheckTest(doc, [...path, "test"], values.test)
  doc.setIn([...path, "interval"], values.interval.trim() || "5s")
  doc.setIn([...path, "timeout"], values.timeout.trim() || "5s")
  const retries = values.retries.trim() || "5"
  const retriesNum = Number(retries)
  doc.setIn([...path, "retries"], Number.isInteger(retriesNum) ? retriesNum : retries)
  doc.deleteIn([...path, "disable"])
}

function restartOf(value: unknown): RestartPolicy | "" {
  const name = scalarString(value).toLowerCase().replace(/_/g, "-")
  return RESTARTS.includes(name as RestartPolicy) ? (name as RestartPolicy) : ""
}

function serviceMap(doc: ComposeDoc): YAMLMap | null {
  return asMap(doc.get("services"))
}

export function listServices(doc: ComposeDoc): string[] {
  const services = serviceMap(doc)
  if (!services) return []
  return services.items.map((pair) => scalarString(pair.key)).filter(Boolean)
}

export function readService(
  doc: ComposeDoc,
  name: string,
): {
  values: ComposeServiceValues
  flags: ComposeServiceFlags
} | null {
  const node = asMap(serviceMap(doc)?.get(name))
  if (!node) return null
  const depends = dependsOnInfo(node.get("depends_on"))
  const networks = nameList(node.get("networks"))
  const skipMemory = node.getIn(["deploy", "resources"]) != null
  return {
    values: {
      image: scalarString(node.get("image")),
      command: argsToLines(node.get("command")),
      entrypoint: argsToLines(node.get("entrypoint")),
      user: scalarString(node.get("user")),
      workdir: scalarString(node.get("working_dir")),
      memory: skipMemory ? "" : scalarString(node.get("mem_limit")),
      ports: joinLines(
        (isSeq(node.get("ports")) ? (node.get("ports") as YAMLSeq) : null)?.items
          .map(portLine)
          .filter(Boolean) ??
          (node.get("ports") != null ? [portLine(node.get("ports"))].filter(Boolean) : []),
      ),
      env: joinLines(envLines(node.get("environment"))),
      volumes: joinLines(
        (isSeq(node.get("volumes"))
          ? (node.get("volumes") as YAMLSeq).items.map(volumeLine)
          : []
        ).filter(Boolean),
      ),
      networks: joinLines(networks.names),
      restart: restartOf(node.get("restart")),
      depends_on: joinLines(depends.names),
      depends_healthy: joinLines(depends.healthy),
      healthcheck: healthcheckOf(node.get("healthcheck")),
    },
    flags: {
      skipMemory,
      keepDependsOnObject: depends.keepObject,
      keepNetworksObject: networks.object,
    },
  }
}

export function listHealthyServices(doc: ComposeDoc): string[] {
  return listServices(doc).filter((name) => {
    const node = asMap(serviceMap(doc)?.get(name))
    return node ? healthcheckOf(node.get("healthcheck")).enabled : false
  })
}

function quotedStringSeq(doc: ComposeDoc, lines: string[]) {
  const seq = blockNode(doc, lines)
  if (isSeq(seq)) {
    for (const item of seq.items) {
      if (item instanceof Scalar && String(item.value).includes(":")) item.type = "QUOTE_DOUBLE"
    }
  }
  return seq
}

function setOrDelete(doc: ComposeDoc, path: Array<string | number>, value: unknown) {
  if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) {
    doc.deleteIn(path)
    return
  }
  doc.setIn(path, value)
}

function writeArgs(doc: ComposeDoc, path: Array<string | number>, text: string) {
  const lines = parseLines(text)
  if (!lines.length) {
    doc.deleteIn(path)
    return
  }
  doc.setIn(path, lines.length === 1 ? lines[0] : blockNode(doc, lines))
}

function sameNames(left: string[], right: string[]) {
  return left.length === right.length && left.every((name, index) => name === right[index])
}

export function writeService(
  doc: ComposeDoc,
  name: string,
  values: ComposeServiceValues,
  flags?: ComposeServiceFlags,
) {
  if (isMap(doc.contents)) asBlock(doc.contents)
  if (!serviceMap(doc)) {
    doc.set("services", blockNode(doc, {}))
  }
  asBlock(serviceMap(doc))
  if (!asMap(serviceMap(doc)?.get(name))) {
    doc.setIn(["services", name], blockNode(doc, {}))
  }

  const current = asMap(serviceMap(doc)?.get(name))
  if (current) asBlock(current)
  const existingDepends = dependsOnInfo(current?.get("depends_on"))
  const existingNetworks = nameList(current?.get("networks"))
  const existingHealthcheck = current?.get("healthcheck")
  const envWasSeq = isSeq(current?.get("environment"))

  setOrDelete(doc, ["services", name, "image"], values.image.trim())
  writeArgs(doc, ["services", name, "command"], values.command)
  writeArgs(doc, ["services", name, "entrypoint"], values.entrypoint)
  setOrDelete(doc, ["services", name, "user"], values.user.trim())
  setOrDelete(doc, ["services", name, "working_dir"], values.workdir.trim())
  if (!flags?.skipMemory) {
    setOrDelete(doc, ["services", name, "mem_limit"], values.memory.trim())
  }

  const ports = parseLines(values.ports)
  setOrDelete(doc, ["services", name, "ports"], ports.length ? quotedStringSeq(doc, ports) : [])
  const env = parseLines(values.env)
  if (!env.length) {
    doc.deleteIn(["services", name, "environment"])
  } else if (envWasSeq) {
    doc.setIn(["services", name, "environment"], blockNode(doc, env))
  } else {
    const map: Record<string, string> = {}
    for (const line of env) {
      const sep = line.indexOf("=")
      if (sep === -1) map[line] = ""
      else map[line.slice(0, sep)] = line.slice(sep + 1)
    }
    doc.setIn(["services", name, "environment"], blockNode(doc, map))
  }
  const volumes = parseLines(values.volumes)
  setOrDelete(
    doc,
    ["services", name, "volumes"],
    volumes.length ? quotedStringSeq(doc, volumes) : [],
  )

  const networkNames = parseLines(values.networks)
  if (flags?.keepNetworksObject && sameNames(existingNetworks.names, networkNames)) {
    // leave long-form networks
  } else {
    setOrDelete(
      doc,
      ["services", name, "networks"],
      networkNames.length ? blockNode(doc, networkNames) : [],
    )
  }

  setOrDelete(doc, ["services", name, "restart"], values.restart.trim())

  const dependsNames = parseLines(values.depends_on)
  const healthy = new Set(
    parseLines(values.depends_healthy).filter((service) => dependsNames.includes(service)),
  )
  if (flags?.keepDependsOnObject && sameNames(existingDepends.names, dependsNames)) {
    // leave long-form depends_on with conditions we do not model
  } else if (!dependsNames.length) {
    doc.deleteIn(["services", name, "depends_on"])
  } else if (healthy.size) {
    const map: Record<string, { condition: string }> = {}
    for (const service of dependsNames) {
      map[service] = { condition: healthy.has(service) ? "service_healthy" : "service_started" }
    }
    doc.setIn(["services", name, "depends_on"], blockNode(doc, map))
  } else {
    doc.setIn(["services", name, "depends_on"], blockNode(doc, dependsNames))
  }

  writeHealthcheck(doc, name, values.healthcheck ?? emptyHealthcheck(), existingHealthcheck)

  ensureDeclarations(doc)
}

function namedVolumeSource(line: string) {
  const rest = line.endsWith(":ro") || line.endsWith(":rw") ? line.slice(0, -3) : line
  const sep = rest.lastIndexOf(":")
  if (sep <= 0) return null
  const source = rest.slice(0, sep)
  if (!source || source.startsWith("/") || source.startsWith(".") || source.includes("/"))
    return null
  return source
}

function ensureMap(doc: ComposeDoc, key: string): YAMLMap {
  const existing = asMap(doc.get(key))
  if (existing) return asBlock(existing)
  doc.set(key, blockNode(doc, {}))
  return asMap(doc.get(key)) ?? asBlock(new YAMLMap())
}

function referencedVolumes(doc: ComposeDoc): Set<string> {
  const volumes = new Set<string>()
  for (const name of listServices(doc)) {
    const node = asMap(serviceMap(doc)?.get(name))
    if (!node) continue
    const volNode = node.get("volumes")
    if (isSeq(volNode)) {
      for (const item of volNode.items) {
        const source = namedVolumeSource(volumeLine(item))
        if (source) volumes.add(source)
      }
    }
  }
  return volumes
}

function referencedNetworks(doc: ComposeDoc): Set<string> {
  const networks = new Set<string>()
  for (const name of listServices(doc)) {
    const node = asMap(serviceMap(doc)?.get(name))
    if (!node) continue
    for (const network of nameList(node.get("networks")).names) {
      if (network && network !== "default" && network !== "host" && network !== "none") {
        networks.add(network)
      }
    }
  }
  return networks
}

function syncTopLevelMap(doc: ComposeDoc, key: string, referenced: Set<string>) {
  if (!referenced.size) {
    doc.deleteIn([key])
    return
  }

  const current = doc.get(key)
  if (current != null && !isMap(current)) doc.deleteIn([key])

  const map = asMap(doc.get(key)) ?? ensureMap(doc, key)
  asBlock(map)
  for (const name of referenced) {
    if (map.get(name, true) == null) map.set(name, doc.createNode({}))
  }
  const unused = map.items.filter((pair) => !referenced.has(scalarString(pair.key)))
  for (const pair of unused) map.delete(pair.key)
}

function ensureDeclarations(doc: ComposeDoc) {
  syncTopLevelMap(doc, "volumes", referencedVolumes(doc))
  syncTopLevelMap(doc, "networks", referencedNetworks(doc))
}

export function addService(doc: ComposeDoc, name: string, values?: ComposeServiceValues) {
  if (!serviceMap(doc)) doc.set("services", blockNode(doc, {}))
  const taken = new Set(listServices(doc))
  let id = name.trim() || "service"
  if (taken.has(id)) {
    let index = 2
    while (taken.has(`${id}-${index}`)) index += 1
    id = `${id}-${index}`
  }
  writeService(doc, id, values ?? emptyService())
  return id
}

export function removeService(doc: ComposeDoc, name: string) {
  doc.deleteIn(["services", name])
  ensureDeclarations(doc)
}

export function renameService(doc: ComposeDoc, from: string, to: string) {
  const next = to.trim()
  if (!next || next === from) return from
  const services = serviceMap(doc)
  if (!services) return from
  if (services.get(next) != null) throw new Error(`Service ${next} already exists`)
  const value = services.get(from)
  if (value == null) return from
  const index = services.items.findIndex((pair) => scalarString(pair.key) === from)
  services.delete(from)
  const pair = doc.createPair(next, value)
  if (index >= 0) services.items.splice(index, 0, pair)
  else services.add(pair)
  return next
}

export function uniqueServiceName(doc: ComposeDoc, base = "service") {
  const taken = new Set(listServices(doc))
  if (!taken.has(base)) return base
  let index = 2
  while (taken.has(`${base}-${index}`)) index += 1
  return `${base}-${index}`
}
