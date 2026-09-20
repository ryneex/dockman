import type { ReactNode } from "react"
import { HashRouter } from "react-router-dom"
import { Toaster } from "sonner"

import { FilterProvider } from "@/components/providers/filter-provider"
import { QueryProvider } from "@/components/providers/query-provider"
import { SettingsProvider } from "@/components/providers/settings-provider"
import { TooltipProvider } from "@/components/ui/tooltip"

export function RootProviders({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <SettingsProvider>
        <TooltipProvider>
          <HashRouter>
            <FilterProvider>
              {children}
              <Toaster
                theme="dark"
                position="bottom-right"
                toastOptions={{
                  style: {
                    background: "#12151C",
                    border: "1px solid rgba(255,255,255,0.06)",
                    color: "#E8ECF4",
                    fontSize: "0.875rem",
                  },
                }}
              />
            </FilterProvider>
          </HashRouter>
        </TooltipProvider>
      </SettingsProvider>
    </QueryProvider>
  )
}
