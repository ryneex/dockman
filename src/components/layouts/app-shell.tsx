import { useLocation } from "react-router-dom"

import { AppRoutes } from "@/app/routes"
import { Sidebar } from "@/components/layouts/sidebar"
import { Titlebar } from "@/components/layouts/titlebar"
import { Toolbar } from "@/components/layouts/toolbar"

export function AppShell() {
  const location = useLocation()

  return (
    <div className="bg-canvas text-ink flex h-full flex-col">
      <Titlebar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          {location.pathname !== "/" && location.pathname !== "/settings" ? <Toolbar /> : null}
          <div className="min-h-0 flex-1 overflow-auto">
            <AppRoutes />
          </div>
        </main>
      </div>
    </div>
  )
}
