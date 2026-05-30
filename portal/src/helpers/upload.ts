import { UploadsService } from "@/client"

/**
 * Upload a file to S3 using the backend presigned URL flow.
 * Step 1: request a presigned PUT URL from the backend.
 * Step 2: upload the file directly to S3.
 * Returns the public URL of the uploaded file.
 */
const uploadFileToS3 = async (file: File): Promise<string> => {
  const { upload_url, public_url } =
    await UploadsService.getPresignedUploadUrlPortal({
      requestBody: {
        filename: file.name,
        content_type: file.type,
      },
    })

  const response = await fetch(upload_url, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  })

  if (!response.ok) {
    throw new Error(`Failed to upload file (status ${response.status})`)
  }

  return public_url
}

export default uploadFileToS3
