import { AppRoutes } from "@/app/routes"
import { Sidebar } from "@/components/layouts/sidebar"
import { Titlebar } from "@/components/layouts/titlebar"

export function AppShell() {
  return (
    <div className="bg-canvas text-ink flex h-full flex-col">
      <Titlebar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <AppRoutes />
        </main>
      </div>
    </div>
  )
}
