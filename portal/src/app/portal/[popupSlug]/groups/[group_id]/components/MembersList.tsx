import type { GroupMemberPublic } from "@/client"
import MemberItem from "./MemberItem"

interface MembersListProps {
  members: GroupMemberPublic[]
  onMemberUpdated?: () => void
  /** Whether the viewer leads the group and may edit or remove members. */
  canManageMembers?: boolean
}

const MembersList = ({
  members,
  onMemberUpdated,
  canManageMembers,
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
          canManageMembers={canManageMembers}
        />
      ))}
    </div>
  )
}

export default MembersList
