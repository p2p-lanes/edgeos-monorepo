import type { GroupMemberPublic } from "@/client"
import MemberItem from "./MemberItem"

interface MembersListProps {
  members: GroupMemberPublic[]
  onMemberUpdated?: () => void
  isAmbassadorGroup?: boolean
  isLeader?: boolean
}

const MembersList = ({
  members,
  onMemberUpdated,
  isAmbassadorGroup,
  isLeader,
}: MembersListProps) => {
  if (members.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500">
        No members found. Try a different search term or add a new member.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {members.map((member) => (
        <MemberItem
          key={member.id}
          member={member}
          onMemberUpdated={onMemberUpdated}
          isAmbassadorGroup={isAmbassadorGroup}
          isLeader={isLeader}
        />
      ))}
    </div>
  )
}

export default MembersList
