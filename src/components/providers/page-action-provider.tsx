import type { LucideIcon } from "lucide-react"
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { useLocation } from "react-router-dom"
import { useLatest } from "@/lib/use-latest"

export type PageAction = {
  label: string
  onClick: () => void
  icon?: LucideIcon
}

type PageActionContextValue = {
  action: PageAction | null
  setAction: (action: PageAction | null) => void
}

const PageActionContext = createContext<PageActionContextValue | null>(null)

export function PageActionProvider({ children }: { children: ReactNode }) {
  const [action, setAction] = useState<PageAction | null>(null)
  const location = useLocation()

  useEffect(() => {
    setAction(null)
  }, [location.pathname])

  const value = useMemo(() => ({ action, setAction }), [action])
  return <PageActionContext.Provider value={value}>{children}</PageActionContext.Provider>
}

function usePageActionContext() {
  const ctx = useContext(PageActionContext)
  if (!ctx) throw new Error("usePageAction must be used within PageActionProvider")
  return ctx
}

export function usePageActionBar() {
  return usePageActionContext().action
}

export function usePageAction(label: string, onClick: () => void, icon?: LucideIcon) {
  const { setAction } = usePageActionContext()
  const onClickRef = useLatest(onClick)

  useEffect(() => {
    setAction({
      label,
      icon,
      onClick: () => onClickRef.current(),
    })
    return () => setAction(null)
  }, [icon, label, onClickRef, setAction])
}
