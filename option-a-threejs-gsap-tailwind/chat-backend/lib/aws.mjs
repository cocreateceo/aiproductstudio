// Lazy S3 client singleton — extracted from index.mjs (Phase 1 refactor)
import { S3Client } from '@aws-sdk/client-s3';
import { S3_REGION } from './config.mjs';

let _s3;
/** Lazy, reused S3 client (one per warm container). */
export function getS3() {
  if (!_s3) _s3 = new S3Client({ region: S3_REGION });
  return _s3;
}
