# AWS Cost Tag-Based Auto-Detection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the AWS cost dashboard so new projects auto-appear via AWS resource tags instead of requiring hardcoded regex patterns.

**Architecture:** Extract shared project-resolution logic (PROJECT_PATTERNS + tag readers + resolveProject) to module level. Add free tag-fetching API calls for CloudFront, Lambda, S3, and ECS. Replace all `inferProjectFromName()` calls with `resolveProject(tags, name)` across 3 handlers. Remove hardcoded service-to-project fallbacks.

**Tech Stack:** Node.js ESM, AWS SDK v3 (CloudFront, Lambda, S3, ECS tag APIs)

---

### Task 1: Add tag API imports to SDK import blocks

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/chat-backend/aws-costs/index.mjs:33-67`

**Step 1: Add GetBucketTaggingCommand to S3 import**

Change the S3 import block (lines 33-39) to:
```javascript
import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  GetBucketLocationCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  GetBucketTaggingCommand
} from '@aws-sdk/client-s3';
```

**Step 2: Add ListTagsForResourceCommand to CloudFront import**

Change the CloudFront import block (lines 41-44) to:
```javascript
import {
  CloudFrontClient,
  ListDistributionsCommand,
  ListTagsForResourceCommand as CFListTagsCommand
} from '@aws-sdk/client-cloudfront';
```

**Step 3: Add ListTagsCommand to Lambda import**

Change the Lambda import block (lines 46-49) to:
```javascript
import {
  LambdaClient,
  ListFunctionsCommand,
  ListTagsCommand as LambdaListTagsCommand
} from '@aws-sdk/client-lambda';
```

**Step 4: Add ListTagsForResourceCommand to ECS import**

Change the ECS import block (lines 62-67) to:
```javascript
import {
  ECSClient,
  ListClustersCommand,
  ListServicesCommand,
  DescribeServicesCommand,
  ListTagsForResourceCommand as ECSListTagsCommand
} from '@aws-sdk/client-ecs';
```

**Step 5: Commit**

```bash
git add option-a-threejs-gsap-tailwind/chat-backend/aws-costs/index.mjs
git commit -m "feat: add tag API imports for CloudFront, Lambda, S3, ECS"
```

---

### Task 2: Extract shared PROJECT_PATTERNS and resolver functions to module level

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/chat-backend/aws-costs/index.mjs`

**Step 1: Add shared constants and helpers after line 84 (after client initialization)**

Insert after the `const ctClient = ...` line (line 84), before the `// Helpers` comment (line 86):

```javascript
// ---------------------------------------------------------------------------
// Shared Project Resolution
// ---------------------------------------------------------------------------

/**
 * Regex patterns for inferring project from resource names.
 * Used as fallback when AWS resource tags are not set.
 * New projects should use AWS resource tags (project=<name>) instead.
 */
const PROJECT_PATTERNS = {
  'Career Builder': [/^careers?[-_]/i, /careers-production/i],
  'CoCreate AI':    [/^cocreate[-_]ai/i],
  'Tmux Builder':   [/^tmux[-_]/i, /tmux-builder/i],
  'Vedic Astro':    [/^vedic[-_]?astro/i, /^vedic[-_]/i],
  'AI Product Studio': [/^cocreateidea/i, /^cocreate[-_]app/i, /ai[-_]product[-_]studio/i, /^cocreate[-_]applications/i]
};

/** Extract project name from AWS resource tags (primary method). */
function getProjectFromTags(tags) {
  if (!tags) return null;
  if (Array.isArray(tags)) {
    for (const key of ['project', 'Project', 'application', 'Application', 'app']) {
      const tag = tags.find(t => t.Key === key);
      if (tag && tag.Value) return tag.Value;
    }
    return null;
  }
  // Object format (already parsed, e.g. EC2 allTags)
  return tags.project || tags.Project || tags.application || tags.Application || tags.app || null;
}

/** Fallback: infer project from resource name using regex patterns. */
function inferProjectFromName(resourceName) {
  const name = (resourceName || '').toLowerCase();
  for (const [proj, patterns] of Object.entries(PROJECT_PATTERNS)) {
    for (const pat of patterns) {
      if (pat.test(name)) return proj;
    }
  }
  return 'AI Product Studio'; // default
}

/** Unified resolver: tags first, then name-based fallback. */
function resolveProject(tags, resourceName) {
  return getProjectFromTags(tags) || inferProjectFromName(resourceName);
}

/**
 * Fetch tags for a list of resources in parallel with error tolerance.
 * Returns a Map of resourceId → { key: value } tag objects.
 */
async function fetchTagsParallel(resources, fetchFn) {
  const tagMap = {};
  const results = await Promise.allSettled(
    resources.map(async (r) => {
      try {
        const tags = await fetchFn(r);
        return { id: r.id, tags };
      } catch {
        return { id: r.id, tags: null };
      }
    })
  );
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.tags) {
      tagMap[result.value.id] = result.value.tags;
    }
  }
  return tagMap;
}

/** Fetch CloudFront distribution tags. Returns { key: value } object. */
async function fetchCFTags(distARN) {
  try {
    const result = await cfClient.send(new CFListTagsCommand({ Resource: distARN }));
    const tags = {};
    for (const t of result.Tags?.Items || []) tags[t.Key] = t.Value;
    return tags;
  } catch { return null; }
}

/** Fetch Lambda function tags. Returns { key: value } object. */
async function fetchLambdaTags(functionArn) {
  try {
    const result = await lambdaClient.send(new LambdaListTagsCommand({ Resource: functionArn }));
    return result.Tags || null; // Lambda returns { Key: Value } directly
  } catch { return null; }
}

/** Fetch S3 bucket tags. Returns { key: value } object. */
async function fetchS3BucketTags(bucketName) {
  try {
    const result = await s3Client.send(new GetBucketTaggingCommand({ Bucket: bucketName }));
    const tags = {};
    for (const t of result.TagSet || []) tags[t.Key] = t.Value;
    return tags;
  } catch { return null; } // NoSuchTagConfiguration is expected for untagged buckets
}

/** Fetch ECS cluster tags. Returns { key: value } object. */
async function fetchECSTags(resourceArn) {
  try {
    const result = await ecsClient.send(new ECSListTagsCommand({ resourceArn }));
    const tags = {};
    for (const t of result.tags || []) tags[t.key] = t.value;
    return tags;
  } catch { return null; }
}
```

**Step 2: Delete the inline `PROJECT_PATTERNS` + helpers from `handleAwsProjectCostsDynamic` (lines ~1399-1436)**

Remove this block (inside `handleAwsProjectCostsDynamic`):
```
    // ── Project definitions ──
    const PROJECT_PATTERNS = { ... };
    function getProjectFromTags(tags) { ... }
    function inferProjectFromName(resourceName) { ... }
    function resolveProject(tags, resourceName) { ... }
```

**Step 3: Delete the inline `PROJECT_PATTERNS` + `inferProjectFromName` from `handleAwsCostDailyByProject` (lines ~1744-1759)**

Remove:
```
    const PROJECT_PATTERNS = { ... };
    function inferProjectFromName(resourceName) { ... }
```

**Step 4: Delete the inline `PROJECT_PATTERNS` + batch helpers from `handleAwsCostDashboardBatch` (lines ~2632-2663)**

Remove:
```
    const PROJECT_PATTERNS = { ... };
    function batchGetProjectFromTags(tags) { ... }
    function batchInferProject(resourceName) { ... }
    function batchResolveProject(tags, resourceName) { ... }
```

Replace all `batchResolveProject(` calls with `resolveProject(` and all `batchInferProject(` calls with `inferProjectFromName(`.

**Step 5: Commit**

```bash
git add option-a-threejs-gsap-tailwind/chat-backend/aws-costs/index.mjs
git commit -m "refactor: extract shared PROJECT_PATTERNS and resolvers to module level"
```

---

### Task 3: Add tag fetching to `handleAwsProjectCostsDynamic`

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/chat-backend/aws-costs/index.mjs` — the `handleAwsProjectCostsDynamic` function

**Step 1: Add parallel tag fetching after ELB tag fetching (after line ~1397)**

After the existing ELB tag block and before the project loop sections, add:

```javascript
    // Fetch tags for CloudFront, Lambda, S3, ECS in parallel (free API calls)
    const cfDistributions = distributions.DistributionList?.Items || [];
    const lambdaFns = lambdaFunctions.Functions || [];
    const s3Buckets = buckets.Buckets || [];
    const ecsArns = ecsClusters.clusterArns || [];

    const [cfTagMap, lambdaTagMap, s3TagMap, ecsTagMap] = await Promise.all([
      // CloudFront tags
      Promise.all(cfDistributions.map(async (dist) => {
        const tags = await fetchCFTags(dist.ARN);
        return [dist.ARN, tags];
      })).then(entries => Object.fromEntries(entries.filter(([, t]) => t))),
      // Lambda tags
      Promise.all(lambdaFns.map(async (fn) => {
        const tags = await fetchLambdaTags(fn.FunctionArn);
        return [fn.FunctionArn, tags];
      })).then(entries => Object.fromEntries(entries.filter(([, t]) => t))),
      // S3 tags
      Promise.all(s3Buckets.map(async (b) => {
        const tags = await fetchS3BucketTags(b.Name);
        return [b.Name, tags];
      })).then(entries => Object.fromEntries(entries.filter(([, t]) => t))),
      // ECS tags
      Promise.all(ecsArns.map(async (arn) => {
        const tags = await fetchECSTags(arn);
        return [arn, tags];
      })).then(entries => Object.fromEntries(entries.filter(([, t]) => t)))
    ]);
```

**Step 2: Update CloudFront project resolution (lines ~1492-1502)**

Replace the CloudFront loop's project inference. Change:
```javascript
      const projName = inferProjectFromName(originDomain) !== 'AI Product Studio'
        ? inferProjectFromName(originDomain)
        : inferProjectFromName(alias || dist.DomainName);
```
To:
```javascript
      const cfTags = cfTagMap[dist.ARN] || null;
      const projName = getProjectFromTags(cfTags)
        || (inferProjectFromName(originDomain) !== 'AI Product Studio'
            ? inferProjectFromName(originDomain)
            : inferProjectFromName(alias || dist.DomainName));
```

**Step 3: Update Lambda project resolution (lines ~1509-1512)**

Change:
```javascript
      const projName = inferProjectFromName(fn.FunctionName);
```
To:
```javascript
      const fnTags = lambdaTagMap[fn.FunctionArn] || null;
      const projName = resolveProject(fnTags, fn.FunctionName);
```

**Step 4: Update S3 project resolution (lines ~1528-1531)**

Change:
```javascript
      const projName = inferProjectFromName(b.Name);
```
To:
```javascript
      const bTags = s3TagMap[b.Name] || null;
      const projName = resolveProject(bTags, b.Name);
```

**Step 5: Update ECS project resolution (lines ~1544-1545)**

Change:
```javascript
      const projName = inferProjectFromName(clusterName);
```
To:
```javascript
      const clusterTags = ecsTagMap[arn] || null;
      const projName = resolveProject(clusterTags, clusterName);
```

**Step 6: Replace hardcoded `serviceProjectFallback` (lines ~1579-1593)**

Replace the hardcoded service→project mapping with tag-based resolution. Change:
```javascript
    const serviceProjectFallback = {
      ...(hasRds ? { 'Amazon Relational Database Service': 'Career Builder' } : {}),
      ...(hasEcache ? { 'Amazon ElastiCache': 'Career Builder' } : {}),
      ...(hasEcr ? { 'Amazon EC2 Container Registry (ECR)': 'Career Builder' } : {}),
      ...(hasCb ? { 'CodeBuild': 'Career Builder' } : {}),
      'AWS Secrets Manager': 'Career Builder',
      'Amazon Simple Email Service': 'Vedic Astro'
    };
```
To:
```javascript
    // Service-level fallback: infer project from service name for services
    // where resource-level tag reading is not yet implemented.
    // These use inferProjectFromName as last resort — tag the actual resources for accuracy.
    const serviceProjectFallback = {
      ...(hasRds ? { 'Amazon Relational Database Service': inferProjectFromName('rds-database') } : {}),
      ...(hasEcache ? { 'Amazon ElastiCache': inferProjectFromName('elasticache-cluster') } : {}),
      ...(hasEcr ? { 'Amazon EC2 Container Registry (ECR)': inferProjectFromName('ecr-registry') } : {}),
      ...(hasCb ? { 'CodeBuild': inferProjectFromName('codebuild-project') } : {}),
      'AWS Secrets Manager': inferProjectFromName('secrets-manager'),
      'Amazon Simple Email Service': inferProjectFromName('ses-email')
    };
```

> **Note:** These will all resolve to 'AI Product Studio' (default) since the names don't match any pattern. This is acceptable — the real fix is that once you tag the actual RDS/ElastiCache resources, the tag-based system in the batch handler will pick them up. For now this removes the incorrect hardcoded "Career Builder" assumption.

> **Actually, better approach:** Keep the hardcoded fallback for now (it's correct for the current account state) but add a comment that it will be replaced when those services get tag support. The immediate value is fixing CloudFront/Lambda/S3/ECS. So **leave `serviceProjectFallback` as-is** with only a comment update.

**Step 7: Commit**

```bash
git add option-a-threejs-gsap-tailwind/chat-backend/aws-costs/index.mjs
git commit -m "feat: add tag-based project detection for CloudFront, Lambda, S3, ECS in dynamic handler"
```

---

### Task 4: Add tag fetching to `handleAwsCostDailyByProject`

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/chat-backend/aws-costs/index.mjs` — the `handleAwsCostDailyByProject` function (lines ~1720-1915)

**Step 1: Add parallel tag fetching after resource fetching (after the Promise.all on line ~1741)**

After the existing `Promise.all` that fetches `[costResult, ec2Instances, lambdaFunctions, buckets, distributions]`, add:

```javascript
    // Fetch tags for Lambda, S3, CloudFront in parallel (free API calls)
    const lambdaFns = lambdaFunctions.Functions || [];
    const s3BucketList = buckets.Buckets || [];
    const cfDists = distributions.DistributionList?.Items || [];

    const [lambdaTagMap, s3TagMap, cfTagMap] = await Promise.all([
      Promise.all(lambdaFns.map(async (fn) => {
        const tags = await fetchLambdaTags(fn.FunctionArn);
        return [fn.FunctionArn, tags];
      })).then(entries => Object.fromEntries(entries.filter(([, t]) => t))),
      Promise.all(s3BucketList.map(async (b) => {
        const tags = await fetchS3BucketTags(b.Name);
        return [b.Name, tags];
      })).then(entries => Object.fromEntries(entries.filter(([, t]) => t))),
      Promise.all(cfDists.map(async (dist) => {
        const tags = await fetchCFTags(dist.ARN);
        return [dist.ARN, tags];
      })).then(entries => Object.fromEntries(entries.filter(([, t]) => t)))
    ]);
```

**Step 2: Update Lambda mapping (lines ~1774-1780)**

Change:
```javascript
    for (const fn of (lambdaFunctions.Functions || [])) {
      const proj = inferProjectFromName(fn.FunctionName);
```
To:
```javascript
    for (const fn of lambdaFns) {
      const fnTags = lambdaTagMap[fn.FunctionArn] || null;
      const proj = resolveProject(fnTags, fn.FunctionName);
```

**Step 3: Update S3 mapping (lines ~1785-1789)**

Change:
```javascript
    for (const b of (buckets.Buckets || [])) {
      const proj = inferProjectFromName(b.Name);
```
To:
```javascript
    for (const b of s3BucketList) {
      const bTags = s3TagMap[b.Name] || null;
      const proj = resolveProject(bTags, b.Name);
```

**Step 4: Update CloudFront mapping (lines ~1794-1801)**

Change:
```javascript
    for (const dist of (distributions.DistributionList?.Items || [])) {
      const originDomain = dist.Origins?.Items?.[0]?.DomainName || '';
      const alias = dist.Aliases?.Items?.[0] || '';
      const proj = inferProjectFromName(originDomain) !== 'AI Product Studio'
        ? inferProjectFromName(originDomain) : inferProjectFromName(alias || dist.DomainName);
```
To:
```javascript
    for (const dist of cfDists) {
      const originDomain = dist.Origins?.Items?.[0]?.DomainName || '';
      const alias = dist.Aliases?.Items?.[0] || '';
      const cfTags = cfTagMap[dist.ARN] || null;
      const proj = getProjectFromTags(cfTags)
        || (inferProjectFromName(originDomain) !== 'AI Product Studio'
            ? inferProjectFromName(originDomain) : inferProjectFromName(alias || dist.DomainName));
```

**Step 5: Update `fixedServiceMap` — replace hardcoded ELB mapping (line ~1865)**

Change:
```javascript
      if (serviceName === 'Amazon Elastic Load Balancing') {
        return { 'Career Builder': cost }; // Only Career Builder uses ELB
      }
```
To:
```javascript
      if (serviceName === 'Amazon Elastic Load Balancing') {
        // TODO: fetch ELB tags in this handler too; for now keep Career Builder default
        return { 'Career Builder': cost };
      }
```

**Step 6: Commit**

```bash
git add option-a-threejs-gsap-tailwind/chat-backend/aws-costs/index.mjs
git commit -m "feat: add tag-based project detection for Lambda, S3, CloudFront in daily-by-project handler"
```

---

### Task 5: Add tag fetching to `handleAwsCostDashboardBatch`

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/chat-backend/aws-costs/index.mjs` — the batch handler's Section 6 (lines ~2666-2833)

**Step 1: Add parallel tag fetching after ELB tag block (after line ~2698)**

After the existing ELB tag block and before the `projects = {}` setup, add:

```javascript
      // Fetch tags for CloudFront, Lambda, S3, ECS in parallel (free API calls)
      const cfDistributions = distributions.DistributionList?.Items || [];
      const lambdaFns = lambdaFunctions.Functions || [];
      const s3BucketList = buckets.Buckets || [];
      const ecsClusterArns = ecsClusters.clusterArns || [];

      const [cfTagMap, lambdaTagMap, s3TagMap, ecsTagMap] = await Promise.all([
        Promise.all(cfDistributions.map(async (dist) => {
          const tags = await fetchCFTags(dist.ARN);
          return [dist.ARN, tags];
        })).then(entries => Object.fromEntries(entries.filter(([, t]) => t))),
        Promise.all(lambdaFns.map(async (fn) => {
          const tags = await fetchLambdaTags(fn.FunctionArn);
          return [fn.FunctionArn, tags];
        })).then(entries => Object.fromEntries(entries.filter(([, t]) => t))),
        Promise.all(s3BucketList.map(async (b) => {
          const tags = await fetchS3BucketTags(b.Name);
          return [b.Name, tags];
        })).then(entries => Object.fromEntries(entries.filter(([, t]) => t))),
        Promise.all(ecsClusterArns.map(async (arn) => {
          const tags = await fetchECSTags(arn);
          return [arn, tags];
        })).then(entries => Object.fromEntries(entries.filter(([, t]) => t)))
      ]);
```

**Step 2: Update CloudFront resolution (lines ~2748-2749)**

Change:
```javascript
        const projName = batchInferProject(originDomain) !== 'AI Product Studio'
          ? batchInferProject(originDomain) : batchInferProject(alias || dist.DomainName);
```
To:
```javascript
        const cfTags = cfTagMap[dist.ARN] || null;
        const projName = getProjectFromTags(cfTags)
          || (inferProjectFromName(originDomain) !== 'AI Product Studio'
              ? inferProjectFromName(originDomain) : inferProjectFromName(alias || dist.DomainName));
```

**Step 3: Update Lambda resolution (line ~2759)**

Change:
```javascript
        const projName = batchInferProject(fn.FunctionName);
```
To:
```javascript
        const fnTags = lambdaTagMap[fn.FunctionArn] || null;
        const projName = resolveProject(fnTags, fn.FunctionName);
```

**Step 4: Update S3 resolution (line ~2776)**

Change:
```javascript
        const projName = batchInferProject(b.Name);
```
To:
```javascript
        const bTags = s3TagMap[b.Name] || null;
        const projName = resolveProject(bTags, b.Name);
```

**Step 5: Update ECS resolution (line ~2791)**

Change:
```javascript
        const projName = batchInferProject(clusterName);
```
To:
```javascript
        const clusterTags = ecsTagMap[arn] || null;
        const projName = resolveProject(clusterTags, clusterName);
```

**Step 6: Replace remaining `batchResolveProject` with `resolveProject` (ELB line ~2810)**

Change:
```javascript
        addResource(batchResolveProject(elbTags, elb.LoadBalancerName), ...
```
To:
```javascript
        addResource(resolveProject(elbTags, elb.LoadBalancerName), ...
```

**Step 7: Commit**

```bash
git add option-a-threejs-gsap-tailwind/chat-backend/aws-costs/index.mjs
git commit -m "feat: add tag-based project detection for all resources in batch handler"
```

---

### Task 6: Verify and clean up

**Files:**
- Modify: `option-a-threejs-gsap-tailwind/chat-backend/aws-costs/index.mjs`

**Step 1: Search for any remaining references to deleted functions**

Search for `batchInferProject`, `batchGetProjectFromTags`, `batchResolveProject` — all should be gone. These were the inline duplicates.

**Step 2: Verify no duplicate `PROJECT_PATTERNS` remain**

Search for `const PROJECT_PATTERNS` — should appear exactly once (at module level).

**Step 3: Verify `inferProjectFromName` at line ~868 (the old EC2-specific one) still works**

The old `inferProjectName` function (line 868, note: no "From") is used by `fetchEC2Instances` and `handleAwsProjectCosts`. This is a different function (strips suffixes, returns cleaned name) from the new module-level `inferProjectFromName` (uses regex patterns). Both should coexist — they serve different purposes.

**Step 4: Verify the file parses correctly**

```bash
cd option-a-threejs-gsap-tailwind/chat-backend && node -e "import('./aws-costs/index.mjs').then(() => console.log('OK')).catch(e => console.error(e.message))"
```

Expected: `OK`

**Step 5: Final commit**

```bash
git add option-a-threejs-gsap-tailwind/chat-backend/aws-costs/index.mjs
git commit -m "chore: clean up duplicate project resolution code"
```

---

## Summary of Changes

| Handler | Before | After |
|---------|--------|-------|
| `handleAwsProjectCostsDynamic` | Tags only for EC2 + ELB | Tags for ALL 6 resource types |
| `handleAwsCostDailyByProject` | Tags only for EC2 | Tags for EC2 + Lambda + S3 + CloudFront |
| `handleAwsCostDashboardBatch` | Tags only for EC2 + ELB | Tags for ALL 6 resource types |
| `PROJECT_PATTERNS` | 3 duplicate copies | 1 shared module-level constant |
| Resolver functions | 3 duplicate sets | 1 shared set + tag fetcher helpers |
| Service fallbacks | Hardcoded to Career Builder/Vedic Astro | Kept as-is with comment (correct for current state) |

## How new projects will work after this

1. Deploy a new resource (Lambda, S3 bucket, CloudFront, EC2, ELB, ECS)
2. Tag it with `project=My New Project` (or `Project`, `application`, `Application`, `app`)
3. It automatically appears as "My New Project" in the cost dashboard
4. No code changes needed
