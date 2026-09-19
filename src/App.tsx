import { AppShell } from "@/components/layouts"
import { RootProviders } from "@/components/providers"

export default function App() {
  return (
    <RootProviders>
      <AppShell />
    </RootProviders>
  )
}
