import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { useLocation } from "react-router-dom"

type FilterContextValue = {
  query: string
  setQuery: (value: string) => void
}

const FilterContext = createContext<FilterContextValue | null>(null)

export function FilterProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("")
  const location = useLocation()

  useEffect(() => {
    setQuery("")
  }, [location.pathname])

  const value = useMemo(() => ({ query, setQuery }), [query])
  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>
}

export function useFilter() {
  const ctx = useContext(FilterContext)
  if (!ctx) throw new Error("useFilter must be used within FilterProvider")
  return ctx
}
