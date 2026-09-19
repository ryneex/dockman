import { JsonView } from "@/components/common"
import { Drawer } from "@/components/ui/drawer"
import { Skeleton } from "@/components/ui/skeleton"

export function InspectDrawer({
  open,
  title,
  data,
  loading,
  onClose,
}: {
  open: boolean
  title: string
  data: unknown
  loading?: boolean
  onClose: () => void
}) {
  return (
    <Drawer open={open} title={title} onClose={onClose}>
      {loading ? (
        <div className="grid gap-2 p-4">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      ) : (
        <JsonView value={data} />
      )}
    </Drawer>
  )
}
