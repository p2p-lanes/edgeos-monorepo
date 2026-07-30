"use client"

import { useParams } from "next/navigation"
import { useEffect, useState } from "react"
import Pagination from "@/components/common/Pagination"
import { Loader } from "@/components/ui/Loader"
import useGetGroup from "@/hooks/useGetGroup"
import MembersList from "./components/MembersList"
import SearchBar from "./components/SearchBar"
import TeamHeader from "./components/TeamHeader"

// Main component for the groups page
const GroupPage = () => {
  const { group_id } = useParams() as { group_id: string }
  const { group, loading, error, refetch } = useGetGroup(group_id)

  const [searchTerm, setSearchTerm] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const membersPerPage = 10

  // Filter members based on the search term (name or email)
  const filteredMembers = group?.members
    ? group.members.filter((member) => {
        const term = searchTerm.toLowerCase().trim()
        if (!term) return true

        // Search across first name, last name, and email
        return (
          member.first_name?.toLowerCase().includes(term) ||
          member.last_name?.toLowerCase().includes(term) ||
          member.email?.toLowerCase().includes(term)
        )
      })
    : []

  // Pagination logic
  const indexOfLastMember = currentPage * membersPerPage
  const indexOfFirstMember = indexOfLastMember - membersPerPage
  const currentMembers = filteredMembers.slice(
    indexOfFirstMember,
    indexOfLastMember,
  )
  const totalPages = Math.ceil(filteredMembers.length / membersPerPage)

  // Handle page changes
  const handlePageChange = (page: number) => {
    setCurrentPage(page)
  }

  // Reset to the first page when the search term changes
  useEffect(() => {
    setCurrentPage(1)
  }, [])

  if (loading) {
    return (
      <div className="flex justify-center items-center h-[500px]">
        <Loader />
      </div>
    )
  }

  if (error || !group) {
    return (
      <div className="max-w-[820px] mx-auto py-8 text-center">
        <h2 className="text-xl font-semibold text-red-600 mb-2">Error</h2>
        <p className="text-gray-600">{error || "No group found"}</p>
      </div>
    )
  }

  return (
    <div className=" mx-auto space-y-6 max-w-5xl p-6">
      <TeamHeader
        totalMembers={group.members?.length ?? 0}
        group={group}
        onMemberAdded={() => refetch()}
        onGroupUpdated={() => refetch()}
      />

      <SearchBar searchTerm={searchTerm} setSearchTerm={setSearchTerm} />

      {filteredMembers.length === 0 ? (
        <div className="p-8 text-center bg-white rounded-md border">
          <p className="text-gray-500">No members found</p>
        </div>
      ) : (
        <>
          <MembersList
            members={currentMembers}
            onMemberUpdated={refetch}
            isAmbassadorGroup={group.is_ambassador_group}
          />

          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={handlePageChange}
          />
        </>
      )}
    </div>
  )
}

export default GroupPage
