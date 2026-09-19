import { Avatar, AvatarImage } from "@follow/components/ui/avatar/index.jsx"
import { LoadingCircle, LoadingWithIcon } from "@follow/components/ui/loading/index.jsx"

import { getLocalUrlIcon } from "~/lib/local-icons"

export const EntryContentLoading = (props: { icon?: string | null }) => {
  if (!props.icon) {
    return <LoadingWithIcon size="large" icon={<i className="i-mingcute-document-line" />} />
  }
  return (
    <div className="center mb-14 flex flex-col gap-4">
      <Avatar className="animate-pulse rounded-sm">
        <AvatarImage src={getLocalUrlIcon(props.icon).src} />
      </Avatar>
      <LoadingCircle size="medium" />
    </div>
  )
}
