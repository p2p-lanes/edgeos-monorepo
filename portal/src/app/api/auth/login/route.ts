import { handleAuthPost } from "@/lib/server/auth-handlers"

export const dynamic = "force-dynamic"
export const POST = (request: Request) => handleAuthPost(request, "login")
