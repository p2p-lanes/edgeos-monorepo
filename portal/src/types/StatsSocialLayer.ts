export interface EventParticipant {
  profile: {
    id: string
    email: string | null
    nickname: string
    username: string
    image_url: string
  } | null
}
