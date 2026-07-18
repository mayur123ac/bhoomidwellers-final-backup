import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
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

export async function deleteObjectFromR2(key: string): Promise<void> {
  if (!s3Client) throw new Error("R2 Client is not configured");
  if (!bucketName) throw new Error("R2 Bucket Name is not configured");

  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
      })
    );
  } catch (error: any) {
    if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) {
      console.warn(`[R2] Object already missing: ${key}`);
      return;
    }
    throw error;
  }
}

export async function listR2KeysByPrefix(prefix: string): Promise<string[]> {
  if (!s3Client) throw new Error("R2 Client is not configured");
  if (!bucketName) throw new Error("R2 Bucket Name is not configured");

  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const result = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );

    for (const object of result.Contents || []) {
      if (object.Key) keys.push(object.Key);
    }

    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}
