import React from "react"
import ReactDOM from "react-dom/client"

import App from "@/App"
import { applyStoredSettings } from "@/lib/settings"

import "@/app/globals.css"

applyStoredSettings()

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
