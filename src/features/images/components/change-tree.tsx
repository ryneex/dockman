import { ChevronRight, File, Folder } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { formatBytes } from "@/lib/format"
import type { FileKind, LayerFile } from "@/lib/types"
import { cn } from "@/lib/utils"

type TreeKind = FileKind | "mixed"

type TreeNode = {
  name: string
  path: string
  kind: TreeKind
  size: number
  children: TreeNode[]
}

const kindClass: Record<TreeKind, string> = {
  added: "text-running",
  modified: "text-paused",
  deleted: "text-exited",
  unchanged: "text-faint",
  mixed: "text-muted",
}

function buildChangeTree(changes: LayerFile[]): TreeNode[] {
  type Draft = {
    name: string
    path: string
    kind?: FileKind
    size: number
    children: Map<string, Draft>
  }

  const root: Draft = { name: "", path: "", size: 0, children: new Map() }

  for (const change of changes) {
    const parts = change.path
      .replace(/^\.?\//, "")
      .split("/")
      .filter(Boolean)
    if (!parts.length) continue
    let current = root
    let acc = ""
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index]!
      acc = acc ? `${acc}/${part}` : part
      let child = current.children.get(part)
      if (!child) {
        child = { name: part, path: acc, size: 0, children: new Map() }
        current.children.set(part, child)
      }
      current = child
      if (index === parts.length - 1) {
        current.kind = change.kind
        current.size = change.size
      }
    }
  }

  function freeze(node: Draft): TreeNode {
    const children = [...node.children.values()].map(freeze).sort((left, right) => {
      const leftDir = left.children.length > 0
      const rightDir = right.children.length > 0
      if (leftDir !== rightDir) return leftDir ? -1 : 1
      return left.name.localeCompare(right.name)
    })
    const kind = node.kind ?? inheritKind(children)
    const size = children.length ? children.reduce((sum, child) => sum + child.size, 0) : node.size
    return { name: node.name, path: node.path, kind, size, children }
  }

  return freeze(root).children
}

function inheritKind(children: TreeNode[]): TreeKind {
  if (!children.length) return "unchanged"
  const first = children[0]!.kind
  return children.every((child) => child.kind === first) ? first : "mixed"
}

function matches(node: TreeNode, needle: string) {
  return node.name.toLowerCase().includes(needle) || node.path.toLowerCase().includes(needle)
}

function visible(node: TreeNode, needle: string): boolean {
  if (!needle || matches(node, needle)) return true
  return node.children.some((child) => visible(child, needle))
}

function nodeFullPath(path: string) {
  return path.startsWith("/") ? path : `/${path}`
}

function workingDirAncestors(workingDir: string) {
  const parts = workingDir
    .replace(/^\.?\//, "")
    .split("/")
    .filter(Boolean)
  const paths = new Set<string>()
  let acc = ""
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part
    paths.add(acc)
  }
  return paths
}

export function ChangeTree({
  changes,
  filter,
  selectedPath,
  onSelectFile,
  workingDir = "/",
}: {
  changes: LayerFile[]
  filter: string
  selectedPath?: string | null
  onSelectFile?: (path: string, kind: FileKind) => void
  workingDir?: string
}) {
  const tree = useMemo(() => buildChangeTree(changes), [changes])
  const needle = filter.trim().toLowerCase()
  const defaultOpen = useMemo(() => workingDirAncestors(workingDir), [workingDir])
  const [open, setOpen] = useState<Set<string>>(() => new Set(defaultOpen))

  useEffect(() => {
    setOpen(new Set(defaultOpen))
  }, [tree, defaultOpen])

  function toggle(path: string) {
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const rows = tree.filter((node) => visible(node, needle))
  if (!rows.length) {
    return <p className="text-faint p-5">No paths match this filter.</p>
  }

  return (
    <ul className="min-h-0 flex-1 overflow-auto py-1">
      {rows.map((node) => (
        <TreeNodeRow
          key={node.path}
          node={node}
          depth={0}
          needle={needle}
          open={open}
          selectedPath={selectedPath}
          onToggle={toggle}
          onSelectFile={onSelectFile}
        />
      ))}
    </ul>
  )
}

function TreeNodeRow({
  node,
  depth,
  needle,
  open,
  selectedPath,
  onToggle,
  onSelectFile,
}: {
  node: TreeNode
  depth: number
  needle: string
  open: Set<string>
  selectedPath?: string | null
  onToggle: (path: string) => void
  onSelectFile?: (path: string, kind: FileKind) => void
}) {
  const isDir = node.children.length > 0
  const expanded = isDir && (Boolean(needle) || open.has(node.path))
  const Icon = isDir ? Folder : File
  const kids = expanded ? node.children.filter((child) => visible(child, needle)) : []
  const fullPath = nodeFullPath(node.path)
  const selected = !isDir && selectedPath === fullPath
  const fileKind = node.kind === "mixed" ? "unchanged" : node.kind

  return (
    <li>
      <div
        role={isDir ? undefined : "button"}
        tabIndex={isDir ? undefined : 0}
        className={cn(
          "hover:bg-hover flex min-w-0 items-center gap-2 py-1.5 pr-4",
          !isDir && "cursor-pointer",
          selected && "bg-accent/10",
        )}
        style={{ paddingLeft: 12 + depth * 14 }}
        onClick={isDir ? undefined : () => onSelectFile?.(fullPath, fileKind)}
        onKeyDown={
          isDir
            ? undefined
            : (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  onSelectFile?.(fullPath, fileKind)
                }
              }
        }
      >
        {isDir ? (
          <button
            type="button"
            className="text-muted hover:text-ink inline-flex size-4 shrink-0 items-center justify-center"
            aria-label={expanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
            onClick={() => onToggle(node.path)}
          >
            <ChevronRight
              size={14}
              className={cn("transition-transform", expanded && "rotate-90")}
            />
          </button>
        ) : (
          <span className="inline-block size-4 shrink-0" />
        )}
        <Icon size={14} className="text-muted shrink-0" />
        <span className="min-w-0 flex-1 truncate font-mono text-sm" title={fullPath}>
          {node.name}
        </span>
        {node.kind === "unchanged" ? (
          <span className="w-14 shrink-0" />
        ) : (
          <span className={cn("w-14 shrink-0 text-xs", kindClass[node.kind])}>{node.kind}</span>
        )}
        <span className="text-faint w-16 shrink-0 text-right text-sm tabular-nums">
          {formatBytes(node.size)}
        </span>
      </div>
      {kids.length ? (
        <ul>
          {kids.map((child) => (
            <TreeNodeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              needle={needle}
              open={open}
              selectedPath={selectedPath}
              onToggle={onToggle}
              onSelectFile={onSelectFile}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}
