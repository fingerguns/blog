import { AwsClient } from "aws4fetch";

/**
 * Presigned PUT URL for direct browser → R2 upload (S3-compatible API).
 * Client must send the same Content-Type header used when signing.
 */
export async function createR2PresignedPutUrl({
  accountId,
  bucket,
  key,
  accessKeyId,
  secretAccessKey,
  mimeType,
  expiresSec = 900,
}) {
  const url = new URL(`https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key}`);
  url.searchParams.set("X-Amz-Expires", String(expiresSec));

  const client = new AwsClient({
    accessKeyId,
    secretAccessKey,
  });

  const signed = await client.sign(
    new Request(url, {
      method: "PUT",
      headers: {
        "Content-Type": mimeType,
      },
    }),
    {
      aws: { signQuery: true },
    }
  );

  return signed.url;
}
