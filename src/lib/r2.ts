import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const endpoint = process.env.R2_ENDPOINT;
export const bucketName = process.env.R2_BUCKET_NAME;

let s3Client: S3Client | null = null;

if (accountId && accessKeyId && secretAccessKey && endpoint) {
  s3Client = new S3Client({
    region: "auto",
    endpoint: endpoint,
    credentials: {
      accessKeyId: accessKeyId,
      secretAccessKey: secretAccessKey,
    },
  });
}

/**
 * Uploads a buffer or file to Cloudflare R2
 */
export async function uploadBufferToR2(key: string, buffer: Buffer, mimeType: string): Promise<string> {
  if (!s3Client) throw new Error("R2 Client is not configured");
  if (!bucketName) throw new Error("R2 Bucket Name is not configured");

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
  });

  await s3Client.send(command);
  return key;
}

/**
 * Generates a presigned URL for viewing/downloading an object
 * Expires in 5 minutes (300 seconds) by default
 */
export async function generatePresignedUrl(key: string, expiresIn = 300): Promise<string> {
  if (!s3Client) throw new Error("R2 Client is not configured");
  if (!bucketName) throw new Error("R2 Bucket Name is not configured");

  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  return await getSignedUrl(s3Client, command, { expiresIn });
}
