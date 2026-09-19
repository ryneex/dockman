import type { ReactNode } from "react"

export function RowActions({ children }: { children: ReactNode }) {
  return (
    <td className="relative w-0 p-0">
      <div className="pointer-events-none absolute top-0 right-0 bottom-0 flex opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
        <div className="bg-hover shadow-hover flex h-full items-stretch pl-1 shadow-[-24px_0_20px_0] [&_button]:h-full [&_button]:w-11 [&_button]:rounded-none [&_button]:hover:bg-white/8">
          {children}
        </div>
      </div>
    </td>
  )
}
