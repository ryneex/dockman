import { Box, Container, HardDrive, Layers, LayoutDashboard, Network, Settings } from "lucide-react"
import { NavLink } from "react-router-dom"

import { cn } from "@/lib/utils"

const links = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/containers", label: "Containers", icon: Container },
  { to: "/images", label: "Images", icon: Box },
  { to: "/volumes", label: "Volumes", icon: HardDrive },
  { to: "/networks", label: "Networks", icon: Network },
  { to: "/stacks", label: "Compose", icon: Layers },
]

function NavItem({
  to,
  label,
  icon: Icon,
  end,
}: {
  to: string
  label: string
  icon: typeof Settings
  end?: boolean
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "text-muted hover:bg-hover hover:text-ink relative flex items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 transition-colors",
          isActive && "bg-accent-glow text-ink",
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive ? (
            <span className="bg-accent absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full" />
          ) : null}
          <Icon className="size-4" strokeWidth={1.5} />
          {label}
        </>
      )}
    </NavLink>
  )
}

export function Sidebar() {
  return (
    <aside className="border-border bg-elevated/70 flex w-56 shrink-0 flex-col border-r">
      <div className="px-4 py-4">
        <p className="tracking-[-0.03em]">Dockman</p>
        <p className="text-faint text-sm">Local Docker engine</p>
      </div>
      <nav className="flex flex-col gap-0.5 px-2">
        {links.map((link) => (
          <NavItem key={link.to} {...link} />
        ))}
      </nav>
      <nav className="mt-auto px-2 pb-3">
        <NavItem to="/settings" label="Settings" icon={Settings} />
      </nav>
    </aside>
  )
}
