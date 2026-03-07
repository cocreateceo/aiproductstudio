# AWS Cost Dashboard: Tag-Based Project Auto-Detection

**Date:** 2026-03-03
**Status:** Approved

## Problem

New AWS projects don't auto-appear in the cost dashboard. The system was designed for tag-based detection, but tags are only checked for EC2 and ELB. CloudFront, Lambda, S3, and ECS use only hardcoded regex patterns (`PROJECT_PATTERNS`), so new projects fall into the default "AI Product Studio" bucket.

Additionally, `PROJECT_PATTERNS` is duplicated 3 times and service-level costs (RDS, ElastiCache, etc.) are hardcoded to specific projects.

## Root Cause

- CloudFront, Lambda, S3, ECS loops call `inferProjectFromName()` instead of `resolveProject(tags, name)`
- No tag fetching for these resource types
- `PROJECT_PATTERNS` + helper functions duplicated in 3 handlers

## Solution: Zero-Cost Resource Tag Fetching

All resource tag APIs are free AWS management calls. No Cost Explorer changes needed ($0 extra cost).

### Changes to `aws-costs/index.mjs`

#### 1. DRY: Extract shared constants + helpers to module level

Move to top of file (after AWS client init):
- `PROJECT_PATTERNS`
- `getProjectFromTags(tags)`
- `inferProjectFromName(name)`
- `resolveProject(tags, name)`

Delete all 3 inline copies from:
- `handleAwsProjectCostsDynamic` (line ~1400)
- `handleAwsCostDailyByProject` (line ~1744)
- `handleAwsCostDashboardBatch` (line ~2632)

#### 2. Add SDK imports for tag APIs

```javascript
// CloudFront - add ListTagsForResourceCommand
import { CloudFrontClient, ListDistributionsCommand, ListTagsForResourceCommand as CFListTagsCommand } from '@aws-sdk/client-cloudfront';

// Lambda - add ListTagsCommand
import { LambdaClient, ListFunctionsCommand, ListTagsCommand as LambdaListTagsCommand } from '@aws-sdk/client-lambda';

// S3 - add GetBucketTaggingCommand
import { S3Client, ListBucketsCommand, ListObjectsV2Command, GetBucketLocationCommand, DeleteObjectCommand, GetObjectCommand, GetBucketTaggingCommand } from '@aws-sdk/client-s3';

// ECS - add ListTagsForResourceCommand
import { ECSClient, ListClustersCommand, ListServicesCommand, DescribeServicesCommand, ListTagsForResourceCommand as ECSListTagsCommand } from '@aws-sdk/client-ecs';
```

#### 3. Add tag fetching in resource loops

Fetch tags in parallel before project assignment:

| Resource | API Call | Tag Map Key |
|----------|----------|-------------|
| CloudFront | `CFListTagsCommand({ Resource: dist.ARN })` | dist.ARN |
| Lambda | `LambdaListTagsCommand({ Resource: fn.FunctionArn })` | fn.FunctionArn |
| S3 | `GetBucketTaggingCommand({ Bucket: name })` | bucket name |
| ECS | `ECSListTagsCommand({ resourceArn: arn })` | cluster ARN |

Then use `resolveProject(tagMap[id], name)` instead of `inferProjectFromName(name)`.

#### 4. Replace hardcoded serviceProjectFallback

For RDS, ElastiCache, ECR, CodeBuild — fetch tags from their list responses and use `resolveProject()`. Fall back to `inferProjectFromName()` only when tags are unavailable.

#### 5. Apply same fixes to all 3 handlers

- `handleAwsProjectCostsDynamic`
- `handleAwsCostDailyByProject`
- `handleAwsCostDashboardBatch`

### What doesn't change

- Frontend (HTML, JS, CSS) — no changes
- Cost Explorer queries — same calls, no extra $0.01
- EC2 + ELB tag reading — already correct
- `handleAwsProjectCosts` (static/legacy) — deprecated in favor of dynamic

### Testing

- Deploy to Lambda
- Verify existing projects still appear correctly
- Create a test resource with `project=TestProject` tag
- Confirm it appears as a new project in the dashboard
