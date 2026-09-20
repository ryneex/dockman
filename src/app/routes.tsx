import { Navigate, Route, Routes, useLocation } from "react-router-dom"

import {
  ContainerFilesTab,
  ContainerInspectTab,
  ContainerLogsTab,
  ContainerPage,
  ContainerTerminalTab,
  ContainersPage,
} from "@/features/containers"
import { DashboardPage } from "@/features/dashboard"
import { ImagesPage } from "@/features/images"
import { NetworksPage } from "@/features/networks"
import { SettingsPage } from "@/features/settings"
import { VolumesPage } from "@/features/volumes"

export function AppRoutes() {
  const location = useLocation()

  return (
    <Routes location={location}>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/containers" element={<ContainersPage />} />
      <Route path="/containers/:id" element={<ContainerPage />}>
        <Route index element={<ContainerLogsTab />} />
        <Route path="files" element={<ContainerFilesTab />} />
        <Route path="terminal" element={<ContainerTerminalTab />} />
        <Route path="inspect" element={<ContainerInspectTab />} />
      </Route>
      <Route path="/images" element={<ImagesPage />} />
      <Route path="/volumes" element={<VolumesPage />} />
      <Route path="/networks" element={<NetworksPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
