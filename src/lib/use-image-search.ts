import { useEffect, useState } from "react"

import { api } from "@/lib/api"
import type { ImageSearchRow } from "@/lib/types"

export function useImageSearch(term: string, enabled: boolean) {
  const [results, setResults] = useState<ImageSearchRow[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) {
      if (term.length < 2) {
        setResults([])
        setSearchError(null)
        setSearching(false)
      }
      return
    }

    let cancelled = false
    const handle = window.setTimeout(() => {
      setSearching(true)
      setSearchError(null)
      void api
        .imageSearch(term)
        .then((rows) => {
          if (!cancelled) setResults(rows)
        })
        .catch((err) => {
          if (cancelled) return
          setResults([])
          setSearchError(String(err))
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 280)

    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [enabled, term])

  return { results, searching, searchError }
}
