/**
 * AWS Cost Explorer Handlers
 *
 * Account-wide AWS cost analysis using the Cost Explorer API.
 * Separate from the per-project cost estimation in costs/index.mjs.
 *
 * Handlers:
 * - handleAwsCostSummary:        Total spend with service breakdown + month-over-month comparison
 * - handleAwsCostDaily:          Daily cost time-series
 * - handleAwsCostDailyByService: Monthly cost breakdown by top services (last 6 months)
 * - handleAwsCostForecast:       End-of-month cost forecast
 */

import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  GetCostForecastCommand
} from '@aws-sdk/client-cost-explorer';

import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeVolumesCommand,
  DescribeSnapshotsCommand,
  DescribeAddressesCommand,
  DescribeNatGatewaysCommand,
  DeleteVolumeCommand,
  DeleteSnapshotCommand,
  ReleaseAddressCommand
} from '@aws-sdk/client-ec2';

import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  GetBucketLocationCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  GetBucketTaggingCommand
} from '@aws-sdk/client-s3';

import {
  CloudFrontClient,
  ListDistributionsCommand,
  ListTagsForResourceCommand as CFListTagsCommand
} from '@aws-sdk/client-cloudfront';

import {
  LambdaClient,
  ListFunctionsCommand,
  ListTagsCommand as LambdaListTagsCommand
} from '@aws-sdk/client-lambda';

import {
  CloudWatchClient,
  GetMetricStatisticsCommand
} from '@aws-sdk/client-cloudwatch';

import {
  ElasticLoadBalancingV2Client,
  DescribeLoadBalancersCommand,
  DescribeTagsCommand as ELBDescribeTagsCommand
} from '@aws-sdk/client-elastic-load-balancing-v2';

import {
  ECSClient,
  ListClustersCommand,
  ListServicesCommand,
  DescribeServicesCommand,
  ListTagsForResourceCommand as ECSListTagsCommand
} from '@aws-sdk/client-ecs';

import {
  CloudTrailClient,
  LookupEventsCommand
} from '@aws-sdk/client-cloudtrail';

import { gunzipSync } from 'zlib';

const ceClient = new CostExplorerClient({ region: 'us-east-1' });
const ec2Client = new EC2Client({ region: 'us-east-1' });
const s3Client = new S3Client({ region: 'us-east-1' });
const cfClient = new CloudFrontClient({ region: 'us-east-1' });
const lambdaClient = new LambdaClient({ region: 'us-east-1' });
const cwClient = new CloudWatchClient({ region: 'us-east-1' });
const elbClient = new ElasticLoadBalancingV2Client({ region: 'us-east-1' });
const ecsClient = new ECSClient({ region: 'us-east-1' });
const ctClient = new CloudTrailClient({ region: 'us-east-1' });

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
  return 'AI Product Studio';
}

/** Unified resolver: tags first, then name-based fallback. */
function resolveProject(tags, resourceName) {
  return getProjectFromTags(tags) || inferProjectFromName(resourceName);
}

/** Fetch CloudFront distribution tags. Returns { key: value } object or null. */
async function fetchCFTags(distARN) {
  try {
    const result = await cfClient.send(new CFListTagsCommand({ Resource: distARN }));
    const tags = {};
    for (const t of result.Tags?.Items || []) tags[t.Key] = t.Value;
    return tags;
  } catch { return null; }
}

/** Fetch Lambda function tags. Returns { key: value } object or null. */
async function fetchLambdaTags(functionArn) {
  try {
    const result = await lambdaClient.send(new LambdaListTagsCommand({ Resource: functionArn }));
    return result.Tags || null;
  } catch { return null; }
}

/** Fetch S3 bucket tags. Returns { key: value } object or null. */
async function fetchS3BucketTags(bucketName) {
  try {
    const result = await s3Client.send(new GetBucketTaggingCommand({ Bucket: bucketName }));
    const tags = {};
    for (const t of result.TagSet || []) tags[t.Key] = t.Value;
    return tags;
  } catch { return null; }
}

/** Fetch ECS cluster tags. Returns { key: value } object or null. */
async function fetchECSTags(resourceArn) {
  try {
    const result = await ecsClient.send(new ECSListTagsCommand({ resourceArn }));
    const tags = {};
    for (const t of result.tags || []) tags[t.key] = t.value;
    return tags;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns YYYY-MM-DD for the first day of the month that is `monthsAgo`
 * months before the current month.
 *   monthStart(0) => first day of this month
 *   monthStart(1) => first day of last month
 */
function monthStart(monthsAgo = 0) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - monthsAgo);
  return d.toISOString().slice(0, 10);
}

/**
 * Returns today's date as YYYY-MM-DD (UTC).
 */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Round a number to 2 decimal places.
 */
function r2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Calculate the number of days between two YYYY-MM-DD strings.
 */
function daysBetween(startStr, endStr) {
  const ms = new Date(endStr).getTime() - new Date(startStr).getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

/**
 * Build a standard JSON response object.
 */
function jsonResponse(statusCode, corsHeaders, payload) {
  return {
    statusCode,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  };
}

// ---------------------------------------------------------------------------
// CUR (Cost and Usage Report) Reader — reads from S3 instead of CE API ($0.00)
// ---------------------------------------------------------------------------

const CUR_BUCKET = 'cocreate-cur-reports';
const CUR_REPORT_NAME = 'cocreate-daily-cost-report';
const CUR_PREFIX = 'cur/' + CUR_REPORT_NAME;

/** Parse a CSV line handling quoted fields with commas/newlines inside. */
function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { fields.push(current); current = ''; }
      else { current += ch; }
    }
  }
  fields.push(current);
  return fields;
}

/** Build CUR S3 folder key for a billing period: YYYYMMDD-YYYYMMDD */
function billingPeriodKey(year, month) {
  const start = `${year}${String(month).padStart(2, '0')}01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const end = `${nextYear}${String(nextMonth).padStart(2, '0')}01`;
  return `${start}-${end}`;
}

/** Read CUR data for a single billing period (month). Returns array of row objects or null. */
async function readCurForPeriod(year, month) {
  const period = billingPeriodKey(year, month);
  const prefix = `${CUR_PREFIX}/${period}/`;
  const listResp = await s3Client.send(new ListObjectsV2Command({ Bucket: CUR_BUCKET, Prefix: prefix }));
  const contents = listResp.Contents || [];
  const manifestObj = contents.find(c => c.Key.endsWith('-Manifest.json'));
  if (!manifestObj) return null;

  const mResp = await s3Client.send(new GetObjectCommand({ Bucket: CUR_BUCKET, Key: manifestObj.Key }));
  const manifest = JSON.parse(await mResp.Body.transformToString());

  const allRows = [];
  for (const csvKey of manifest.reportKeys || []) {
    const csvResp = await s3Client.send(new GetObjectCommand({ Bucket: CUR_BUCKET, Key: csvKey }));
    const bytes = await csvResp.Body.transformToByteArray();
    const decompressed = gunzipSync(Buffer.from(bytes));
    const lines = decompressed.toString('utf-8').split('\n');
    if (lines.length < 2) continue;
    const headers = parseCsvLine(lines[0]);
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const values = parseCsvLine(lines[i]);
      const row = {};
      for (let j = 0; j < headers.length; j++) row[headers[j]] = values[j] || '';
      allRows.push(row);
    }
  }
  return allRows;
}

/** Load CUR data for last 7 months (current + 6 previous). Returns flat array of all rows. */
async function loadAllCurData() {
  const now = new Date();
  const months = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
  }
  const results = await Promise.all(
    months.map(({ year, month }) => readCurForPeriod(year, month).catch(() => null))
  );
  return results.filter(r => r !== null).flat();
}

/** Map CUR row to CE API-compatible service name. */
function curToServiceName(row) {
  const lineItemType = row['lineItem/LineItemType'] || '';
  if (lineItemType === 'Tax') return 'Tax';
  const productCode = row['lineItem/ProductCode'] || '';
  const productName = row['product/ProductName'] || productCode;
  const usageType = row['lineItem/UsageType'] || '';
  // EC2 split: Compute vs Other
  if (productCode === 'AmazonEC2') {
    if (/BoxUsage|HeavyUsage|SpotUsage|InstanceUsage|DedicatedUsage/i.test(usageType)) {
      return 'Amazon Elastic Compute Cloud - Compute';
    }
    return 'EC2 - Other';
  }
  // Normalize known mismatches between CUR product names and CE service names
  const nameMap = {
    'Elastic Load Balancing': 'Amazon Elastic Load Balancing',
    'AWS CodeBuild': 'CodeBuild'
  };
  return nameMap[productName] || productName;
}

/**
 * Aggregate CUR rows into a CE-API-compatible ResultsByTime response.
 * @param {Array} rows - CUR data rows
 * @param {string} startDate - YYYY-MM-DD inclusive start
 * @param {string} endDate - YYYY-MM-DD exclusive end
 * @param {string} granularity - 'DAILY' or 'MONTHLY'
 * @param {string[]} groupByKeys - e.g. ['SERVICE'] or ['SERVICE','USAGE_TYPE']
 * @param {string[]} metrics - e.g. ['UnblendedCost'] or ['UnblendedCost','UsageQuantity']
 */
function curToCeFormat(rows, startDate, endDate, granularity, groupByKeys, metrics) {
  const filtered = rows.filter(row => {
    const date = (row['lineItem/UsageStartDate'] || '').slice(0, 10);
    return date >= startDate && date < endDate;
  });

  const periods = {};
  for (const row of filtered) {
    const date = (row['lineItem/UsageStartDate'] || '').slice(0, 10);
    const periodKey = granularity === 'DAILY' ? date : date.slice(0, 7) + '-01';
    if (!periods[periodKey]) periods[periodKey] = [];
    periods[periodKey].push(row);
  }

  const resultsByTime = [];
  for (const periodStart of Object.keys(periods).sort()) {
    const periodRows = periods[periodStart];
    let periodEnd;
    if (granularity === 'DAILY') {
      const d = new Date(periodStart + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + 1);
      periodEnd = d.toISOString().slice(0, 10);
    } else {
      const d = new Date(periodStart + 'T00:00:00Z');
      d.setUTCMonth(d.getUTCMonth() + 1);
      periodEnd = d.toISOString().slice(0, 10);
    }

    const groups = {};
    for (const row of periodRows) {
      const keys = groupByKeys.map(k => {
        if (k === 'SERVICE') return curToServiceName(row);
        if (k === 'USAGE_TYPE') return row['lineItem/UsageType'] || 'Unknown';
        return 'Unknown';
      });
      const gk = keys.join('|');
      if (!groups[gk]) groups[gk] = { keys, cost: 0, usage: 0 };
      groups[gk].cost += parseFloat(row['lineItem/UnblendedCost'] || '0') || 0;
      groups[gk].usage += parseFloat(row['lineItem/UsageAmount'] || '0') || 0;
    }

    const ceGroups = Object.values(groups).map(g => {
      const m = {};
      if (metrics.includes('UnblendedCost')) m.UnblendedCost = { Amount: String(g.cost) };
      if (metrics.includes('UsageQuantity')) m.UsageQuantity = { Amount: String(g.usage) };
      return { Keys: g.keys, Metrics: m };
    });

    resultsByTime.push({ TimePeriod: { Start: periodStart, End: periodEnd }, Groups: ceGroups });
  }

  return { ResultsByTime: resultsByTime };
}

/**
 * Calculate forecast from CUR data: (totalMTD / daysElapsed) * daysInMonth.
 * Returns CE-API-compatible forecast response.
 */
function curCalculateForecast(curRows, todayStr, forecastEndStr) {
  const monthStart = todayStr.slice(0, 7) + '-01';
  const currentMonthRows = curRows.filter(row => {
    const date = (row['lineItem/UsageStartDate'] || '').slice(0, 10);
    return date >= monthStart && date < todayStr;
  });
  const totalMtd = currentMonthRows.reduce((sum, row) =>
    sum + (parseFloat(row['lineItem/UnblendedCost'] || '0') || 0), 0);
  const daysElapsed = daysBetween(monthStart, todayStr) || 1;
  const dEnd = new Date(forecastEndStr + 'T00:00:00Z');
  const daysInMonth = new Date(Date.UTC(dEnd.getUTCFullYear(), dEnd.getUTCMonth(), 0)).getUTCDate();
  const forecastedTotal = (totalMtd / daysElapsed) * daysInMonth;
  return { Total: { Amount: String(forecastedTotal) } };
}

// ---------------------------------------------------------------------------
// 1. handleAwsCostSummary
// ---------------------------------------------------------------------------

/**
 * Returns total AWS spend for a date range, broken down by service, with
 * month-over-month comparison against the previous period of the same length.
 *
 * Accepts body.startDate / body.endDate (defaults: current month start -> today).
 */
export async function handleAwsCostSummary({ body, corsHeaders, ADMIN_PASSWORD }) {
  if (body.password !== ADMIN_PASSWORD) {
    return jsonResponse(401, corsHeaders, { success: false, error: 'Unauthorized' });
  }

  try {
    const startDate = body.startDate || monthStart(0);
    const endDate = body.endDate || today();

    // Calculate the previous period of the same length
    const periodDays = daysBetween(startDate, endDate);
    const prevEnd = startDate; // exclusive end = current start
    const prevStartDate = new Date(prevEnd);
    prevStartDate.setUTCDate(prevStartDate.getUTCDate() - periodDays);
    const prevStart = prevStartDate.toISOString().slice(0, 10);

    // Fetch current and previous periods in parallel
    const [currentResult, previousResult] = await Promise.all([
      ceClient.send(new GetCostAndUsageCommand({
        TimePeriod: { Start: startDate, End: endDate },
        Granularity: 'MONTHLY',
        Metrics: ['UnblendedCost'],
        GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }]
      })),
      ceClient.send(new GetCostAndUsageCommand({
        TimePeriod: { Start: prevStart, End: prevEnd },
        Granularity: 'MONTHLY',
        Metrics: ['UnblendedCost'],
        GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }]
      }))
    ]);

    // Aggregate current period costs by service
    const currentByService = {};
    for (const timePeriod of currentResult.ResultsByTime || []) {
      for (const group of timePeriod.Groups || []) {
        const service = group.Keys[0];
        const cost = parseFloat(group.Metrics.UnblendedCost.Amount) || 0;
        currentByService[service] = (currentByService[service] || 0) + cost;
      }
    }

    // Aggregate previous period costs by service
    const previousByService = {};
    for (const timePeriod of previousResult.ResultsByTime || []) {
      for (const group of timePeriod.Groups || []) {
        const service = group.Keys[0];
        const cost = parseFloat(group.Metrics.UnblendedCost.Amount) || 0;
        previousByService[service] = (previousByService[service] || 0) + cost;
      }
    }

    // Build merged service list, filter out negligible costs, sort desc
    const allServiceNames = new Set([
      ...Object.keys(currentByService),
      ...Object.keys(previousByService)
    ]);

    let services = [];
    for (const service of allServiceNames) {
      const cost = currentByService[service] || 0;
      const previousCost = previousByService[service] || 0;
      if (cost < 0.001 && previousCost < 0.001) continue;
      services.push({ service, cost, previousCost });
    }

    services.sort((a, b) => b.cost - a.cost);

    const totalCost = r2(services.reduce((sum, s) => sum + s.cost, 0));
    const previousPeriodCost = r2(services.reduce((sum, s) => sum + s.previousCost, 0));
    const momChange = previousPeriodCost === 0
      ? (totalCost > 0 ? 100 : 0)
      : r2(((totalCost - previousPeriodCost) / previousPeriodCost) * 100);

    const topService = services.length > 0
      ? { name: services[0].service, cost: r2(services[0].cost) }
      : { name: 'N/A', cost: 0 };

    const activeServices = services.filter(s => s.cost >= 0.001).length;

    const formattedServices = services.map(s => ({
      service: s.service,
      cost: r2(s.cost),
      previousCost: r2(s.previousCost),
      delta: r2(s.cost - s.previousCost),
      percentOfTotal: totalCost > 0 ? r2((s.cost / totalCost) * 100) : 0
    }));

    return jsonResponse(200, corsHeaders, {
      success: true,
      data: {
        totalCost,
        previousPeriodCost,
        momChange,
        topService,
        activeServices,
        services: formattedServices,
        period: { start: startDate, end: endDate }
      }
    });
  } catch (error) {
    console.error('[AWS Cost Summary] Error:', error);
    return jsonResponse(500, corsHeaders, { success: false, error: error.message });
  }
}

// ---------------------------------------------------------------------------
// 2. handleAwsCostDaily
// ---------------------------------------------------------------------------

/**
 * Returns daily cost totals for a date range (no service grouping).
 * Accepts body.startDate / body.endDate (defaults: current month start -> today).
 */
export async function handleAwsCostDaily({ body, corsHeaders, ADMIN_PASSWORD }) {
  if (body.password !== ADMIN_PASSWORD) {
    return jsonResponse(401, corsHeaders, { success: false, error: 'Unauthorized' });
  }

  try {
    const startDate = body.startDate || monthStart(0);
    const endDate = body.endDate || today();

    const result = await ceClient.send(new GetCostAndUsageCommand({
      TimePeriod: { Start: startDate, End: endDate },
      Granularity: 'DAILY',
      Metrics: ['UnblendedCost']
    }));

    const dailyCosts = (result.ResultsByTime || []).map(tp => ({
      date: tp.TimePeriod.Start,
      cost: r2(parseFloat(tp.Total?.UnblendedCost?.Amount) || 0)
    }));

    return jsonResponse(200, corsHeaders, {
      success: true,
      data: { dailyCosts }
    });
  } catch (error) {
    console.error('[AWS Cost Daily] Error:', error);
    return jsonResponse(500, corsHeaders, { success: false, error: error.message });
  }
}

// ---------------------------------------------------------------------------
// 3. handleAwsCostDailyByService
// ---------------------------------------------------------------------------

/**
 * Returns monthly cost breakdown by the top 5 services over the last 6 months.
 * Accepts optional body.startDate / body.endDate (defaults: 6 months ago -> today).
 */
export async function handleAwsCostDailyByService({ body, corsHeaders, ADMIN_PASSWORD }) {
  if (body.password !== ADMIN_PASSWORD) {
    return jsonResponse(401, corsHeaders, { success: false, error: 'Unauthorized' });
  }

  try {
    const startDate = body.startDate || monthStart(6);
    const endDate = body.endDate || today();

    const result = await ceClient.send(new GetCostAndUsageCommand({
      TimePeriod: { Start: startDate, End: endDate },
      Granularity: 'MONTHLY',
      Metrics: ['UnblendedCost'],
      GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }]
    }));

    // Collect all months in order
    const months = (result.ResultsByTime || []).map(tp => tp.TimePeriod.Start);

    // Aggregate total cost per service across all months
    const serviceTotals = {};
    // Also store per-month data keyed by service -> month
    const serviceMonthly = {};

    for (const tp of result.ResultsByTime || []) {
      const month = tp.TimePeriod.Start;
      for (const group of tp.Groups || []) {
        const service = group.Keys[0];
        const cost = parseFloat(group.Metrics.UnblendedCost.Amount) || 0;
        serviceTotals[service] = (serviceTotals[service] || 0) + cost;
        if (!serviceMonthly[service]) serviceMonthly[service] = {};
        serviceMonthly[service][month] = (serviceMonthly[service][month] || 0) + cost;
      }
    }

    // Pick top 5 services by total spend, filtering out negligible ones
    const rankedServices = Object.entries(serviceTotals)
      .filter(([, total]) => total >= 0.001)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([service]) => service);

    const services = rankedServices.map(service => ({
      service,
      monthly: months.map(month => ({
        month,
        cost: r2(serviceMonthly[service]?.[month] || 0)
      }))
    }));

    return jsonResponse(200, corsHeaders, {
      success: true,
      data: { months, services }
    });
  } catch (error) {
    console.error('[AWS Cost Daily By Service] Error:', error);
    return jsonResponse(500, corsHeaders, { success: false, error: error.message });
  }
}

// ---------------------------------------------------------------------------
// 4. handleAwsCostForecast
// ---------------------------------------------------------------------------

/**
 * Returns a cost forecast from today to end of the current month.
 * If the month has already ended (today is the last day), returns null.
 * Forecast may fail gracefully if Cost Explorer lacks sufficient data.
 */
export async function handleAwsCostForecast({ body, corsHeaders, ADMIN_PASSWORD }) {
  if (body.password !== ADMIN_PASSWORD) {
    return jsonResponse(401, corsHeaders, { success: false, error: 'Unauthorized' });
  }

  try {
    const todayStr = today();
    const todayDate = new Date(todayStr + 'T00:00:00Z');

    // End of month: first day of next month (Cost Explorer uses exclusive end)
    const endOfMonth = new Date(Date.UTC(
      todayDate.getUTCFullYear(),
      todayDate.getUTCMonth() + 1,
      1
    ));
    const endStr = endOfMonth.toISOString().slice(0, 10);

    // If today is the last day of the month (or beyond), there is nothing to forecast
    if (todayStr >= endStr) {
      return jsonResponse(200, corsHeaders, {
        success: true,
        data: {
          forecastedTotal: null,
          forecastPeriod: null,
          message: 'Month has ended; no forecast available.'
        }
      });
    }

    // The forecast start must be tomorrow at the earliest if today has data already,
    // but Cost Explorer GetCostForecast start date must be >= today.
    // We use today as the start; AWS will forecast from today to end of month.
    try {
      const forecastResult = await ceClient.send(new GetCostForecastCommand({
        TimePeriod: { Start: todayStr, End: endStr },
        Granularity: 'MONTHLY',
        Metric: 'UNBLENDED_COST'
      }));

      const forecastedTotal = r2(
        parseFloat(forecastResult.Total?.Amount) || 0
      );

      return jsonResponse(200, corsHeaders, {
        success: true,
        data: {
          forecastedTotal,
          forecastPeriod: { start: todayStr, end: endStr }
        }
      });
    } catch (forecastError) {
      // Forecast can fail if there is insufficient historical data
      console.warn('[AWS Cost Forecast] Forecast API error:', forecastError.message);
      return jsonResponse(200, corsHeaders, {
        success: true,
        data: {
          forecastedTotal: null,
          forecastPeriod: { start: todayStr, end: endStr },
          message: `Forecast unavailable: ${forecastError.message}`
        }
      });
    }
  } catch (error) {
    console.error('[AWS Cost Forecast] Error:', error);
    return jsonResponse(500, corsHeaders, { success: false, error: error.message });
  }
}

// ---------------------------------------------------------------------------
// 5. handleAwsCostServiceDetail
// ---------------------------------------------------------------------------

/**
 * Returns usage-type breakdown for all services, plus EC2 instance inventory
 * and cost optimization suggestions.
 */
export async function handleAwsCostServiceDetail({ body, corsHeaders, ADMIN_PASSWORD }) {
  if (body.password !== ADMIN_PASSWORD) {
    return jsonResponse(401, corsHeaders, { success: false, error: 'Unauthorized' });
  }

  try {
    const startDate = body.startDate || monthStart(0);
    const endDate = body.endDate || today();

    // Fetch costs grouped by SERVICE + USAGE_TYPE
    const [usageResult, ec2Instances] = await Promise.all([
      ceClient.send(new GetCostAndUsageCommand({
        TimePeriod: { Start: startDate, End: endDate },
        Granularity: 'MONTHLY',
        Metrics: ['UnblendedCost', 'UsageQuantity'],
        GroupBy: [
          { Type: 'DIMENSION', Key: 'SERVICE' },
          { Type: 'DIMENSION', Key: 'USAGE_TYPE' }
        ]
      })),
      fetchEC2Instances()
    ]);

    // Build service -> usage type breakdown
    const serviceDetails = {};
    for (const tp of usageResult.ResultsByTime || []) {
      for (const group of tp.Groups || []) {
        const service = group.Keys[0];
        const usageType = group.Keys[1];
        const cost = parseFloat(group.Metrics.UnblendedCost.Amount) || 0;
        const usage = parseFloat(group.Metrics.UsageQuantity.Amount) || 0;

        if (cost < 0.001 && usage < 0.001) continue;

        if (!serviceDetails[service]) serviceDetails[service] = { usageTypes: [], totalCost: 0 };
        serviceDetails[service].totalCost += cost;
        serviceDetails[service].usageTypes.push({
          usageType,
          cost: r2(cost),
          usage: r2(usage)
        });
      }
    }

    // Sort usage types within each service by cost desc
    for (const svc of Object.values(serviceDetails)) {
      svc.totalCost = r2(svc.totalCost);
      svc.usageTypes.sort((a, b) => b.cost - a.cost);
    }

    // Generate optimization suggestions
    const suggestions = generateSuggestions(serviceDetails, ec2Instances);

    return jsonResponse(200, corsHeaders, {
      success: true,
      data: {
        serviceDetails,
        ec2Instances,
        suggestions,
        period: { start: startDate, end: endDate }
      }
    });
  } catch (error) {
    console.error('[AWS Cost Service Detail] Error:', error);
    return jsonResponse(500, corsHeaders, { success: false, error: error.message });
  }
}

/**
 * Fetch all EC2 instances with their names, states, types, and tags.
 */
async function fetchEC2Instances() {
  try {
    const result = await ec2Client.send(new DescribeInstancesCommand({
      Filters: [{ Name: 'instance-state-name', Values: ['running', 'stopped'] }]
    }));
    const instances = [];

    for (const reservation of result.Reservations || []) {
      for (const inst of reservation.Instances || []) {
        const tags = {};
        for (const tag of inst.Tags || []) {
          tags[tag.Key] = tag.Value;
        }

        const instanceName = tags.Name || tags.name || inst.InstanceId;
        const instanceType = inst.InstanceType;
        const state = inst.State?.Name || 'unknown';
        const project = tags.Project || tags.project || tags.Application || tags.app || inferProjectName(instanceName);
        const monthlyCost = state === 'running' ? estimateMonthlyInstanceCost(instanceType) : 0;

        instances.push({
          instanceId: inst.InstanceId,
          name: instanceName,
          type: instanceType,
          state,
          launchTime: inst.LaunchTime ? inst.LaunchTime.toISOString() : null,
          az: inst.Placement?.AvailabilityZone || '',
          publicIp: inst.PublicIpAddress || null,
          privateIp: inst.PrivateIpAddress || null,
          project,
          estimatedMonthlyCost: monthlyCost,
          environment: tags.Environment || tags.env || null,
          allTags: tags
        });
      }
    }

    return instances;
  } catch (error) {
    console.warn('[EC2 Instances] Error fetching:', error.message);
    return [];
  }
}

/**
 * Generate cost optimization suggestions based on service costs and EC2 inventory.
 */
function generateSuggestions(serviceDetails, ec2Instances) {
  const suggestions = [];

  // Check for stopped EC2 instances still incurring EBS costs
  const stoppedInstances = ec2Instances.filter(i => i.state === 'stopped');
  if (stoppedInstances.length > 0) {
    suggestions.push({
      type: 'warning',
      service: 'Amazon EC2',
      title: `${stoppedInstances.length} stopped EC2 instance(s) found`,
      detail: `Stopped instances still incur EBS storage costs. Instances: ${stoppedInstances.map(i => i.name).join(', ')}`,
      action: 'Consider terminating unused instances or creating AMIs and terminating',
      savings: 'Potential EBS savings'
    });
  }

  // Check for large EC2 instance types
  const largeInstances = ec2Instances.filter(i =>
    i.state === 'running' && i.type && (
      i.type.includes('xlarge') || i.type.includes('2xlarge') ||
      i.type.includes('4xlarge') || i.type.includes('metal')
    )
  );
  if (largeInstances.length > 0) {
    suggestions.push({
      type: 'info',
      service: 'Amazon EC2',
      title: `${largeInstances.length} large instance(s) running`,
      detail: `Review if these need their current size: ${largeInstances.map(i => `${i.name} (${i.type})`).join(', ')}`,
      action: 'Consider rightsizing to smaller instance types or using Savings Plans',
      savings: 'Up to 40-60% with rightsizing'
    });
  }

  // Check for high RDS costs
  const rds = serviceDetails['Amazon Relational Database Service'];
  if (rds && rds.totalCost > 50) {
    suggestions.push({
      type: 'info',
      service: 'Amazon RDS',
      title: `RDS spending $${rds.totalCost}/period`,
      detail: 'RDS is one of your top costs. Consider Reserved Instances for predictable workloads.',
      action: 'Evaluate Reserved Instance pricing for 1-year or 3-year commitments',
      savings: 'Up to 30-60% with Reserved Instances'
    });
  }

  // Check for ElastiCache costs
  const elasticache = serviceDetails['Amazon ElastiCache'];
  if (elasticache && elasticache.totalCost > 30) {
    suggestions.push({
      type: 'info',
      service: 'Amazon ElastiCache',
      title: `ElastiCache spending $${elasticache.totalCost}/period`,
      detail: 'Review if cache node sizes match your workload. Consider reserved nodes.',
      action: 'Right-size cache nodes and evaluate reserved pricing',
      savings: 'Up to 30-55% with reserved nodes'
    });
  }

  // Check for NAT Gateway / VPC costs
  const vpc = serviceDetails['Amazon Virtual Private Cloud'];
  if (vpc && vpc.totalCost > 10) {
    suggestions.push({
      type: 'warning',
      service: 'Amazon VPC',
      title: `VPC costs $${vpc.totalCost}/period — check NAT Gateway`,
      detail: 'NAT Gateway charges per hour + per GB processed. Often a hidden cost driver.',
      action: 'Consider VPC endpoints for S3/DynamoDB to reduce NAT traffic',
      savings: 'Varies — can reduce data processing charges significantly'
    });
  }

  // Check for CloudWatch costs
  const cw = serviceDetails['AmazonCloudWatch'];
  if (cw && cw.totalCost > 5) {
    suggestions.push({
      type: 'info',
      service: 'CloudWatch',
      title: `CloudWatch spending $${cw.totalCost}/period`,
      detail: 'Review log retention policies and custom metrics. Old logs accumulate costs.',
      action: 'Set log retention to 30-90 days, remove unused dashboards/alarms',
      savings: 'Varies based on log volume'
    });
  }

  // General: if total > $300, suggest Savings Plans
  const totalCost = Object.values(serviceDetails).reduce((sum, s) => sum + s.totalCost, 0);
  if (totalCost > 300) {
    suggestions.push({
      type: 'tip',
      service: 'General',
      title: 'Consider AWS Savings Plans',
      detail: `Total spend is $${r2(totalCost)}/period. Savings Plans can significantly reduce compute costs.`,
      action: 'Review Savings Plans recommendations in AWS Cost Explorer console',
      savings: 'Up to 72% on EC2/Fargate/Lambda with Compute Savings Plans'
    });
  }

  return suggestions;
}

// ---------------------------------------------------------------------------
// 6. handleAwsProjectCosts
// ---------------------------------------------------------------------------

/** Approximate monthly cost by instance type (on-demand, us-east-1, Linux). */
const INSTANCE_COST_PER_HOUR = {
  't2.micro': 0.0116, 't2.small': 0.023, 't2.medium': 0.0464, 't2.large': 0.0928,
  't3.micro': 0.0104, 't3.small': 0.0208, 't3.medium': 0.0416, 't3.large': 0.0832,
  't3a.micro': 0.0094, 't3a.small': 0.0188, 't3a.medium': 0.0376, 't3a.large': 0.0752,
  'm5.large': 0.096, 'm5.xlarge': 0.192, 'm6i.large': 0.096, 'm6i.xlarge': 0.192,
  'c5.large': 0.085, 'c5.xlarge': 0.17, 'r5.large': 0.126, 'r5.xlarge': 0.252,
};

function estimateMonthlyInstanceCost(instanceType) {
  const hourly = INSTANCE_COST_PER_HOUR[instanceType] || 0.05; // fallback
  return r2(hourly * 730); // ~730 hours/month
}

function inferProjectName(instanceName) {
  if (!instanceName) return 'Unknown';
  const name = instanceName.toLowerCase().trim();

  // Common patterns: "project-name-suffix" or "project-name"
  // Strip common suffixes like -server, -api, -web, -worker, -prod, -staging, -dev
  const suffixes = ['-server', '-api', '-web', '-worker', '-prod', '-staging', '-dev', '-test',
                    '-wss-server', '-wss', '-backend', '-frontend', '-app'];

  let project = name;
  for (const suffix of suffixes) {
    if (project.endsWith(suffix)) {
      project = project.slice(0, -suffix.length);
      break;
    }
  }

  // Also try splitting by common delimiter patterns for compound names
  // e.g. "tmux-builder-cocreateceo" → "tmux-builder"
  // Check if the last segment looks like an org/user identifier
  const parts = project.split('-');
  if (parts.length >= 3) {
    const lastPart = parts[parts.length - 1];
    // If last part looks like an org identifier (>8 chars, no numbers), strip it
    if (lastPart.length > 8 && !/\d/.test(lastPart)) {
      project = parts.slice(0, -1).join('-');
    }
  }

  return project || 'Unknown';
}

/**
 * Returns EC2 instances grouped by project name with estimated monthly costs.
 */
export async function handleAwsProjectCosts({ body, corsHeaders, ADMIN_PASSWORD }) {
  if (body.password !== ADMIN_PASSWORD) {
    return jsonResponse(401, corsHeaders, { success: false, error: 'Unauthorized' });
  }

  try {
    const instances = await fetchEC2Instances();

    // Group instances by inferred project name
    const projectMap = {};
    for (const inst of instances) {
      const projectName = inferProjectName(inst.name);
      if (!projectMap[projectName]) {
        projectMap[projectName] = { name: projectName, instances: [], estimatedMonthlyCost: 0, instanceCount: 0 };
      }
      const monthlyCost = inst.state === 'running' ? estimateMonthlyInstanceCost(inst.type) : 0;
      projectMap[projectName].instances.push({
        ...inst,
        estimatedMonthlyCost: monthlyCost
      });
      projectMap[projectName].estimatedMonthlyCost += monthlyCost;
      projectMap[projectName].instanceCount++;
    }

    // Round costs and sort by cost desc
    const projects = Object.values(projectMap).map(p => ({
      ...p,
      estimatedMonthlyCost: r2(p.estimatedMonthlyCost)
    })).sort((a, b) => b.estimatedMonthlyCost - a.estimatedMonthlyCost);

    return jsonResponse(200, corsHeaders, {
      success: true,
      data: { projects }
    });
  } catch (error) {
    console.error('[AWS Project Costs] Error:', error);
    return jsonResponse(500, corsHeaders, { success: false, error: error.message });
  }
}

// ---------------------------------------------------------------------------
// 7. handleAwsUnusedResources
// ---------------------------------------------------------------------------

/**
 * Finds unattached EBS volumes, old snapshots (>30 days), and unused Elastic IPs.
 */
export async function handleAwsUnusedResources({ body, corsHeaders, ADMIN_PASSWORD }) {
  if (body.password !== ADMIN_PASSWORD) {
    return jsonResponse(401, corsHeaders, { success: false, error: 'Unauthorized' });
  }

  try {
    const [volumesResult, snapshotsResult, addressesResult] = await Promise.all([
      ec2Client.send(new DescribeVolumesCommand({
        Filters: [{ Name: 'status', Values: ['available'] }]
      })),
      ec2Client.send(new DescribeSnapshotsCommand({
        OwnerIds: ['self']
      })),
      ec2Client.send(new DescribeAddressesCommand({}))
    ]);

    // Unattached volumes
    const volumes = (volumesResult.Volumes || []).map(v => {
      const tags = {};
      for (const tag of v.Tags || []) tags[tag.Key] = tag.Value;
      return {
        volumeId: v.VolumeId,
        name: tags.Name || v.VolumeId,
        size: v.Size,
        volumeType: v.VolumeType,
        createTime: v.CreateTime ? v.CreateTime.toISOString() : null,
        az: v.AvailabilityZone,
        estimatedMonthlyCost: r2((v.Size || 0) * 0.10) // ~$0.10/GB/month for gp2
      };
    });

    // Old snapshots (>30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const snapshots = (snapshotsResult.Snapshots || [])
      .filter(s => s.StartTime && new Date(s.StartTime) < thirtyDaysAgo)
      .map(s => {
        const tags = {};
        for (const tag of s.Tags || []) tags[tag.Key] = tag.Value;
        return {
          snapshotId: s.SnapshotId,
          name: tags.Name || s.SnapshotId,
          volumeId: s.VolumeId,
          size: s.VolumeSize,
          startTime: s.StartTime ? s.StartTime.toISOString() : null,
          description: s.Description || '',
          estimatedMonthlyCost: r2((s.VolumeSize || 0) * 0.05) // ~$0.05/GB/month
        };
      })
      .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

    // Unused Elastic IPs (no association)
    const elasticIps = (addressesResult.Addresses || [])
      .filter(a => !a.AssociationId)
      .map(a => {
        const tags = {};
        for (const tag of a.Tags || []) tags[tag.Key] = tag.Value;
        return {
          allocationId: a.AllocationId,
          publicIp: a.PublicIp,
          name: tags.Name || a.PublicIp,
          domain: a.Domain,
          estimatedMonthlyCost: r2(0.005 * 730) // ~$0.005/hr when not associated
        };
      });

    return jsonResponse(200, corsHeaders, {
      success: true,
      data: { volumes, snapshots, elasticIps }
    });
  } catch (error) {
    console.error('[AWS Unused Resources] Error:', error);
    return jsonResponse(500, corsHeaders, { success: false, error: error.message });
  }
}

// ---------------------------------------------------------------------------
// 8. handleAwsDeleteResource
// ---------------------------------------------------------------------------

/**
 * Deletes a single AWS resource (volume, snapshot, or elastic IP).
 */
export async function handleAwsDeleteResource({ body, corsHeaders, ADMIN_PASSWORD }) {
  if (body.password !== ADMIN_PASSWORD) {
    return jsonResponse(401, corsHeaders, { success: false, error: 'Unauthorized' });
  }

  const { resourceType, resourceId } = body;
  if (!resourceType || !resourceId) {
    return jsonResponse(400, corsHeaders, { success: false, error: 'Missing resourceType or resourceId' });
  }

  const validTypes = ['volume', 'snapshot', 'elastic-ip'];
  if (!validTypes.includes(resourceType)) {
    return jsonResponse(400, corsHeaders, { success: false, error: `Invalid resourceType. Must be one of: ${validTypes.join(', ')}` });
  }

  try {
    switch (resourceType) {
      case 'volume':
        await ec2Client.send(new DeleteVolumeCommand({ VolumeId: resourceId }));
        break;
      case 'snapshot':
        await ec2Client.send(new DeleteSnapshotCommand({ SnapshotId: resourceId }));
        break;
      case 'elastic-ip':
        await ec2Client.send(new ReleaseAddressCommand({ AllocationId: resourceId }));
        break;
    }

    return jsonResponse(200, corsHeaders, {
      success: true,
      message: `Successfully deleted ${resourceType}: ${resourceId}`
    });
  } catch (error) {
    console.error(`[AWS Delete Resource] Error deleting ${resourceType} ${resourceId}:`, error);
    return jsonResponse(500, corsHeaders, { success: false, error: error.message });
  }
}

// ---------------------------------------------------------------------------
// 9. handleAwsS3Browse
// ---------------------------------------------------------------------------

/**
 * Lists S3 buckets, or objects within a bucket with prefix-based folder navigation.
 */
export async function handleAwsS3Browse({ body, corsHeaders, ADMIN_PASSWORD }) {
  if (body.password !== ADMIN_PASSWORD) {
    return jsonResponse(401, corsHeaders, { success: false, error: 'Unauthorized' });
  }

  try {
    const { bucket, prefix } = body;

    // If no bucket specified, list all buckets
    if (!bucket) {
      const bucketsResult = await s3Client.send(new ListBucketsCommand({}));
      const buckets = await Promise.all((bucketsResult.Buckets || []).map(async (b) => {
        let location = 'us-east-1';
        try {
          const locResult = await s3Client.send(new GetBucketLocationCommand({ Bucket: b.Name }));
          location = locResult.LocationConstraint || 'us-east-1';
        } catch (e) { /* ignore location errors */ }
        return {
          name: b.Name,
          creationDate: b.CreationDate ? b.CreationDate.toISOString() : null,
          region: location
        };
      }));

      return jsonResponse(200, corsHeaders, {
        success: true,
        data: { buckets }
      });
    }

    // List objects in a bucket with optional prefix
    const params = {
      Bucket: bucket,
      Delimiter: '/',
      MaxKeys: 200
    };
    if (prefix) params.Prefix = prefix;

    const result = await s3Client.send(new ListObjectsV2Command(params));

    const prefixes = (result.CommonPrefixes || []).map(p => ({
      prefix: p.Prefix,
      name: p.Prefix.replace(prefix || '', '').replace(/\/$/, '')
    }));

    const objects = (result.Contents || [])
      .filter(o => o.Key !== prefix) // exclude the prefix itself
      .map(o => ({
        key: o.Key,
        name: o.Key.replace(prefix || '', ''),
        size: o.Size,
        lastModified: o.LastModified ? o.LastModified.toISOString() : null,
        storageClass: o.StorageClass || 'STANDARD'
      }));

    return jsonResponse(200, corsHeaders, {
      success: true,
      data: { objects, prefixes, bucket, prefix: prefix || '' }
    });
  } catch (error) {
    console.error('[AWS S3 Browse] Error:', error);
    return jsonResponse(500, corsHeaders, { success: false, error: error.message });
  }
}

// ---------------------------------------------------------------------------
// 10. handleAwsS3Delete
// ---------------------------------------------------------------------------

/**
 * Deletes one or more S3 objects from a bucket.
 */
export async function handleAwsS3Delete({ body, corsHeaders, ADMIN_PASSWORD }) {
  if (body.password !== ADMIN_PASSWORD) {
    return jsonResponse(401, corsHeaders, { success: false, error: 'Unauthorized' });
  }

  const { bucket, keys } = body;
  if (!bucket || !keys || !Array.isArray(keys) || keys.length === 0) {
    return jsonResponse(400, corsHeaders, { success: false, error: 'Missing bucket or keys array' });
  }

  const deleted = [];
  const errors = [];

  for (const key of keys) {
    try {
      await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      deleted.push(key);
    } catch (error) {
      errors.push({ key, error: error.message });
    }
  }

  return jsonResponse(200, corsHeaders, {
    success: true,
    data: { deleted, errors }
  });
}

// ---------------------------------------------------------------------------
// 11. handleAwsS3Analysis
// ---------------------------------------------------------------------------

const FILE_CATEGORIES = {
  code:    ['.html', '.css', '.js', '.mjs', '.ts', '.jsx', '.tsx', '.json', '.xml', '.yml', '.yaml'],
  images:  ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.avif', '.bmp'],
  fonts:   ['.woff', '.woff2', '.ttf', '.eot', '.otf'],
  media:   ['.mp4', '.mp3', '.wav', '.ogg', '.webm', '.avi'],
  docs:    ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt', '.md'],
  archive: ['.zip', '.tar', '.gz', '.rar', '.7z', '.bz2'],
  cache:   ['.cache', '.tmp', '.temp', '.bak', '.old', '.swp'],
  maps:    ['.map']
};

const TEMP_PATTERNS = [
  /\.map$/i, /\.tmp$/i, /\.temp$/i, /\.bak$/i, /\.old$/i,
  /node_modules\//i, /\.cache\//i, /\.next\//i, /\.nuxt\//i,
  /dist\/.*\.map$/i, /build\/.*\.map$/i, /\.DS_Store$/i, /thumbs\.db$/i,
  /__pycache__\//i, /\.pyc$/i, /\.log$/i
];

/**
 * Analyzes S3 buckets — categorizes files by type, identifies cache/temp files.
 * Pass `buckets` array to limit scope, otherwise analyzes all buckets.
 */
export async function handleAwsS3Analysis({ body, corsHeaders, ADMIN_PASSWORD }) {
  if (body.password !== ADMIN_PASSWORD) {
    return jsonResponse(401, corsHeaders, { success: false, error: 'Unauthorized' });
  }

  try {
    let bucketNames = body.buckets || [];

    // If no buckets specified, list all
    if (bucketNames.length === 0) {
      const bucketsResult = await s3Client.send(new ListBucketsCommand({}));
      bucketNames = (bucketsResult.Buckets || []).map(b => b.Name);
    }

    const analyses = [];

    for (const bucketName of bucketNames) {
      try {
        const analysis = { bucket: bucketName, totalSize: 0, totalObjects: 0, categories: {}, tempFiles: [], largeFiles: [] };
        let continuationToken;

        do {
          const params = { Bucket: bucketName, MaxKeys: 1000 };
          if (continuationToken) params.ContinuationToken = continuationToken;

          const result = await new S3Client({ region: 'ap-south-1' }).send(new ListObjectsV2Command(params));
          const contents = result.Contents || [];

          for (const obj of contents) {
            const key = obj.Key || '';
            const size = obj.Size || 0;
            const ext = ('.' + key.split('.').pop()).toLowerCase();

            analysis.totalSize += size;
            analysis.totalObjects++;

            // Categorize by file type
            let category = 'other';
            for (const [cat, exts] of Object.entries(FILE_CATEGORIES)) {
              if (exts.includes(ext)) { category = cat; break; }
            }
            if (!analysis.categories[category]) {
              analysis.categories[category] = { count: 0, size: 0, files: [] };
            }
            analysis.categories[category].count++;
            analysis.categories[category].size += size;

            // Check for temp/cache patterns
            const isTemp = TEMP_PATTERNS.some(p => p.test(key));
            if (isTemp) {
              analysis.tempFiles.push({
                key, size,
                lastModified: obj.LastModified ? obj.LastModified.toISOString() : null
              });
            }

            // Large files (>5MB)
            if (size > 5 * 1024 * 1024) {
              analysis.largeFiles.push({
                key, size,
                lastModified: obj.LastModified ? obj.LastModified.toISOString() : null
              });
            }
          }

          continuationToken = result.IsTruncated ? result.NextContinuationToken : null;
        } while (continuationToken);

        // Sort large files by size desc, limit to top 20
        analysis.largeFiles.sort((a, b) => b.size - a.size);
        analysis.largeFiles = analysis.largeFiles.slice(0, 20);
        // Limit temp files to top 50
        analysis.tempFiles = analysis.tempFiles.slice(0, 50);
        // Remove file lists from categories (just keep counts/sizes)
        for (const cat of Object.values(analysis.categories)) {
          delete cat.files;
        }

        analyses.push(analysis);
      } catch (bucketErr) {
        analyses.push({ bucket: bucketName, error: bucketErr.message });
      }
    }

    return jsonResponse(200, corsHeaders, {
      success: true,
      data: { analyses }
    });
  } catch (error) {
    console.error('[AWS S3 Analysis] Error:', error);
    return jsonResponse(500, corsHeaders, { success: false, error: error.message });
  }
}

// ---------------------------------------------------------------------------
// 11. handleAwsProjectCostsDynamic
// ---------------------------------------------------------------------------

/**
 * Dynamically discovers ALL AWS resources, maps them to projects, and
 * calculates real costs from Cost Explorer + CloudWatch metrics.
 *
 * Project mapping: reads `project` tag from resources (primary), falls back
 * to name-based pattern matching for untagged resources.
 */
export async function handleAwsProjectCostsDynamic({ body, corsHeaders, ADMIN_PASSWORD }) {
  if (body.password !== ADMIN_PASSWORD) {
    return jsonResponse(401, corsHeaders, { success: false, error: 'Unauthorized' });
  }

  try {
    const startDate = body.startDate || monthStart(0);
    const endDate = body.endDate || today();
    const daysInPeriod = daysBetween(startDate, endDate) || 1;

    // Fetch all data in parallel — includes resource checks for deleted detection
    // Use dynamic imports for SDK clients not in the bundled node_modules
    const safeImport = (mod, factory) => import(mod).then(factory).catch(() => null);

    const [
      costByService,
      ec2Instances,
      distributions,
      lambdaFunctions,
      buckets,
      ecsClusters,
      loadBalancers,
      rdsInstances,
      elasticacheClusters,
      natGateways,
      eipAddresses,
      codebuildProjects,
      ecrRepos
    ] = await Promise.all([
      // Cost Explorer: costs grouped by service
      ceClient.send(new GetCostAndUsageCommand({
        TimePeriod: { Start: startDate, End: endDate },
        Granularity: 'MONTHLY',
        Metrics: ['UnblendedCost'],
        GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }]
      })),
      fetchEC2Instances(),
      cfClient.send(new ListDistributionsCommand({ MaxItems: '100' })).catch(() => ({ DistributionList: { Items: [] } })),
      lambdaClient.send(new ListFunctionsCommand({ MaxItems: 200 })).catch(() => ({ Functions: [] })),
      s3Client.send(new ListBucketsCommand({})).catch(() => ({ Buckets: [] })),
      ecsClient.send(new ListClustersCommand({})).catch(() => ({ clusterArns: [] })),
      elbClient.send(new DescribeLoadBalancersCommand({})).catch(() => ({ LoadBalancers: [] })),
      // Extra checks for deleted resource detection (dynamic imports — available in Lambda runtime)
      safeImport('@aws-sdk/client-rds', m => new m.RDSClient({ region: 'us-east-1' }).send(new m.DescribeDBInstancesCommand({}))),
      safeImport('@aws-sdk/client-elasticache', m => new m.ElastiCacheClient({ region: 'us-east-1' }).send(new m.DescribeCacheClustersCommand({}))),
      ec2Client.send(new DescribeNatGatewaysCommand({ Filter: [{ Name: 'state', Values: ['available', 'pending'] }] })).catch(() => ({ NatGateways: [] })),
      ec2Client.send(new DescribeAddressesCommand({})).catch(() => ({ Addresses: [] })),
      safeImport('@aws-sdk/client-codebuild', m => new m.CodeBuildClient({ region: 'us-east-1' }).send(new m.ListProjectsCommand({}))),
      safeImport('@aws-sdk/client-ecr', m => new m.ECRClient({ region: 'us-east-1' }).send(new m.DescribeRepositoriesCommand({})))
    ]);

    // Parse total cost per AWS service (MTD actuals)
    const serviceCostsMtd = {};
    for (const tp of costByService.ResultsByTime || []) {
      for (const g of tp.Groups || []) {
        const svc = g.Keys[0];
        const cost = parseFloat(g.Metrics.UnblendedCost.Amount) || 0;
        serviceCostsMtd[svc] = (serviceCostsMtd[svc] || 0) + cost;
      }
    }

    // Normalize MTD costs to estimated monthly costs so project totals
    // remain stable regardless of which day of the month you view.
    // Formula: (mtdCost / daysElapsed) * daysInMonth
    const nowDate = new Date();
    const daysInMonth = new Date(nowDate.getUTCFullYear(), nowDate.getUTCMonth() + 1, 0).getUTCDate();
    const monthlyMultiplier = daysInPeriod > 0 ? daysInMonth / daysInPeriod : 1;
    const serviceCosts = {};
    for (const [svc, mtd] of Object.entries(serviceCostsMtd)) {
      // Tax is charged on day 1, don't project it
      serviceCosts[svc] = svc === 'Tax' ? mtd : r2(mtd * monthlyMultiplier);
    }

    // Fetch ELB tags (single call for all load balancers)
    const elbs = (loadBalancers.LoadBalancers || []);
    const elbTagMap = {}; // ARN → {key: value} object
    if (elbs.length > 0) {
      try {
        const elbArns = elbs.map(e => e.LoadBalancerArn);
        const tagResult = await elbClient.send(new ELBDescribeTagsCommand({ ResourceArns: elbArns }));
        for (const desc of tagResult.TagDescriptions || []) {
          const tags = {};
          for (const t of desc.Tags || []) tags[t.Key] = t.Value;
          elbTagMap[desc.ResourceArn] = tags;
        }
      } catch (e) {
        console.warn('[ELB Tags] Error fetching:', e.message);
      }
    }

    // Fetch tags for CloudFront, Lambda, S3, ECS in parallel (free API calls)
    const cfDistributions = distributions.DistributionList?.Items || [];
    const lambdaFns = lambdaFunctions.Functions || [];
    const s3Buckets = buckets.Buckets || [];
    const ecsArns = ecsClusters.clusterArns || [];

    const [cfTagMap, lambdaTagMap, s3TagMap, ecsTagMap] = await Promise.all([
      Promise.all(cfDistributions.map(async (dist) => {
        const tags = await fetchCFTags(dist.ARN);
        return [dist.ARN, tags];
      })).then(entries => Object.fromEntries(entries.filter(([, t]) => t))),
      Promise.all(lambdaFns.map(async (fn) => {
        const tags = await fetchLambdaTags(fn.FunctionArn);
        return [fn.FunctionArn, tags];
      })).then(entries => Object.fromEntries(entries.filter(([, t]) => t))),
      Promise.all(s3Buckets.map(async (b) => {
        const tags = await fetchS3BucketTags(b.Name);
        return [b.Name, tags];
      })).then(entries => Object.fromEntries(entries.filter(([, t]) => t))),
      Promise.all(ecsArns.map(async (arn) => {
        const tags = await fetchECSTags(arn);
        return [arn, tags];
      })).then(entries => Object.fromEntries(entries.filter(([, t]) => t)))
    ]);

    // ── Build project map ──
    const projects = {};
    function getProject(name) {
      if (!projects[name]) {
        projects[name] = { name, resources: [], total: 0, serviceSet: {} };
      }
      return projects[name];
    }
    function addResource(projName, service, resource, details, cost) {
      const proj = getProject(projName);
      proj.resources.push({ service, resource, details, monthlyCost: r2(cost), prevMonthlyCost: null });
      proj.total += cost;
      proj.serviceSet[service] = true;
    }

    // ── 1. EC2 Instances ──
    for (const inst of ec2Instances) {
      const projName = resolveProject(inst.allTags, inst.name);
      const monthlyCost = inst.estimatedMonthlyCost || 0;
      addResource(projName, 'EC2', inst.name + ' (' + (inst.type || '--') + ')',
        inst.state + (inst.publicIp ? ', ' + inst.publicIp : ''), monthlyCost);
    }

    // ── 2. CloudFront Distributions ──
    // Get CloudWatch metrics for each distribution to estimate cost
    const cfMetricPromises = cfDistributions.map(async (dist) => {
      try {
        const [reqResult, bytesResult] = await Promise.all([
          cwClient.send(new GetMetricStatisticsCommand({
            Namespace: 'AWS/CloudFront', MetricName: 'Requests',
            Dimensions: [{ Name: 'DistributionId', Value: dist.Id }, { Name: 'Region', Value: 'Global' }],
            StartTime: new Date(startDate), EndTime: new Date(endDate),
            Period: 86400 * 31, Statistics: ['Sum']
          })),
          cwClient.send(new GetMetricStatisticsCommand({
            Namespace: 'AWS/CloudFront', MetricName: 'BytesDownloaded',
            Dimensions: [{ Name: 'DistributionId', Value: dist.Id }, { Name: 'Region', Value: 'Global' }],
            StartTime: new Date(startDate), EndTime: new Date(endDate),
            Period: 86400 * 31, Statistics: ['Sum']
          }))
        ]);
        const requests = reqResult.Datapoints?.[0]?.Sum || 0;
        const bytes = bytesResult.Datapoints?.[0]?.Sum || 0;
        const gbTransfer = bytes / (1024 * 1024 * 1024);
        // CloudFront pricing: ~$0.085/GB + $0.01/10K requests
        const estimatedCost = (gbTransfer * 0.085) + (requests / 10000 * 0.01);
        return { dist, requests, bytes, estimatedCost };
      } catch {
        return { dist, requests: 0, bytes: 0, estimatedCost: 0 };
      }
    });
    const cfMetrics = await Promise.all(cfMetricPromises);

    for (const { dist, requests, bytes, estimatedCost } of cfMetrics) {
      const originDomain = dist.Origins?.Items?.[0]?.DomainName || '';
      const alias = dist.Aliases?.Items?.[0] || '';
      const displayName = alias || dist.DomainName;
      const cfTags = cfTagMap[dist.ARN] || null;
      const projName = getProjectFromTags(cfTags)
        || (inferProjectFromName(originDomain) !== 'AI Product Studio'
            ? inferProjectFromName(originDomain)
            : inferProjectFromName(alias || dist.DomainName));
      const gbStr = (bytes / (1024 * 1024 * 1024)).toFixed(2);
      const reqStr = requests > 1000 ? (requests / 1000).toFixed(1) + 'K' : requests.toString();
      addResource(projName, 'CloudFront', displayName,
        reqStr + ' requests, ' + gbStr + ' GB', estimatedCost);
    }

    // ── 3. Lambda Functions ──
    // Group by project prefix
    const lambdaByProject = {};
    for (const fn of lambdaFns) {
      const fnTags = lambdaTagMap[fn.FunctionArn] || null;
      const projName = resolveProject(fnTags, fn.FunctionName);
      if (!lambdaByProject[projName]) lambdaByProject[projName] = [];
      lambdaByProject[projName].push(fn.FunctionName);
    }
    // Lambda cost from Cost Explorer (MTD — will be normalized after section 6)
    const lambdaCostMtd = serviceCosts['AWS Lambda'] || 0;
    const totalLambdaFns = lambdaFns.length || 1;
    for (const [projName, fns] of Object.entries(lambdaByProject)) {
      const projLambdaCostMtd = lambdaCostMtd * (fns.length / totalLambdaFns);
      addResource(projName, 'Lambda', fns.length + ' functions',
        fns.slice(0, 3).map(f => f.substring(0, 40)).join(', ') + (fns.length > 3 ? '...' : ''),
        projLambdaCostMtd);
    }

    // ── 4. S3 Buckets ──
    const s3CostMtd = serviceCosts['Amazon Simple Storage Service'] || 0;
    const s3ByProject = {};
    for (const b of s3Buckets) {
      const bTags = s3TagMap[b.Name] || null;
      const projName = resolveProject(bTags, b.Name);
      if (!s3ByProject[projName]) s3ByProject[projName] = [];
      s3ByProject[projName].push(b.Name);
    }
    const totalBuckets = s3Buckets.length || 1;
    for (const [projName, bkts] of Object.entries(s3ByProject)) {
      const projS3CostMtd = s3CostMtd * (bkts.length / totalBuckets);
      addResource(projName, 'S3', bkts.length + ' buckets',
        bkts.slice(0, 3).map(b => b.substring(0, 35)).join(', ') + (bkts.length > 3 ? '...' : ''),
        projS3CostMtd);
    }

    // ── 5. ECS Clusters & Services ──
    for (const arn of ecsArns) {
      const clusterName = arn.split('/').pop();
      const clusterTags = ecsTagMap[arn] || null;
      const projName = resolveProject(clusterTags, clusterName);
      try {
        const svcList = await ecsClient.send(new ListServicesCommand({ cluster: clusterName }));
        const svcArns = svcList.serviceArns || [];
        if (svcArns.length > 0) {
          const svcDetails = await ecsClient.send(new DescribeServicesCommand({ cluster: clusterName, services: svcArns }));
          const services = svcDetails.services || [];
          const totalTasks = services.reduce((s, svc) => s + (svc.desiredCount || 0), 0);
          const ecsCostMtd = serviceCosts['Amazon Elastic Container Service'] || 0;
          addResource(projName, 'ECS', clusterName,
            services.length + ' services, ' + totalTasks + ' tasks', ecsCostMtd);
        }
      } catch { /* skip */ }
    }

    // ── 6. Load Balancers ──
    const elbCostMtd = serviceCosts['Amazon Elastic Load Balancing'] || 0;
    const elbCount = elbs.length || 1;
    for (const elb of elbs) {
      const elbTags = elbTagMap[elb.LoadBalancerArn] || null;
      const projName = resolveProject(elbTags, elb.LoadBalancerName);
      addResource(projName, 'ELB', elb.LoadBalancerName,
        elb.Type + ' load balancer', elbCostMtd / elbCount);
    }

    // ── 7. Service-level costs not yet attributed ──
    // serviceCosts are already normalized to estimated monthly (see above)
    // Skip services with no active resources (they'll appear in deletedResources instead)
    // Fallback: these services use dynamic imports and don't expose tags in list
    // responses, so we use name-based mapping until tag reading is added.
    const hasRds = rdsInstances && (rdsInstances.DBInstances || []).length > 0;
    const hasEcache = elasticacheClusters && (elasticacheClusters.CacheClusters || []).length > 0;
    const hasEcr = ecrRepos && (ecrRepos.repositories || []).length > 0;
    const hasCb = codebuildProjects && (codebuildProjects.projects || []).length > 0;
    const serviceProjectFallback = {
      ...(hasRds ? { 'Amazon Relational Database Service': 'Career Builder' } : {}),
      ...(hasEcache ? { 'Amazon ElastiCache': 'Career Builder' } : {}),
      ...(hasEcr ? { 'Amazon EC2 Container Registry (ECR)': 'Career Builder' } : {}),
      ...(hasCb ? { 'CodeBuild': 'Career Builder' } : {}),
      'AWS Secrets Manager': 'Career Builder',
      'Amazon Simple Email Service': 'Vedic Astro'
    };
    for (const [svcName, projName] of Object.entries(serviceProjectFallback)) {
      const cost = serviceCosts[svcName] || 0;
      if (cost < 0.001) continue;
      const mtd = serviceCostsMtd[svcName] || 0;
      const shortName = svcName.replace('Amazon ', '').replace('AWS ', '').split(' ')[0];
      addResource(projName, shortName, svcName, 'Est. monthly (MTD $' + r2(mtd) + ')', cost);
    }

    // Shared infra costs
    const sharedServices = ['Amazon Virtual Private Cloud', 'AmazonCloudWatch'];
    for (const svcName of sharedServices) {
      const cost = serviceCosts[svcName] || 0;
      if (cost < 0.001) continue;
      const mtd = serviceCostsMtd[svcName] || 0;
      const shortName = svcName.includes('VPC') ? 'VPC' : 'CloudWatch';
      addResource('Shared Infrastructure', shortName, svcName, 'Est. monthly (MTD $' + r2(mtd) + ')', cost);
    }

    // Tax — already kept as actual in serviceCosts (not projected)
    const taxCost = serviceCosts['Tax'] || 0;
    if (taxCost > 0) {
      addResource('Tax & Fees', 'Tax', 'AWS Tax', 'Account-level tax', taxCost);
    }

    // ── 8. EC2-Other costs (EBS, data transfer) — distribute proportionally to EC2 projects ──
    const ec2OtherCost = serviceCosts['EC2 - Other'] || 0;
    if (ec2OtherCost > 0) {
      const ec2OtherMtd = serviceCostsMtd['EC2 - Other'] || 0;
      const ec2Projects = Object.entries(projects).filter(([, p]) => p.serviceSet['EC2']);
      const totalEc2Cost = ec2Projects.reduce((s, [, p]) =>
        s + p.resources.filter(r => r.service === 'EC2').reduce((s2, r) => s2 + r.monthlyCost, 0), 0) || 1;
      for (const [, proj] of ec2Projects) {
        const projEc2Cost = proj.resources.filter(r => r.service === 'EC2').reduce((s, r) => s + r.monthlyCost, 0);
        const share = ec2OtherCost * (projEc2Cost / totalEc2Cost);
        if (share > 0.01) {
          const shareMtd = ec2OtherMtd * (projEc2Cost / totalEc2Cost);
          addResource(proj.name, 'EC2', 'EBS volumes & data transfer', 'Est. monthly (MTD $' + r2(shareMtd) + ')', share);
        }
      }
    }

    // ── Build final response ──
    const projectList = Object.values(projects).map(p => ({
      name: p.name,
      category: p.name === 'Tax & Fees' ? 'tax' : 'infra',
      serviceList: Object.keys(p.serviceSet).join(', '),
      resources: p.resources,
      total: r2(p.total),
      prevTotal: null
    })).sort((a, b) => b.total - a.total);

    const grandTotal = r2(projectList.reduce((s, p) => s + p.total, 0));

    // ── Dynamically detect deleted resources ──
    // If Cost Explorer shows charges for a service but no resources exist, it was deleted this month.
    const deletedResources = [];

    // Helper: checks for deleted service — cost charged but zero resources running
    const deletedChecks = [
      { svc: 'Amazon Relational Database Service', name: 'RDS Database(s)', type: 'RDS', data: rdsInstances, countKey: 'DBInstances' },
      { svc: 'Amazon ElastiCache', name: 'ElastiCache Cluster(s)', type: 'ElastiCache', data: elasticacheClusters, countKey: 'CacheClusters' },
      { svc: 'Amazon Elastic Container Service', name: 'ECS Cluster(s)', type: 'ECS Fargate', data: ecsClusters, countKey: 'clusterArns' },
      { svc: 'Amazon Elastic Load Balancing', name: 'Load Balancer(s)', type: 'ALB/NLB', data: loadBalancers, countKey: 'LoadBalancers' },
      { svc: 'Amazon EC2 Container Registry (ECR)', name: 'ECR Repositories', type: 'ECR', data: ecrRepos, countKey: 'repositories' },
      { svc: 'CodeBuild', name: 'CodeBuild Project(s)', type: 'CodeBuild', data: codebuildProjects, countKey: 'projects' }
    ];
    for (const chk of deletedChecks) {
      const mtd = serviceCostsMtd[chk.svc] || 0;
      const monthly = serviceCosts[chk.svc] || 0;
      // If data fetch failed (null), skip — we can't confirm deletion
      if (mtd > 0.01 && chk.data && (chk.data[chk.countKey] || []).length === 0) {
        deletedResources.push({
          name: chk.name, type: chk.type,
          project: inferProjectFromName(chk.name) !== 'AI Product Studio' ? inferProjectFromName(chk.name) : 'Career Builder',
          monthlySavings: monthly,
          reason: 'No active ' + chk.type + ' found but $' + r2(mtd) + ' charged MTD'
        });
      }
    }

    // NAT Gateways: VPC charges include NAT but no active NAT gateways
    const activeNats = (natGateways.NatGateways || []).length;
    const vpcMtd = serviceCostsMtd['Amazon Virtual Private Cloud'] || 0;
    // If VPC cost is high (>$5) but no NAT gateways, NATs were likely deleted
    if (vpcMtd > 5 && activeNats === 0) {
      // VPC cost without NAT is mostly public IPv4 ($3.65/IP) — estimate NAT portion
      const activeEips = (eipAddresses.Addresses || []).length;
      const ipCost = activeEips * 3.65;
      const natEstimate = r2(Math.max(0, (serviceCosts['Amazon Virtual Private Cloud'] || 0) - ipCost));
      if (natEstimate > 1) {
        deletedResources.push({ name: 'NAT Gateway(s)', type: 'NAT Gateway', project: 'Career Builder', monthlySavings: natEstimate, reason: 'No active NAT gateways but VPC charges suggest deleted NATs' });
      }
    }

    const totalMonthlySavings = r2(deletedResources.reduce((s, d) => s + d.monthlySavings, 0));
    // Current cost includes historical spend on deleted resources for this billing period
    // Projected next month = grandTotal minus savings from deletions
    const projectedNextMonth = r2(grandTotal - totalMonthlySavings);

    // MTD actual total for reference
    const grandTotalMtd = r2(Object.values(serviceCostsMtd).reduce((s, v) => s + v, 0));

    return jsonResponse(200, corsHeaders, {
      success: true,
      projects: projectList,
      grandTotal,
      grandTotalMtd,
      projectedNextMonth,
      totalMonthlySavings,
      deletedResources,
      period: { start: startDate, end: endDate, days: daysInPeriod, daysInMonth },
      serviceCosts: Object.fromEntries(
        Object.entries(serviceCosts).filter(([, v]) => v > 0.001).map(([k, v]) => [k, r2(v)])
      ),
      serviceCostsMtd: Object.fromEntries(
        Object.entries(serviceCostsMtd).filter(([, v]) => v > 0.001).map(([k, v]) => [k, r2(v)])
      )
    });
  } catch (error) {
    console.error('[AWS Project Costs Dynamic] Error:', error);
    return jsonResponse(500, corsHeaders, { success: false, error: error.message });
  }
}

// ---------------------------------------------------------------------------
// 12. handleAwsCostDailyByProject
// ---------------------------------------------------------------------------

/**
 * Returns daily cost broken down by project.
 * Queries Cost Explorer DAILY grouped by SERVICE, then maps each service
 * to a project using the same patterns as handleAwsProjectCostsDynamic.
 */
export async function handleAwsCostDailyByProject({ body, corsHeaders, ADMIN_PASSWORD }) {
  if (body.password !== ADMIN_PASSWORD) {
    return jsonResponse(401, corsHeaders, { success: false, error: 'Unauthorized' });
  }

  try {
    const startDate = body.startDate || monthStart(0);
    const endDate = body.endDate || today();

    // Fetch daily costs grouped by service + resource inventory in parallel
    const [costResult, ec2Instances, lambdaFunctions, buckets, distributions] = await Promise.all([
      ceClient.send(new GetCostAndUsageCommand({
        TimePeriod: { Start: startDate, End: endDate },
        Granularity: 'DAILY',
        Metrics: ['UnblendedCost'],
        GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }]
      })),
      fetchEC2Instances(),
      lambdaClient.send(new ListFunctionsCommand({ MaxItems: 200 })).catch(() => ({ Functions: [] })),
      s3Client.send(new ListBucketsCommand({})).catch(() => ({ Buckets: [] })),
      cfClient.send(new ListDistributionsCommand({ MaxItems: '100' })).catch(() => ({ DistributionList: { Items: [] } }))
    ]);

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

    // Build service → project mapping with cost proportions
    // EC2: map by instance tags/names
    const ec2ByProject = {};
    let ec2TotalCost = 0;
    for (const inst of ec2Instances) {
      const proj = resolveProject(inst.allTags, inst.name);
      const cost = inst.estimatedMonthlyCost || 0;
      ec2ByProject[proj] = (ec2ByProject[proj] || 0) + cost;
      ec2TotalCost += cost;
    }

    // Lambda: map by function tags/name
    const lambdaByProject = {};
    let lambdaTotalCount = 0;
    for (const fn of lambdaFns) {
      const fnTags = lambdaTagMap[fn.FunctionArn] || null;
      const proj = resolveProject(fnTags, fn.FunctionName);
      lambdaByProject[proj] = (lambdaByProject[proj] || 0) + 1;
      lambdaTotalCount++;
    }

    // S3: map by bucket tags/name
    const s3ByProject = {};
    let s3TotalCount = 0;
    for (const b of s3BucketList) {
      const bTags = s3TagMap[b.Name] || null;
      const proj = resolveProject(bTags, b.Name);
      s3ByProject[proj] = (s3ByProject[proj] || 0) + 1;
      s3TotalCount++;
    }

    // CloudFront: map by dist tags/origin/alias
    const cfByProject = {};
    let cfTotalCount = 0;
    for (const dist of cfDists) {
      const originDomain = dist.Origins?.Items?.[0]?.DomainName || '';
      const alias = dist.Aliases?.Items?.[0] || '';
      const distTags = cfTagMap[dist.ARN] || null;
      const proj = getProjectFromTags(distTags)
        || (inferProjectFromName(originDomain) !== 'AI Product Studio'
            ? inferProjectFromName(originDomain) : inferProjectFromName(alias || dist.DomainName));
      cfByProject[proj] = (cfByProject[proj] || 0) + 1;
      cfTotalCount++;
    }

    // Fixed service-to-project mappings
    const fixedServiceMap = {
      'Amazon Relational Database Service': 'Career Builder',
      'Amazon ElastiCache': 'Career Builder',
      'Amazon EC2 Container Registry (ECR)': 'Career Builder',
      'CodeBuild': 'Career Builder',
      'AWS Secrets Manager': 'Career Builder',
      'Amazon Simple Email Service': 'Vedic Astro',
      'Amazon Virtual Private Cloud': 'Shared Infrastructure',
      'AmazonCloudWatch': 'Shared Infrastructure',
      'Tax': 'Tax & Fees'
    };

    // Function to split a service's daily cost across projects
    function splitServiceCost(serviceName, cost) {
      // Check fixed mapping first
      if (fixedServiceMap[serviceName]) {
        return { [fixedServiceMap[serviceName]]: cost };
      }

      // EC2
      if (serviceName === 'Amazon Elastic Compute Cloud - Compute' || serviceName === 'EC2 - Other') {
        if (ec2TotalCost <= 0) return { 'AI Product Studio': cost };
        const result = {};
        for (const [proj, projCost] of Object.entries(ec2ByProject)) {
          result[proj] = r2(cost * (projCost / ec2TotalCost));
        }
        return result;
      }

      // Lambda
      if (serviceName === 'AWS Lambda') {
        if (lambdaTotalCount <= 0) return { 'AI Product Studio': cost };
        const result = {};
        for (const [proj, count] of Object.entries(lambdaByProject)) {
          result[proj] = r2(cost * (count / lambdaTotalCount));
        }
        return result;
      }

      // S3
      if (serviceName === 'Amazon Simple Storage Service') {
        if (s3TotalCount <= 0) return { 'AI Product Studio': cost };
        const result = {};
        for (const [proj, count] of Object.entries(s3ByProject)) {
          result[proj] = r2(cost * (count / s3TotalCount));
        }
        return result;
      }

      // CloudFront
      if (serviceName === 'Amazon CloudFront') {
        if (cfTotalCount <= 0) return { 'AI Product Studio': cost };
        const result = {};
        for (const [proj, count] of Object.entries(cfByProject)) {
          result[proj] = r2(cost * (count / cfTotalCount));
        }
        return result;
      }

      // ELB
      if (serviceName === 'Amazon Elastic Load Balancing') {
        return { 'Career Builder': cost }; // Only Career Builder uses ELB
      }

      // Default: attribute to AI Product Studio
      return { 'AI Product Studio': cost };
    }

    // Process daily data
    const dates = [];
    const dailyByProject = {}; // { "Career Builder": [cost_day1, cost_day2, ...], ... }

    for (const tp of costResult.ResultsByTime || []) {
      const date = tp.TimePeriod.Start;
      dates.push(date);
      const dayIdx = dates.length - 1;

      for (const group of tp.Groups || []) {
        const service = group.Keys[0];
        const cost = parseFloat(group.Metrics.UnblendedCost.Amount) || 0;
        if (cost < 0.001) continue;

        const projectSplit = splitServiceCost(service, cost);
        for (const [proj, projCost] of Object.entries(projectSplit)) {
          if (!dailyByProject[proj]) dailyByProject[proj] = new Array(dates.length).fill(0);
          // Extend array if needed
          while (dailyByProject[proj].length < dates.length) dailyByProject[proj].push(0);
          dailyByProject[proj][dayIdx] += projCost;
        }
      }

      // Ensure all projects have entries for this day
      for (const proj of Object.keys(dailyByProject)) {
        while (dailyByProject[proj].length < dates.length) dailyByProject[proj].push(0);
      }
    }

    // Round all values
    for (const proj of Object.keys(dailyByProject)) {
      dailyByProject[proj] = dailyByProject[proj].map(v => r2(v));
    }

    return jsonResponse(200, corsHeaders, {
      success: true,
      dates,
      dailyByProject
    });
  } catch (error) {
    console.error('[AWS Cost Daily By Project] Error:', error);
    return jsonResponse(500, corsHeaders, { success: false, error: error.message });
  }
}

// ---------------------------------------------------------------------------
// 13. handleAwsActivityLog
// ---------------------------------------------------------------------------

/**
 * Queries CloudTrail for recent IAM user/role activity.
 * Returns events grouped by user with action summaries.
 */
export async function handleAwsActivityLog({ body, corsHeaders, ADMIN_PASSWORD }) {
  if (body.password !== ADMIN_PASSWORD) {
    return jsonResponse(401, corsHeaders, { success: false, error: 'Unauthorized' });
  }

  try {
    const days = Math.min(Math.max(parseInt(body.days) || 1, 1), 90);
    const filterUsername = body.username || null;

    const endTime = new Date();
    const startTime = new Date();
    startTime.setDate(startTime.getDate() - days);

    let allEvents = [];
    let nextToken;
    let pages = 0;

    do {
      const params = { StartTime: startTime, EndTime: endTime, MaxResults: 50 };
      if (nextToken) params.NextToken = nextToken;
      if (filterUsername) {
        params.LookupAttributes = [{ AttributeKey: 'Username', AttributeValue: filterUsername }];
      }
      const result = await ctClient.send(new LookupEventsCommand(params));
      allEvents = allEvents.concat(result.Events || []);
      nextToken = result.NextToken;
      pages++;
    } while (nextToken && pages < 4);

    const NOISY = new Set([
      'LookupEvents', 'GetCallerIdentity', 'AssumeRole', 'Decrypt',
      'GenerateDataKey', 'ListInstanceAssociations', 'UpdateInstanceInformation',
      'DescribeInstanceStatus', 'GetServiceQuota', 'BatchGetSecretValue'
    ]);
    const filtered = allEvents.filter(e => !NOISY.has(e.EventName));

    const byUser = {};
    const byService = {};
    const timeline = [];

    for (const ev of filtered) {
      const username = ev.Username || 'unknown';
      const eventName = ev.EventName;
      const source = (ev.EventSource || '').replace('.amazonaws.com', '');
      const time = ev.EventTime ? new Date(ev.EventTime).toISOString() : '';
      const isWrite = !eventName.startsWith('Describe') && !eventName.startsWith('List') &&
                      !eventName.startsWith('Get') && !eventName.startsWith('Lookup') &&
                      !eventName.startsWith('Check') && !eventName.startsWith('Head');

      let resources = [];
      try {
        const detail = JSON.parse(ev.CloudTrailEvent || '{}');
        resources = (detail.resources || []).map(r => r.resourceName || r.ARN || '').filter(Boolean);
      } catch { /* ignore */ }

      if (!byUser[username]) {
        byUser[username] = { total: 0, writes: 0, reads: 0, services: {}, recentActions: [] };
      }
      byUser[username].total++;
      if (isWrite) byUser[username].writes++;
      else byUser[username].reads++;
      byUser[username].services[source] = (byUser[username].services[source] || 0) + 1;
      if (byUser[username].recentActions.length < 20) {
        byUser[username].recentActions.push({ time, action: eventName, service: source, isWrite, resources: resources.slice(0, 3) });
      }

      byService[source] = (byService[source] || 0) + 1;

      if (timeline.length < 50) {
        timeline.push({ time, username, action: eventName, service: source, isWrite, resources: resources.slice(0, 2) });
      }
    }

    const users = Object.entries(byUser).map(([name, data]) => ({
      username: name,
      totalEvents: data.total,
      writeEvents: data.writes,
      readEvents: data.reads,
      topServices: Object.entries(data.services).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([s, c]) => ({ service: s, count: c })),
      recentActions: data.recentActions
    })).sort((a, b) => b.totalEvents - a.totalEvents);

    const topServices = Object.entries(byService).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([service, count]) => ({ service, count }));

    return jsonResponse(200, corsHeaders, {
      success: true,
      data: { users, topServices, timeline, totalEvents: filtered.length, period: { start: startTime.toISOString(), end: endTime.toISOString(), days } }
    });
  } catch (error) {
    console.error('[AWS Activity Log] Error:', error);
    return jsonResponse(500, corsHeaders, { success: false, error: error.message });
  }
}

// ---------------------------------------------------------------------------
// 13. handleAwsActivityEmailReport
// ---------------------------------------------------------------------------

export async function handleAwsActivityEmailReport({ body, corsHeaders, ADMIN_PASSWORD }) {
  if (body.password !== ADMIN_PASSWORD) {
    return jsonResponse(401, corsHeaders, { success: false, error: 'Unauthorized' });
  }

  try {
    const { SESClient, SendEmailCommand } = await import('@aws-sdk/client-ses');
    const ses = new SESClient({ region: 'us-east-1' });

    const reportType = body.reportType || 'daily';
    const fromEmail = process.env.FROM_EMAIL || process.env.NOTIFICATION_EMAIL;
    const toEmails = body.email
      ? [body.email]
      : (process.env.NOTIFICATION_EMAILS || process.env.NOTIFICATION_EMAIL || '').split(':').filter(Boolean);

    if (!fromEmail || toEmails.length === 0) {
      return jsonResponse(400, corsHeaders, { success: false, error: 'Email not configured' });
    }

    const days = reportType === 'monthly' ? 30 : reportType === 'weekly' ? 7 : 1;
    const endTime = new Date();
    const startTime = new Date();
    startTime.setDate(startTime.getDate() - days);

    // ── Fetch CloudTrail + Cost + Unused Resources in parallel ──
    const todayStr = today();
    const yesterdayDate = new Date(); yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
    const yesterdayStr = yesterdayDate.toISOString().slice(0, 10);
    const dayBeforeDate = new Date(); dayBeforeDate.setUTCDate(dayBeforeDate.getUTCDate() - 2);
    const dayBeforeStr = dayBeforeDate.toISOString().slice(0, 10);
    const mtdStart = monthStart(0);
    const prevMtdStart = monthStart(1);
    const prevMtdEnd = mtdStart;

    // ── Try CUR data first (free), fall back to CE API ($0.04) ──
    let emailCurRows = null;
    try {
      emailCurRows = await loadAllCurData();
      if (emailCurRows.length === 0) emailCurRows = null;
    } catch (e) {
      console.log('[EmailReport] CUR not available, using CE API fallback');
      emailCurRows = null;
    }
    const emailUseCur = emailCurRows !== null;

    const [
      cloudTrailResult,
      yesterdayCost,
      dayBeforeCost,
      mtdCost,
      prevMtdCost,
      volumesResult,
      snapshotsResult,
      addressesResult
    ] = await Promise.all([
      // CloudTrail events
      (async () => {
        let allEvents = []; let nextToken; let pg = 0;
        do {
          const params = { StartTime: startTime, EndTime: endTime, MaxResults: 50 };
          if (nextToken) params.NextToken = nextToken;
          const result = await ctClient.send(new LookupEventsCommand(params));
          allEvents = allEvents.concat(result.Events || []);
          nextToken = result.NextToken; pg++;
        } while (nextToken && pg < 6);
        return allEvents;
      })(),
      // Yesterday cost by service — CUR or CE API
      emailUseCur
        ? curToCeFormat(emailCurRows, yesterdayStr, todayStr, 'DAILY', ['SERVICE'], ['UnblendedCost'])
        : ceClient.send(new GetCostAndUsageCommand({
            TimePeriod: { Start: yesterdayStr, End: todayStr },
            Granularity: 'DAILY', Metrics: ['UnblendedCost'],
            GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }]
          })).catch(() => null),
      // Day before yesterday cost — CUR or CE API
      emailUseCur
        ? curToCeFormat(emailCurRows, dayBeforeStr, yesterdayStr, 'DAILY', ['SERVICE'], ['UnblendedCost'])
        : ceClient.send(new GetCostAndUsageCommand({
            TimePeriod: { Start: dayBeforeStr, End: yesterdayStr },
            Granularity: 'DAILY', Metrics: ['UnblendedCost'],
            GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }]
          })).catch(() => null),
      // Month-to-date cost by service — CUR or CE API
      emailUseCur
        ? curToCeFormat(emailCurRows, mtdStart, todayStr, 'MONTHLY', ['SERVICE'], ['UnblendedCost'])
        : ceClient.send(new GetCostAndUsageCommand({
            TimePeriod: { Start: mtdStart, End: todayStr },
            Granularity: 'MONTHLY', Metrics: ['UnblendedCost'],
            GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }]
          })).catch(() => null),
      // Previous month cost — CUR or CE API
      emailUseCur
        ? (function() {
            const r = curToCeFormat(emailCurRows, prevMtdStart, prevMtdEnd, 'MONTHLY', ['SERVICE'], ['UnblendedCost']);
            const total = (r.ResultsByTime || []).reduce((s, tp) =>
              s + (tp.Groups || []).reduce((s2, g) => s2 + (parseFloat(g.Metrics.UnblendedCost.Amount) || 0), 0), 0);
            return { ResultsByTime: [{ TimePeriod: { Start: prevMtdStart, End: prevMtdEnd }, Total: { UnblendedCost: { Amount: String(total) } }, Groups: [] }] };
          })()
        : ceClient.send(new GetCostAndUsageCommand({
            TimePeriod: { Start: prevMtdStart, End: prevMtdEnd },
            Granularity: 'MONTHLY', Metrics: ['UnblendedCost']
          })).catch(() => null),
      // Unattached volumes
      ec2Client.send(new DescribeVolumesCommand({ Filters: [{ Name: 'status', Values: ['available'] }] })).catch(() => ({ Volumes: [] })),
      // Old snapshots
      ec2Client.send(new DescribeSnapshotsCommand({ OwnerIds: ['self'] })).catch(() => ({ Snapshots: [] })),
      // Elastic IPs
      ec2Client.send(new DescribeAddressesCommand({})).catch(() => ({ Addresses: [] }))
    ]);

    // ── Parse cost data ──
    function parseCostGroups(result) {
      const byService = {};
      let total = 0;
      for (const tp of (result?.ResultsByTime || [])) {
        for (const g of (tp.Groups || [])) {
          const svc = g.Keys[0];
          const cost = parseFloat(g.Metrics.UnblendedCost.Amount) || 0;
          byService[svc] = (byService[svc] || 0) + cost;
          total += cost;
        }
      }
      return { byService, total: r2(total) };
    }

    const yesterday = parseCostGroups(yesterdayCost);
    const dayBefore = parseCostGroups(dayBeforeCost);
    const mtd = parseCostGroups(mtdCost);
    const prevMtdTotal = r2((prevMtdCost?.ResultsByTime || []).reduce((s, tp) => s + parseFloat(tp.Total?.UnblendedCost?.Amount || 0), 0));

    const costDiff = r2(yesterday.total - dayBefore.total);
    const costDiffPct = dayBefore.total > 0 ? r2((costDiff / dayBefore.total) * 100) : 0;
    const daysElapsed = daysBetween(mtdStart, todayStr) || 1;
    const projectedMonth = r2((mtd.total / daysElapsed) * 30);

    // Top 5 services by MTD cost
    const topServices = Object.entries(mtd.byService)
      .filter(([, v]) => v > 0.01)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([svc, cost]) => ({ svc, cost: r2(cost), pct: r2((cost / mtd.total) * 100) }));

    // Yesterday vs day-before per-service delta (top movers)
    const allSvcs = new Set([...Object.keys(yesterday.byService), ...Object.keys(dayBefore.byService)]);
    const svcDeltas = [];
    for (const svc of allSvcs) {
      const yCost = yesterday.byService[svc] || 0;
      const dbCost = dayBefore.byService[svc] || 0;
      const delta = r2(yCost - dbCost);
      if (Math.abs(delta) > 0.01) svcDeltas.push({ svc, yCost: r2(yCost), dbCost: r2(dbCost), delta });
    }
    svcDeltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    // ── Parse unused resources ──
    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const unusedVolumes = (volumesResult.Volumes || []).map(v => {
      const tags = {}; for (const t of v.Tags || []) tags[t.Key] = t.Value;
      return { id: v.VolumeId, name: tags.Name || v.VolumeId, size: v.Size, type: v.VolumeType, monthlyCost: r2((v.Size || 0) * 0.10) };
    });
    const oldSnapshots = (snapshotsResult.Snapshots || [])
      .filter(s => s.StartTime && new Date(s.StartTime) < thirtyDaysAgo)
      .map(s => {
        const tags = {}; for (const t of s.Tags || []) tags[t.Key] = t.Value;
        return { id: s.SnapshotId, name: tags.Name || s.SnapshotId, size: s.VolumeSize, age: Math.floor((Date.now() - new Date(s.StartTime).getTime()) / 86400000) + 'd', monthlyCost: r2((s.VolumeSize || 0) * 0.05) };
      });
    const unusedEIPs = (addressesResult.Addresses || [])
      .filter(a => !a.AssociationId)
      .map(a => {
        const tags = {}; for (const t of a.Tags || []) tags[t.Key] = t.Value;
        return { id: a.AllocationId, ip: a.PublicIp, name: tags.Name || a.PublicIp, monthlyCost: r2(0.005 * 730) };
      });
    const totalWaste = r2(unusedVolumes.reduce((s, v) => s + v.monthlyCost, 0) + oldSnapshots.reduce((s, v) => s + v.monthlyCost, 0) + unusedEIPs.reduce((s, v) => s + v.monthlyCost, 0));
    const totalUnused = unusedVolumes.length + oldSnapshots.length + unusedEIPs.length;

    // ── Deleted resources & savings ──
    const deletedResources = [
      { name: 'cocreate-ai', type: 'EC2 Instance', deletedDate: '2026-02-23', monthlySavings: 30.37, reason: 'Unused - replaced by cocreate-ai-v2' },
      { name: 'E14I9XAUA0S9U2', type: 'CloudFront Dist', deletedDate: '2026-02-23', monthlySavings: 0.50, reason: 'Orphaned distribution' },
      { name: 'EZ36TIJU0ARM5', type: 'CloudFront Dist', deletedDate: '2026-02-23', monthlySavings: 0.50, reason: 'Orphaned distribution' }
    ];
    const totalSavings = r2(deletedResources.reduce((s, d) => s + d.monthlySavings, 0));

    // ── Parse CloudTrail events ──
    const NOISY = new Set([
      'LookupEvents', 'GetCallerIdentity', 'AssumeRole', 'Decrypt',
      'GenerateDataKey', 'ListInstanceAssociations', 'UpdateInstanceInformation',
      'DescribeInstanceStatus', 'GetServiceQuota', 'BatchGetSecretValue'
    ]);
    const events = cloudTrailResult.filter(e => !NOISY.has(e.EventName));
    const byUser = {};
    const writeActions = [];
    for (const ev of events) {
      const u = ev.Username || 'unknown';
      const isWrite = !ev.EventName.startsWith('Describe') && !ev.EventName.startsWith('List') &&
                      !ev.EventName.startsWith('Get') && !ev.EventName.startsWith('Lookup');
      if (!byUser[u]) byUser[u] = { total: 0, writes: 0 };
      byUser[u].total++;
      if (isWrite) { byUser[u].writes++; if (writeActions.length < 30) writeActions.push({ time: ev.EventTime ? new Date(ev.EventTime).toISOString() : '', user: u, action: ev.EventName, service: (ev.EventSource || '').replace('.amazonaws.com', '') }); }
    }

    const periodLabel = reportType === 'monthly'
      ? monthStart(0).slice(0, 7) + ' (Last 30 days)'
      : reportType === 'weekly'
      ? startTime.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' - ' + endTime.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : endTime.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    const title = reportType === 'monthly' ? 'Monthly AWS Report' : reportType === 'weekly' ? 'Weekly AWS Report' : 'Daily AWS Report';

    // ── HTML Email Styles ──
    const S = {
      card: 'background:rgba(255,255,255,0.05);padding:16px;border-radius:12px;text-align:center',
      bigNum: 'font-size:28px;font-weight:700',
      label: 'font-size:12px;color:#94a3b8;margin-top:4px',
      sectionTitle: 'color:#e2e8f0;margin:24px 0 12px;font-size:16px;border-bottom:1px solid #333;padding-bottom:8px',
      th: 'padding:8px 12px;text-align:left;color:#94a3b8;font-size:12px;border-bottom:2px solid #333',
      thR: 'padding:8px 12px;text-align:right;color:#94a3b8;font-size:12px;border-bottom:2px solid #333',
      td: 'padding:8px 12px;border-bottom:1px solid #333;font-size:13px',
      tdR: 'padding:8px 12px;border-bottom:1px solid #333;font-size:13px;text-align:right',
      green: '#4ade80', red: '#f87171', purple: '#818cf8', yellow: '#fbbf24', cyan: '#22d3ee'
    };
    const up = (v) => v > 0 ? '<span style="color:' + S.red + '">+$' + Math.abs(v).toFixed(2) + ' &#9650;</span>' : v < 0 ? '<span style="color:' + S.green + '">-$' + Math.abs(v).toFixed(2) + ' &#9660;</span>' : '<span style="color:#94a3b8">$0.00</span>';

    // ── Build HTML sections ──

    // 1. Cost KPI cards
    const costKpis = '<div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">' +
      '<div style="flex:1;min-width:130px;' + S.card + '"><div style="' + S.bigNum + ';color:' + S.purple + '">$' + yesterday.total + '</div><div style="' + S.label + '">Yesterday</div><div style="font-size:11px;margin-top:4px">' + up(costDiff) + ' vs day before</div></div>' +
      '<div style="flex:1;min-width:130px;' + S.card + '"><div style="' + S.bigNum + ';color:' + S.cyan + '">$' + mtd.total + '</div><div style="' + S.label + '">Month to Date</div></div>' +
      '<div style="flex:1;min-width:130px;' + S.card + '"><div style="' + S.bigNum + ';color:' + S.yellow + '">$' + projectedMonth + '</div><div style="' + S.label + '">Projected Month</div></div>' +
      '<div style="flex:1;min-width:130px;' + S.card + '"><div style="' + S.bigNum + ';color:#94a3b8">$' + prevMtdTotal + '</div><div style="' + S.label + '">Last Month Total</div></div>' +
      '</div>';

    // 2. Yesterday vs day-before comparison
    const comparisonRows = svcDeltas.slice(0, 8).map(d =>
      '<tr><td style="' + S.td + '">' + d.svc.replace('Amazon ', '').replace('AWS ', '') + '</td>' +
      '<td style="' + S.tdR + '">$' + d.dbCost + '</td>' +
      '<td style="' + S.tdR + '">$' + d.yCost + '</td>' +
      '<td style="' + S.tdR + '">' + up(d.delta) + '</td></tr>'
    ).join('');
    const comparisonSection = svcDeltas.length > 0
      ? '<h3 style="' + S.sectionTitle + '">Yesterday vs Day Before - Cost Changes</h3>' +
        '<table style="width:100%;border-collapse:collapse"><thead><tr><th style="' + S.th + '">Service</th><th style="' + S.thR + '">' + dayBeforeStr.slice(5) + '</th><th style="' + S.thR + '">' + yesterdayStr.slice(5) + '</th><th style="' + S.thR + '">Change</th></tr></thead><tbody>' + comparisonRows +
        '<tr style="font-weight:700"><td style="' + S.td + '">TOTAL</td><td style="' + S.tdR + '">$' + dayBefore.total + '</td><td style="' + S.tdR + '">$' + yesterday.total + '</td><td style="' + S.tdR + '">' + up(costDiff) + '</td></tr>' +
        '</tbody></table>'
      : '';

    // 3. Top services MTD
    const topSvcRows = topServices.map(s =>
      '<tr><td style="' + S.td + '">' + s.svc.replace('Amazon ', '').replace('AWS ', '') + '</td>' +
      '<td style="' + S.tdR + '">$' + s.cost + '</td>' +
      '<td style="' + S.tdR + '">' + s.pct + '%</td></tr>'
    ).join('');
    const topSvcSection = '<h3 style="' + S.sectionTitle + '">Top 5 Services (Month to Date)</h3>' +
      '<table style="width:100%;border-collapse:collapse"><thead><tr><th style="' + S.th + '">Service</th><th style="' + S.thR + '">Cost</th><th style="' + S.thR + '">% of Total</th></tr></thead><tbody>' + topSvcRows + '</tbody></table>';

    // 4. Savings from deleted resources
    const savingsSection = totalSavings > 0
      ? '<h3 style="' + S.sectionTitle + '">Recently Deleted - Monthly Savings: <span style="color:' + S.green + '">$' + totalSavings + '/mo</span></h3>' +
        '<table style="width:100%;border-collapse:collapse"><thead><tr><th style="' + S.th + '">Resource</th><th style="' + S.th + '">Type</th><th style="' + S.thR + '">Savings</th><th style="' + S.th + '">Reason</th></tr></thead><tbody>' +
        deletedResources.map(d => '<tr><td style="' + S.td + '">' + d.name + '</td><td style="' + S.td + '">' + d.type + '</td><td style="' + S.tdR + ';color:' + S.green + '">$' + d.monthlySavings + '</td><td style="' + S.td + ';font-size:11px;color:#94a3b8">' + d.reason + '</td></tr>').join('') +
        '</tbody></table>'
      : '';

    // 5. Cleanup recommendations
    let cleanupSection = '';
    if (totalUnused > 0) {
      cleanupSection = '<h3 style="' + S.sectionTitle + '">&#9888; Cleanup Recommendations - Potential Savings: <span style="color:' + S.yellow + '">$' + totalWaste + '/mo</span></h3>';
      if (unusedVolumes.length > 0) {
        cleanupSection += '<h4 style="color:#e2e8f0;margin:12px 0 8px;font-size:14px">Unattached EBS Volumes (' + unusedVolumes.length + ')</h4>' +
          '<table style="width:100%;border-collapse:collapse"><thead><tr><th style="' + S.th + '">Volume</th><th style="' + S.thR + '">Size</th><th style="' + S.th + '">Type</th><th style="' + S.thR + '">Cost/mo</th></tr></thead><tbody>' +
          unusedVolumes.map(v => '<tr><td style="' + S.td + ';font-size:12px">' + v.name + '</td><td style="' + S.tdR + '">' + v.size + ' GB</td><td style="' + S.td + '">' + v.type + '</td><td style="' + S.tdR + ';color:' + S.yellow + '">$' + v.monthlyCost + '</td></tr>').join('') +
          '</tbody></table>';
      }
      if (oldSnapshots.length > 0) {
        const snapTotal = r2(oldSnapshots.reduce((s, v) => s + v.monthlyCost, 0));
        cleanupSection += '<h4 style="color:#e2e8f0;margin:12px 0 8px;font-size:14px">Old Snapshots >30 days (' + oldSnapshots.length + ') - $' + snapTotal + '/mo</h4>' +
          '<table style="width:100%;border-collapse:collapse"><thead><tr><th style="' + S.th + '">Snapshot</th><th style="' + S.thR + '">Size</th><th style="' + S.thR + '">Age</th><th style="' + S.thR + '">Cost/mo</th></tr></thead><tbody>' +
          oldSnapshots.slice(0, 10).map(s => '<tr><td style="' + S.td + ';font-size:12px">' + s.name + '</td><td style="' + S.tdR + '">' + s.size + ' GB</td><td style="' + S.tdR + '">' + s.age + '</td><td style="' + S.tdR + ';color:' + S.yellow + '">$' + s.monthlyCost + '</td></tr>').join('') +
          (oldSnapshots.length > 10 ? '<tr><td colspan="4" style="' + S.td + ';text-align:center;color:#94a3b8">+ ' + (oldSnapshots.length - 10) + ' more snapshots</td></tr>' : '') +
          '</tbody></table>';
      }
      if (unusedEIPs.length > 0) {
        cleanupSection += '<h4 style="color:#e2e8f0;margin:12px 0 8px;font-size:14px">Unused Elastic IPs (' + unusedEIPs.length + ')</h4>' +
          '<table style="width:100%;border-collapse:collapse"><thead><tr><th style="' + S.th + '">IP Address</th><th style="' + S.th + '">Name</th><th style="' + S.thR + '">Cost/mo</th></tr></thead><tbody>' +
          unusedEIPs.map(e => '<tr><td style="' + S.td + '">' + e.ip + '</td><td style="' + S.td + '">' + e.name + '</td><td style="' + S.tdR + ';color:' + S.yellow + '">$' + e.monthlyCost + '</td></tr>').join('') +
          '</tbody></table>';
      }
    } else {
      cleanupSection = '<h3 style="' + S.sectionTitle + '">&#9989; No Orphaned Resources Found</h3>' +
        '<p style="color:' + S.green + ';text-align:center;font-size:14px">All volumes attached, no old snapshots, no unused Elastic IPs</p>';
    }

    // 6. Activity section
    const userRows = Object.entries(byUser).sort((a, b) => b[1].total - a[1].total)
      .map(([name, d]) => '<tr><td style="' + S.td + '">' + name + '</td><td style="' + S.tdR + '">' + d.total + '</td><td style="' + S.tdR + ';color:' + (d.writes > 0 ? S.red : S.green) + '">' + d.writes + '</td></tr>')
      .join('');
    const actionRows = writeActions.slice(0, 15)
      .map(a => '<tr><td style="' + S.td + ';font-size:12px">' + new Date(a.time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) + '</td><td style="' + S.td + ';font-size:12px">' + a.user + '</td><td style="' + S.td + ';font-size:12px;color:' + S.purple + '">' + a.action + '</td><td style="' + S.td + ';font-size:12px">' + a.service + '</td></tr>')
      .join('');

    const activitySection = '<h3 style="' + S.sectionTitle + '">User Activity (' + events.length + ' events)</h3>' +
      '<table style="width:100%;border-collapse:collapse;margin-bottom:16px"><thead><tr><th style="' + S.th + '">User</th><th style="' + S.thR + '">Events</th><th style="' + S.thR + '">Writes</th></tr></thead><tbody>' + userRows + '</tbody></table>' +
      (writeActions.length > 0 ? '<h4 style="color:#e2e8f0;margin:12px 0 8px;font-size:14px">Recent Write Actions</h4><table style="width:100%;border-collapse:collapse"><thead><tr><th style="' + S.th + '">Time</th><th style="' + S.th + '">User</th><th style="' + S.th + '">Action</th><th style="' + S.th + '">Service</th></tr></thead><tbody>' + actionRows + '</tbody></table>' : '');

    // ── Assemble full email ──
    const html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#0a0a0f;color:#e2e8f0;font-family:system-ui,sans-serif">' +
      '<div style="max-width:680px;margin:0 auto;padding:24px">' +
      '<div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:24px;border-radius:16px 16px 0 0;text-align:center">' +
      '<h1 style="margin:0;font-size:22px;color:#fff">' + title + '</h1>' +
      '<p style="margin:4px 0 0;font-size:14px;color:rgba(255,255,255,0.8)">' + periodLabel + '</p></div>' +
      '<div style="background:#1a1a2e;padding:24px;border-radius:0 0 16px 16px">' +
      costKpis +
      comparisonSection +
      topSvcSection +
      savingsSection +
      cleanupSection +
      activitySection +
      '<div style="margin-top:24px;padding:12px;background:rgba(99,102,241,0.1);border-radius:8px;text-align:center"><a href="https://www.cocreateidea.com/awscost.html" style="color:#818cf8;text-decoration:none;font-size:14px">View Full Dashboard &#8594;</a></div>' +
      '</div></div></body></html>';

    const textContent = title + ' - ' + periodLabel +
      '\n\nCOST SUMMARY' +
      '\nYesterday: $' + yesterday.total + ' (' + (costDiff >= 0 ? '+' : '') + '$' + costDiff + ' vs day before)' +
      '\nMonth to Date: $' + mtd.total + ' | Projected: $' + projectedMonth + ' | Last Month: $' + prevMtdTotal +
      '\n\nTOP SERVICES: ' + topServices.map(s => s.svc + ': $' + s.cost).join(', ') +
      (totalSavings > 0 ? '\n\nSAVINGS: $' + totalSavings + '/mo from deleted resources' : '') +
      (totalUnused > 0 ? '\n\nCLEANUP: ' + totalUnused + ' unused resources wasting $' + totalWaste + '/mo' : '\n\nCLEANUP: No orphaned resources found') +
      '\n\nACTIVITY: ' + events.length + ' events | ' + writeActions.length + ' writes | ' + Object.keys(byUser).length + ' users';

    // Send to all recipients
    const sent = [];
    const failed = [];
    for (const recipient of toEmails) {
      try {
        await ses.send(new SendEmailCommand({
          Source: fromEmail,
          Destination: { ToAddresses: [recipient] },
          Message: {
            Subject: { Data: title + ' | $' + yesterday.total + ' yesterday | $' + mtd.total + ' MTD - ' + periodLabel, Charset: 'UTF-8' },
            Body: { Html: { Data: html, Charset: 'UTF-8' }, Text: { Data: textContent, Charset: 'UTF-8' } }
          }
        }));
        sent.push(recipient);
      } catch (emailErr) {
        console.warn('[AWS Email Report] Failed to send to', recipient, emailErr.message);
        failed.push({ email: recipient, error: emailErr.message });
      }
    }

    return jsonResponse(200, corsHeaders, { success: true, message: title + ' sent to ' + sent.join(', ') + (failed.length > 0 ? ' (failed: ' + failed.map(f => f.email).join(', ') + ')' : ''), sent, failed, summary: { totalEvents: events.length, writeActions: writeActions.length, users: Object.keys(byUser).length, yesterdayCost: yesterday.total, mtdCost: mtd.total, unusedResources: totalUnused, potentialSavings: totalWaste } });
  } catch (error) {
    console.error('[AWS Activity Email] Error:', error);
    return jsonResponse(500, corsHeaders, { success: false, error: error.message });
  }
}

// ---------------------------------------------------------------------------
// Batch 1: handleAwsCostDashboardBatch
// ---------------------------------------------------------------------------

/**
 * Merges 7 dashboard endpoints into 1 batch call:
 *   summary, daily, dailyByService, forecast, serviceDetail, projectCosts, dailyByProject
 * Fetches shared AWS data once, computes all views from the same data.
 */
export async function handleAwsCostDashboardBatch({ body, corsHeaders, ADMIN_PASSWORD }) {
  if (body.password !== ADMIN_PASSWORD) {
    return jsonResponse(401, corsHeaders, { success: false, error: 'Unauthorized' });
  }

  try {
    const startDate = body.startDate || monthStart(0);
    const endDate = body.endDate || today();
    const todayStr = today();
    const daysInPeriod = daysBetween(startDate, endDate) || 1;

    // Previous period for summary MoM comparison
    const periodDays = daysBetween(startDate, endDate);
    const prevEnd = startDate;
    const prevStartD = new Date(prevEnd);
    prevStartD.setUTCDate(prevStartD.getUTCDate() - periodDays);
    const prevStart = prevStartD.toISOString().slice(0, 10);

    // Forecast end date
    const todayD = new Date(todayStr + 'T00:00:00Z');
    const forecastEnd = new Date(Date.UTC(todayD.getUTCFullYear(), todayD.getUTCMonth() + 1, 1));
    const forecastEndStr = forecastEnd.toISOString().slice(0, 10);

    const safeImport = (mod, factory) => import(mod).then(factory).catch(() => null);

    // ── Try CUR data first (free), fall back to CE API ($0.06) ──
    let curRows = null;
    try {
      curRows = await loadAllCurData();
      if (curRows.length === 0) curRows = null;
    } catch (e) {
      console.log('[Batch] CUR not available, using CE API fallback:', e.message);
      curRows = null;
    }
    const useCur = curRows !== null;
    if (useCur) console.log('[Batch] Using CUR data (' + curRows.length + ' rows) — $0.00 cost');
    else console.log('[Batch] Using CE API — $0.06 cost');

    // ── Fetch all shared data in one parallel batch ──
    const [
      ceSummaryCurrent, ceSummaryPrevious, ceDailyByService6mo,
      ceServiceUsage, ceDailyByService, ceForecast,
      ec2Instances, distributions, lambdaFunctions, buckets,
      ecsClusters, loadBalancers, natGateways, eipAddresses,
      rdsInstances, elasticacheClusters, codebuildProjects, ecrRepos
    ] = await Promise.all([
      // Cost data: CUR (free) or CE API ($0.01 each)
      useCur
        ? curToCeFormat(curRows, startDate, endDate, 'MONTHLY', ['SERVICE'], ['UnblendedCost'])
        : ceClient.send(new GetCostAndUsageCommand({
            TimePeriod: { Start: startDate, End: endDate }, Granularity: 'MONTHLY',
            Metrics: ['UnblendedCost'], GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }]
          })),
      useCur
        ? curToCeFormat(curRows, prevStart, prevEnd, 'MONTHLY', ['SERVICE'], ['UnblendedCost'])
        : ceClient.send(new GetCostAndUsageCommand({
            TimePeriod: { Start: prevStart, End: prevEnd }, Granularity: 'MONTHLY',
            Metrics: ['UnblendedCost'], GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }]
          })),
      useCur
        ? curToCeFormat(curRows, monthStart(6), todayStr, 'MONTHLY', ['SERVICE'], ['UnblendedCost'])
        : ceClient.send(new GetCostAndUsageCommand({
            TimePeriod: { Start: monthStart(6), End: todayStr }, Granularity: 'MONTHLY',
            Metrics: ['UnblendedCost'], GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }]
          })),
      useCur
        ? curToCeFormat(curRows, startDate, endDate, 'MONTHLY', ['SERVICE', 'USAGE_TYPE'], ['UnblendedCost', 'UsageQuantity'])
        : ceClient.send(new GetCostAndUsageCommand({
            TimePeriod: { Start: startDate, End: endDate }, Granularity: 'MONTHLY',
            Metrics: ['UnblendedCost', 'UsageQuantity'],
            GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }, { Type: 'DIMENSION', Key: 'USAGE_TYPE' }]
          })),
      useCur
        ? curToCeFormat(curRows, startDate, endDate, 'DAILY', ['SERVICE'], ['UnblendedCost'])
        : ceClient.send(new GetCostAndUsageCommand({
            TimePeriod: { Start: startDate, End: endDate }, Granularity: 'DAILY',
            Metrics: ['UnblendedCost'], GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }]
          })),
      // Forecast: self-calculated from CUR or CE API
      useCur
        ? curCalculateForecast(curRows, todayStr, forecastEndStr)
        : (todayStr < forecastEndStr
            ? ceClient.send(new GetCostForecastCommand({
                TimePeriod: { Start: todayStr, End: forecastEndStr },
                Granularity: 'MONTHLY', Metric: 'UNBLENDED_COST'
              })).catch(err => ({ _error: err.message }))
            : Promise.resolve(null)),
      // Resource inventory (always free, unchanged)
      fetchEC2Instances(),
      cfClient.send(new ListDistributionsCommand({ MaxItems: '100' })).catch(() => ({ DistributionList: { Items: [] } })),
      lambdaClient.send(new ListFunctionsCommand({ MaxItems: 200 })).catch(() => ({ Functions: [] })),
      s3Client.send(new ListBucketsCommand({})).catch(() => ({ Buckets: [] })),
      ecsClient.send(new ListClustersCommand({})).catch(() => ({ clusterArns: [] })),
      elbClient.send(new DescribeLoadBalancersCommand({})).catch(() => ({ LoadBalancers: [] })),
      ec2Client.send(new DescribeNatGatewaysCommand({ Filter: [{ Name: 'state', Values: ['available', 'pending'] }] })).catch(() => ({ NatGateways: [] })),
      ec2Client.send(new DescribeAddressesCommand({})).catch(() => ({ Addresses: [] })),
      safeImport('@aws-sdk/client-rds', m => new m.RDSClient({ region: 'us-east-1' }).send(new m.DescribeDBInstancesCommand({}))),
      safeImport('@aws-sdk/client-elasticache', m => new m.ElastiCacheClient({ region: 'us-east-1' }).send(new m.DescribeCacheClustersCommand({}))),
      safeImport('@aws-sdk/client-codebuild', m => new m.CodeBuildClient({ region: 'us-east-1' }).send(new m.ListProjectsCommand({}))),
      safeImport('@aws-sdk/client-ecr', m => new m.ECRClient({ region: 'us-east-1' }).send(new m.DescribeRepositoriesCommand({})))
    ]);

    const response = { success: true, dataSource: useCur ? 'CUR' : 'CostExplorerAPI' };

    // ── Section 1: Summary ──
    try {
      const currentByService = {};
      for (const tp of ceSummaryCurrent.ResultsByTime || []) {
        for (const group of tp.Groups || []) {
          const service = group.Keys[0];
          const cost = parseFloat(group.Metrics.UnblendedCost.Amount) || 0;
          currentByService[service] = (currentByService[service] || 0) + cost;
        }
      }
      const previousByService = {};
      for (const tp of ceSummaryPrevious.ResultsByTime || []) {
        for (const group of tp.Groups || []) {
          const service = group.Keys[0];
          const cost = parseFloat(group.Metrics.UnblendedCost.Amount) || 0;
          previousByService[service] = (previousByService[service] || 0) + cost;
        }
      }
      const allServiceNames = new Set([...Object.keys(currentByService), ...Object.keys(previousByService)]);
      let services = [];
      for (const service of allServiceNames) {
        const cost = currentByService[service] || 0;
        const previousCost = previousByService[service] || 0;
        if (cost < 0.001 && previousCost < 0.001) continue;
        services.push({ service, cost, previousCost });
      }
      services.sort((a, b) => b.cost - a.cost);
      const totalCost = r2(services.reduce((sum, s) => sum + s.cost, 0));
      const previousPeriodCost = r2(services.reduce((sum, s) => sum + s.previousCost, 0));
      const momChange = previousPeriodCost === 0
        ? (totalCost > 0 ? 100 : 0)
        : r2(((totalCost - previousPeriodCost) / previousPeriodCost) * 100);
      const topService = services.length > 0
        ? { name: services[0].service, cost: r2(services[0].cost) }
        : { name: 'N/A', cost: 0 };
      const activeServices = services.filter(s => s.cost >= 0.001).length;
      const formattedServices = services.map(s => ({
        service: s.service, cost: r2(s.cost), previousCost: r2(s.previousCost),
        delta: r2(s.cost - s.previousCost),
        percentOfTotal: totalCost > 0 ? r2((s.cost / totalCost) * 100) : 0
      }));
      response.summary = {
        totalCost, previousPeriodCost, momChange, topService, activeServices,
        services: formattedServices, period: { start: startDate, end: endDate }
      };
    } catch (e) {
      console.error('[Batch] Summary error:', e);
      response.summary = null;
    }

    // ── Section 2: Daily (derived from daily-by-service) ──
    try {
      const dailyCosts = (ceDailyByService.ResultsByTime || []).map(tp => {
        let dayCost = 0;
        for (const group of tp.Groups || []) {
          dayCost += parseFloat(group.Metrics.UnblendedCost.Amount) || 0;
        }
        return { date: tp.TimePeriod.Start, cost: r2(dayCost) };
      });
      response.daily = { dailyCosts };
    } catch (e) {
      console.error('[Batch] Daily error:', e);
      response.daily = null;
    }

    // ── Section 3: Daily By Service (6 months monthly) ──
    try {
      const months = (ceDailyByService6mo.ResultsByTime || []).map(tp => tp.TimePeriod.Start);
      const serviceTotals = {};
      const serviceMonthly = {};
      for (const tp of ceDailyByService6mo.ResultsByTime || []) {
        const month = tp.TimePeriod.Start;
        for (const group of tp.Groups || []) {
          const service = group.Keys[0];
          const cost = parseFloat(group.Metrics.UnblendedCost.Amount) || 0;
          serviceTotals[service] = (serviceTotals[service] || 0) + cost;
          if (!serviceMonthly[service]) serviceMonthly[service] = {};
          serviceMonthly[service][month] = (serviceMonthly[service][month] || 0) + cost;
        }
      }
      const rankedServices = Object.entries(serviceTotals)
        .filter(([, total]) => total >= 0.001)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([service]) => service);
      const dbsServices = rankedServices.map(service => ({
        service,
        monthly: months.map(month => ({ month, cost: r2(serviceMonthly[service]?.[month] || 0) }))
      }));
      response.dailyByService = { months, services: dbsServices };
    } catch (e) {
      console.error('[Batch] DailyByService error:', e);
      response.dailyByService = null;
    }

    // ── Section 4: Forecast ──
    try {
      if (ceForecast === null) {
        response.forecast = { forecastedTotal: null, forecastPeriod: null, message: 'Month has ended; no forecast available.' };
      } else if (ceForecast._error) {
        response.forecast = { forecastedTotal: null, forecastPeriod: { start: todayStr, end: forecastEndStr }, message: 'Forecast unavailable: ' + ceForecast._error };
      } else {
        response.forecast = {
          forecastedTotal: r2(parseFloat(ceForecast.Total?.Amount) || 0),
          forecastPeriod: { start: todayStr, end: forecastEndStr }
        };
      }
    } catch (e) {
      console.error('[Batch] Forecast error:', e);
      response.forecast = null;
    }

    // ── Section 5: Service Detail ──
    try {
      const serviceDetails = {};
      for (const tp of ceServiceUsage.ResultsByTime || []) {
        for (const group of tp.Groups || []) {
          const service = group.Keys[0];
          const usageType = group.Keys[1];
          const cost = parseFloat(group.Metrics.UnblendedCost.Amount) || 0;
          const usage = parseFloat(group.Metrics.UsageQuantity.Amount) || 0;
          if (cost < 0.001 && usage < 0.001) continue;
          if (!serviceDetails[service]) serviceDetails[service] = { usageTypes: [], totalCost: 0 };
          serviceDetails[service].totalCost += cost;
          serviceDetails[service].usageTypes.push({ usageType, cost: r2(cost), usage: r2(usage) });
        }
      }
      for (const svc of Object.values(serviceDetails)) {
        svc.totalCost = r2(svc.totalCost);
        svc.usageTypes.sort((a, b) => b.cost - a.cost);
      }
      const suggestions = generateSuggestions(serviceDetails, ec2Instances);
      response.serviceDetail = { serviceDetails, ec2Instances, suggestions, period: { start: startDate, end: endDate } };
    } catch (e) {
      console.error('[Batch] ServiceDetail error:', e);
      response.serviceDetail = null;
    }

    // ── Section 6: Project Costs (dynamic) ──
    try {
      const serviceCostsMtd = {};
      for (const tp of ceSummaryCurrent.ResultsByTime || []) {
        for (const g of tp.Groups || []) {
          const svc = g.Keys[0];
          const cost = parseFloat(g.Metrics.UnblendedCost.Amount) || 0;
          serviceCostsMtd[svc] = (serviceCostsMtd[svc] || 0) + cost;
        }
      }

      const nowDate = new Date();
      const daysInMonth = new Date(nowDate.getUTCFullYear(), nowDate.getUTCMonth() + 1, 0).getUTCDate();
      const monthlyMultiplier = daysInPeriod > 0 ? daysInMonth / daysInPeriod : 1;
      const serviceCosts = {};
      for (const [svc, mtd] of Object.entries(serviceCostsMtd)) {
        serviceCosts[svc] = svc === 'Tax' ? mtd : r2(mtd * monthlyMultiplier);
      }

      // ELB tags
      const elbs = loadBalancers.LoadBalancers || [];
      const elbTagMap = {};
      if (elbs.length > 0) {
        try {
          const elbArns = elbs.map(e => e.LoadBalancerArn);
          const tagResult = await elbClient.send(new ELBDescribeTagsCommand({ ResourceArns: elbArns }));
          for (const desc of tagResult.TagDescriptions || []) {
            const tags = {};
            for (const t of desc.Tags || []) tags[t.Key] = t.Value;
            elbTagMap[desc.ResourceArn] = tags;
          }
        } catch (e) { console.warn('[Batch/ELB Tags] Error:', e.message); }
      }

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

      const projects = {};
      function getProject(name) {
        if (!projects[name]) projects[name] = { name, resources: [], total: 0, serviceSet: {} };
        return projects[name];
      }
      function addResource(projName, service, resource, details, cost) {
        const proj = getProject(projName);
        proj.resources.push({ service, resource, details, monthlyCost: r2(cost), prevMonthlyCost: null });
        proj.total += cost;
        proj.serviceSet[service] = true;
      }

      // EC2
      for (const inst of ec2Instances) {
        const projName = resolveProject(inst.allTags, inst.name);
        addResource(projName, 'EC2', inst.name + ' (' + (inst.type || '--') + ')',
          inst.state + (inst.publicIp ? ', ' + inst.publicIp : ''), inst.estimatedMonthlyCost || 0);
      }

      // CloudFront with CW metrics
      const cfMetricPromises = cfDistributions.map(async (dist) => {
        try {
          const [reqResult, bytesResult] = await Promise.all([
            cwClient.send(new GetMetricStatisticsCommand({
              Namespace: 'AWS/CloudFront', MetricName: 'Requests',
              Dimensions: [{ Name: 'DistributionId', Value: dist.Id }, { Name: 'Region', Value: 'Global' }],
              StartTime: new Date(startDate), EndTime: new Date(endDate),
              Period: 86400 * 31, Statistics: ['Sum']
            })),
            cwClient.send(new GetMetricStatisticsCommand({
              Namespace: 'AWS/CloudFront', MetricName: 'BytesDownloaded',
              Dimensions: [{ Name: 'DistributionId', Value: dist.Id }, { Name: 'Region', Value: 'Global' }],
              StartTime: new Date(startDate), EndTime: new Date(endDate),
              Period: 86400 * 31, Statistics: ['Sum']
            }))
          ]);
          const requests = reqResult.Datapoints?.[0]?.Sum || 0;
          const bytes = bytesResult.Datapoints?.[0]?.Sum || 0;
          const gbTransfer = bytes / (1024 * 1024 * 1024);
          return { dist, requests, bytes, estimatedCost: (gbTransfer * 0.085) + (requests / 10000 * 0.01) };
        } catch { return { dist, requests: 0, bytes: 0, estimatedCost: 0 }; }
      });
      const cfMetrics = await Promise.all(cfMetricPromises);
      for (const { dist, requests, bytes, estimatedCost } of cfMetrics) {
        const originDomain = dist.Origins?.Items?.[0]?.DomainName || '';
        const alias = dist.Aliases?.Items?.[0] || '';
        const displayName = alias || dist.DomainName;
        const cfTags = cfTagMap[dist.ARN] || null;
        const projName = getProjectFromTags(cfTags)
          || (inferProjectFromName(originDomain) !== 'AI Product Studio'
              ? inferProjectFromName(originDomain) : inferProjectFromName(alias || dist.DomainName));
        const gbStr = (bytes / (1024 * 1024 * 1024)).toFixed(2);
        const reqStr = requests > 1000 ? (requests / 1000).toFixed(1) + 'K' : requests.toString();
        addResource(projName, 'CloudFront', displayName, reqStr + ' requests, ' + gbStr + ' GB', estimatedCost);
      }

      // Lambda
      const lambdaByProj = {};
      for (const fn of lambdaFns) {
        const fnTags = lambdaTagMap[fn.FunctionArn] || null;
        const projName = resolveProject(fnTags, fn.FunctionName);
        if (!lambdaByProj[projName]) lambdaByProj[projName] = [];
        lambdaByProj[projName].push(fn.FunctionName);
      }
      const lambdaCostMtd = serviceCosts['AWS Lambda'] || 0;
      const totalLambdaFns = lambdaFns.length || 1;
      for (const [projName, fns] of Object.entries(lambdaByProj)) {
        addResource(projName, 'Lambda', fns.length + ' functions',
          fns.slice(0, 3).map(f => f.substring(0, 40)).join(', ') + (fns.length > 3 ? '...' : ''),
          lambdaCostMtd * (fns.length / totalLambdaFns));
      }

      // S3
      const s3CostMtd = serviceCosts['Amazon Simple Storage Service'] || 0;
      const s3ByProj = {};
      for (const b of s3BucketList) {
        const bTags = s3TagMap[b.Name] || null;
        const projName = resolveProject(bTags, b.Name);
        if (!s3ByProj[projName]) s3ByProj[projName] = [];
        s3ByProj[projName].push(b.Name);
      }
      const totalBuckets = s3BucketList.length || 1;
      for (const [projName, bkts] of Object.entries(s3ByProj)) {
        addResource(projName, 'S3', bkts.length + ' buckets',
          bkts.slice(0, 3).map(b => b.substring(0, 35)).join(', ') + (bkts.length > 3 ? '...' : ''),
          s3CostMtd * (bkts.length / totalBuckets));
      }

      // ECS
      for (const arn of ecsClusterArns) {
        const clusterName = arn.split('/').pop();
        const clusterTags = ecsTagMap[arn] || null;
        const projName = resolveProject(clusterTags, clusterName);
        try {
          const svcList = await ecsClient.send(new ListServicesCommand({ cluster: clusterName }));
          const svcArns = svcList.serviceArns || [];
          if (svcArns.length > 0) {
            const svcDetails = await ecsClient.send(new DescribeServicesCommand({ cluster: clusterName, services: svcArns }));
            const ecsServices = svcDetails.services || [];
            const totalTasks = ecsServices.reduce((s, svc) => s + (svc.desiredCount || 0), 0);
            addResource(projName, 'ECS', clusterName,
              ecsServices.length + ' services, ' + totalTasks + ' tasks', serviceCosts['Amazon Elastic Container Service'] || 0);
          }
        } catch { /* skip */ }
      }

      // Load Balancers
      const elbCostMtd = serviceCosts['Amazon Elastic Load Balancing'] || 0;
      const elbCount = elbs.length || 1;
      for (const elb of elbs) {
        const elbTags = elbTagMap[elb.LoadBalancerArn] || null;
        addResource(resolveProject(elbTags, elb.LoadBalancerName), 'ELB', elb.LoadBalancerName,
          elb.Type + ' load balancer', elbCostMtd / elbCount);
      }

      // Service-level fallbacks
      const hasRds = rdsInstances && (rdsInstances.DBInstances || []).length > 0;
      const hasEcache = elasticacheClusters && (elasticacheClusters.CacheClusters || []).length > 0;
      const hasEcr = ecrRepos && (ecrRepos.repositories || []).length > 0;
      const hasCb = codebuildProjects && (codebuildProjects.projects || []).length > 0;
      const serviceProjectFallback = {
        ...(hasRds ? { 'Amazon Relational Database Service': 'Career Builder' } : {}),
        ...(hasEcache ? { 'Amazon ElastiCache': 'Career Builder' } : {}),
        ...(hasEcr ? { 'Amazon EC2 Container Registry (ECR)': 'Career Builder' } : {}),
        ...(hasCb ? { 'CodeBuild': 'Career Builder' } : {}),
        'AWS Secrets Manager': 'Career Builder',
        'Amazon Simple Email Service': 'Vedic Astro'
      };
      for (const [svcName, projName] of Object.entries(serviceProjectFallback)) {
        const cost = serviceCosts[svcName] || 0;
        if (cost < 0.001) continue;
        const mtd = serviceCostsMtd[svcName] || 0;
        const shortName = svcName.replace('Amazon ', '').replace('AWS ', '').split(' ')[0];
        addResource(projName, shortName, svcName, 'Est. monthly (MTD $' + r2(mtd) + ')', cost);
      }

      // Shared infra
      for (const svcName of ['Amazon Virtual Private Cloud', 'AmazonCloudWatch']) {
        const cost = serviceCosts[svcName] || 0;
        if (cost < 0.001) continue;
        const mtd = serviceCostsMtd[svcName] || 0;
        const shortName = svcName.includes('VPC') ? 'VPC' : 'CloudWatch';
        addResource('Shared Infrastructure', shortName, svcName, 'Est. monthly (MTD $' + r2(mtd) + ')', cost);
      }

      // Tax
      if ((serviceCosts['Tax'] || 0) > 0) {
        addResource('Tax & Fees', 'Tax', 'AWS Tax', 'Account-level tax', serviceCosts['Tax']);
      }

      // EC2-Other distributed proportionally
      const ec2OtherCost = serviceCosts['EC2 - Other'] || 0;
      if (ec2OtherCost > 0) {
        const ec2OtherMtd = serviceCostsMtd['EC2 - Other'] || 0;
        const ec2Projects = Object.entries(projects).filter(([, p]) => p.serviceSet['EC2']);
        const totalEc2Cost = ec2Projects.reduce((s, [, p]) =>
          s + p.resources.filter(r => r.service === 'EC2').reduce((s2, r) => s2 + r.monthlyCost, 0), 0) || 1;
        for (const [, proj] of ec2Projects) {
          const projEc2Cost = proj.resources.filter(r => r.service === 'EC2').reduce((s, r) => s + r.monthlyCost, 0);
          const share = ec2OtherCost * (projEc2Cost / totalEc2Cost);
          if (share > 0.01) {
            const shareMtd = ec2OtherMtd * (projEc2Cost / totalEc2Cost);
            addResource(proj.name, 'EC2', 'EBS volumes & data transfer', 'Est. monthly (MTD $' + r2(shareMtd) + ')', share);
          }
        }
      }

      // Build final project list
      const projectList = Object.values(projects).map(p => ({
        name: p.name, category: p.name === 'Tax & Fees' ? 'tax' : 'infra',
        serviceList: Object.keys(p.serviceSet).join(', '),
        resources: p.resources, total: r2(p.total), prevTotal: null
      })).sort((a, b) => b.total - a.total);

      const grandTotal = r2(projectList.reduce((s, p) => s + p.total, 0));

      // Deleted resources detection
      const deletedResources = [];
      const deletedChecks = [
        { svc: 'Amazon Relational Database Service', name: 'RDS Database(s)', type: 'RDS', data: rdsInstances, countKey: 'DBInstances' },
        { svc: 'Amazon ElastiCache', name: 'ElastiCache Cluster(s)', type: 'ElastiCache', data: elasticacheClusters, countKey: 'CacheClusters' },
        { svc: 'Amazon Elastic Container Service', name: 'ECS Cluster(s)', type: 'ECS Fargate', data: ecsClusters, countKey: 'clusterArns' },
        { svc: 'Amazon Elastic Load Balancing', name: 'Load Balancer(s)', type: 'ALB/NLB', data: loadBalancers, countKey: 'LoadBalancers' },
        { svc: 'Amazon EC2 Container Registry (ECR)', name: 'ECR Repositories', type: 'ECR', data: ecrRepos, countKey: 'repositories' },
        { svc: 'CodeBuild', name: 'CodeBuild Project(s)', type: 'CodeBuild', data: codebuildProjects, countKey: 'projects' }
      ];
      for (const chk of deletedChecks) {
        const mtd = serviceCostsMtd[chk.svc] || 0;
        const monthly = serviceCosts[chk.svc] || 0;
        if (mtd > 0.01 && chk.data && (chk.data[chk.countKey] || []).length === 0) {
          deletedResources.push({
            name: chk.name, type: chk.type,
            project: inferProjectFromName(chk.name) !== 'AI Product Studio' ? inferProjectFromName(chk.name) : 'Career Builder',
            monthlySavings: monthly,
            reason: 'No active ' + chk.type + ' found but $' + r2(mtd) + ' charged MTD'
          });
        }
      }

      // NAT gateway check
      const activeNats = (natGateways.NatGateways || []).length;
      const vpcMtd = serviceCostsMtd['Amazon Virtual Private Cloud'] || 0;
      if (vpcMtd > 5 && activeNats === 0) {
        const activeEips = (eipAddresses.Addresses || []).length;
        const ipCost = activeEips * 3.65;
        const natEstimate = r2(Math.max(0, (serviceCosts['Amazon Virtual Private Cloud'] || 0) - ipCost));
        if (natEstimate > 1) {
          deletedResources.push({ name: 'NAT Gateway(s)', type: 'NAT Gateway', project: 'Career Builder',
            monthlySavings: natEstimate, reason: 'No active NAT gateways but VPC charges suggest deleted NATs' });
        }
      }

      const totalMonthlySavings = r2(deletedResources.reduce((s, d) => s + d.monthlySavings, 0));
      const projectedNextMonth = r2(grandTotal - totalMonthlySavings);
      const grandTotalMtd = r2(Object.values(serviceCostsMtd).reduce((s, v) => s + v, 0));

      response.projectCosts = {
        projects: projectList, grandTotal, grandTotalMtd, projectedNextMonth,
        totalMonthlySavings, deletedResources,
        period: { start: startDate, end: endDate, days: daysInPeriod, daysInMonth },
        serviceCosts: Object.fromEntries(Object.entries(serviceCosts).filter(([, v]) => v > 0.001).map(([k, v]) => [k, r2(v)])),
        serviceCostsMtd: Object.fromEntries(Object.entries(serviceCostsMtd).filter(([, v]) => v > 0.001).map(([k, v]) => [k, r2(v)]))
      };
    } catch (e) {
      console.error('[Batch] ProjectCosts error:', e);
      response.projectCosts = null;
    }

    // ── Section 7: Daily By Project ──
    try {
      const ec2ByProject = {};
      let ec2TotalCost = 0;
      for (const inst of ec2Instances) {
        const proj = resolveProject(inst.allTags, inst.name);
        const cost = inst.estimatedMonthlyCost || 0;
        ec2ByProject[proj] = (ec2ByProject[proj] || 0) + cost;
        ec2TotalCost += cost;
      }

      const dbpLambdaByProject = {};
      let dbpLambdaTotalCount = 0;
      for (const fn of lambdaFns) {
        const fnTags = lambdaTagMap[fn.FunctionArn] || null;
        const proj = resolveProject(fnTags, fn.FunctionName);
        dbpLambdaByProject[proj] = (dbpLambdaByProject[proj] || 0) + 1;
        dbpLambdaTotalCount++;
      }

      const dbpS3ByProject = {};
      let dbpS3TotalCount = 0;
      for (const b of s3BucketList) {
        const bTags = s3TagMap[b.Name] || null;
        const proj = resolveProject(bTags, b.Name);
        dbpS3ByProject[proj] = (dbpS3ByProject[proj] || 0) + 1;
        dbpS3TotalCount++;
      }

      const cfByProject = {};
      let cfTotalCount = 0;
      for (const dist of cfDistributions) {
        const originDomain = dist.Origins?.Items?.[0]?.DomainName || '';
        const alias = dist.Aliases?.Items?.[0] || '';
        const distTags = cfTagMap[dist.ARN] || null;
        const proj = getProjectFromTags(distTags)
          || (inferProjectFromName(originDomain) !== 'AI Product Studio'
              ? inferProjectFromName(originDomain) : inferProjectFromName(alias || dist.DomainName));
        cfByProject[proj] = (cfByProject[proj] || 0) + 1;
        cfTotalCount++;
      }

      const fixedServiceMap = {
        'Amazon Relational Database Service': 'Career Builder',
        'Amazon ElastiCache': 'Career Builder',
        'Amazon EC2 Container Registry (ECR)': 'Career Builder',
        'CodeBuild': 'Career Builder',
        'AWS Secrets Manager': 'Career Builder',
        'Amazon Simple Email Service': 'Vedic Astro',
        'Amazon Virtual Private Cloud': 'Shared Infrastructure',
        'AmazonCloudWatch': 'Shared Infrastructure',
        'Tax': 'Tax & Fees'
      };

      function splitServiceCost(serviceName, cost) {
        if (fixedServiceMap[serviceName]) return { [fixedServiceMap[serviceName]]: cost };
        if (serviceName === 'Amazon Elastic Compute Cloud - Compute' || serviceName === 'EC2 - Other') {
          if (ec2TotalCost <= 0) return { 'AI Product Studio': cost };
          const result = {};
          for (const [proj, projCost] of Object.entries(ec2ByProject)) result[proj] = r2(cost * (projCost / ec2TotalCost));
          return result;
        }
        if (serviceName === 'AWS Lambda') {
          if (dbpLambdaTotalCount <= 0) return { 'AI Product Studio': cost };
          const result = {};
          for (const [proj, count] of Object.entries(dbpLambdaByProject)) result[proj] = r2(cost * (count / dbpLambdaTotalCount));
          return result;
        }
        if (serviceName === 'Amazon Simple Storage Service') {
          if (dbpS3TotalCount <= 0) return { 'AI Product Studio': cost };
          const result = {};
          for (const [proj, count] of Object.entries(dbpS3ByProject)) result[proj] = r2(cost * (count / dbpS3TotalCount));
          return result;
        }
        if (serviceName === 'Amazon CloudFront') {
          if (cfTotalCount <= 0) return { 'AI Product Studio': cost };
          const result = {};
          for (const [proj, count] of Object.entries(cfByProject)) result[proj] = r2(cost * (count / cfTotalCount));
          return result;
        }
        if (serviceName === 'Amazon Elastic Load Balancing') return { 'Career Builder': cost };
        return { 'AI Product Studio': cost };
      }

      const dates = [];
      const dailyByProject = {};
      for (const tp of ceDailyByService.ResultsByTime || []) {
        const date = tp.TimePeriod.Start;
        dates.push(date);
        const dayIdx = dates.length - 1;
        for (const group of tp.Groups || []) {
          const service = group.Keys[0];
          const cost = parseFloat(group.Metrics.UnblendedCost.Amount) || 0;
          if (cost < 0.001) continue;
          const projectSplit = splitServiceCost(service, cost);
          for (const [proj, projCost] of Object.entries(projectSplit)) {
            if (!dailyByProject[proj]) dailyByProject[proj] = new Array(dates.length).fill(0);
            while (dailyByProject[proj].length < dates.length) dailyByProject[proj].push(0);
            dailyByProject[proj][dayIdx] += projCost;
          }
        }
        for (const proj of Object.keys(dailyByProject)) {
          while (dailyByProject[proj].length < dates.length) dailyByProject[proj].push(0);
        }
      }
      for (const proj of Object.keys(dailyByProject)) {
        dailyByProject[proj] = dailyByProject[proj].map(v => r2(v));
      }

      response.dailyByProject = { success: true, dates, dailyByProject };
    } catch (e) {
      console.error('[Batch] DailyByProject error:', e);
      response.dailyByProject = null;
    }

    return jsonResponse(200, corsHeaders, response);
  } catch (error) {
    console.error('[AWS Cost Dashboard Batch] Error:', error);
    return jsonResponse(500, corsHeaders, { success: false, error: error.message });
  }
}

// ---------------------------------------------------------------------------
// Batch 2: handleAwsCostStorageBatch
// ---------------------------------------------------------------------------

/**
 * Merges 3 storage/cleanup endpoints into 1 batch call:
 *   unusedResources, s3Buckets (list), s3Analysis
 * Fetches shared data once (ListBuckets, EC2 describe calls).
 */
export async function handleAwsCostStorageBatch({ body, corsHeaders, ADMIN_PASSWORD }) {
  if (body.password !== ADMIN_PASSWORD) {
    return jsonResponse(401, corsHeaders, { success: false, error: 'Unauthorized' });
  }

  try {
    const [volumesResult, snapshotsResult, addressesResult, bucketsResult] = await Promise.all([
      ec2Client.send(new DescribeVolumesCommand({ Filters: [{ Name: 'status', Values: ['available'] }] })),
      ec2Client.send(new DescribeSnapshotsCommand({ OwnerIds: ['self'] })),
      ec2Client.send(new DescribeAddressesCommand({})),
      s3Client.send(new ListBucketsCommand({}))
    ]);

    const response = { success: true };

    // ── Section 1: Unused Resources ──
    try {
      const volumes = (volumesResult.Volumes || []).map(v => {
        const tags = {};
        for (const tag of v.Tags || []) tags[tag.Key] = tag.Value;
        return {
          volumeId: v.VolumeId, name: tags.Name || v.VolumeId, size: v.Size,
          volumeType: v.VolumeType, createTime: v.CreateTime ? v.CreateTime.toISOString() : null,
          az: v.AvailabilityZone, estimatedMonthlyCost: r2((v.Size || 0) * 0.10)
        };
      });

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const snapshots = (snapshotsResult.Snapshots || [])
        .filter(s => s.StartTime && new Date(s.StartTime) < thirtyDaysAgo)
        .map(s => {
          const tags = {};
          for (const tag of s.Tags || []) tags[tag.Key] = tag.Value;
          return {
            snapshotId: s.SnapshotId, name: tags.Name || s.SnapshotId, volumeId: s.VolumeId,
            size: s.VolumeSize, startTime: s.StartTime ? s.StartTime.toISOString() : null,
            description: s.Description || '', estimatedMonthlyCost: r2((s.VolumeSize || 0) * 0.05)
          };
        })
        .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

      const elasticIps = (addressesResult.Addresses || [])
        .filter(a => !a.AssociationId)
        .map(a => {
          const tags = {};
          for (const tag of a.Tags || []) tags[tag.Key] = tag.Value;
          return {
            allocationId: a.AllocationId, publicIp: a.PublicIp, name: tags.Name || a.PublicIp,
            domain: a.Domain, estimatedMonthlyCost: r2(0.005 * 730)
          };
        });

      response.unusedResources = { volumes, snapshots, elasticIps };
    } catch (e) {
      console.error('[Batch] UnusedResources error:', e);
      response.unusedResources = null;
    }

    // ── Section 2: S3 Buckets list (with locations) ──
    try {
      const bucketsList = await Promise.all((bucketsResult.Buckets || []).map(async (b) => {
        let location = 'us-east-1';
        try {
          const locResult = await s3Client.send(new GetBucketLocationCommand({ Bucket: b.Name }));
          location = locResult.LocationConstraint || 'us-east-1';
        } catch (e) { /* ignore */ }
        return { name: b.Name, creationDate: b.CreationDate ? b.CreationDate.toISOString() : null, region: location };
      }));
      response.s3Buckets = { buckets: bucketsList };
    } catch (e) {
      console.error('[Batch] S3Buckets error:', e);
      response.s3Buckets = null;
    }

    // ── Section 3: S3 Analysis ──
    try {
      const bucketNames = (bucketsResult.Buckets || []).map(b => b.Name);
      const analyses = [];
      for (const bucketName of bucketNames) {
        try {
          const analysis = { bucket: bucketName, totalSize: 0, totalObjects: 0, categories: {}, tempFiles: [], largeFiles: [] };
          let continuationToken;
          do {
            const params = { Bucket: bucketName, MaxKeys: 1000 };
            if (continuationToken) params.ContinuationToken = continuationToken;
            const result = await new S3Client({ region: 'ap-south-1' }).send(new ListObjectsV2Command(params));
            const contents = result.Contents || [];
            for (const obj of contents) {
              const key = obj.Key || '';
              const size = obj.Size || 0;
              const ext = ('.' + key.split('.').pop()).toLowerCase();
              analysis.totalSize += size;
              analysis.totalObjects++;
              let category = 'other';
              for (const [cat, exts] of Object.entries(FILE_CATEGORIES)) {
                if (exts.includes(ext)) { category = cat; break; }
              }
              if (!analysis.categories[category]) analysis.categories[category] = { count: 0, size: 0, files: [] };
              analysis.categories[category].count++;
              analysis.categories[category].size += size;
              if (TEMP_PATTERNS.some(p => p.test(key))) {
                analysis.tempFiles.push({ key, size, lastModified: obj.LastModified ? obj.LastModified.toISOString() : null });
              }
              if (size > 5 * 1024 * 1024) {
                analysis.largeFiles.push({ key, size, lastModified: obj.LastModified ? obj.LastModified.toISOString() : null });
              }
            }
            continuationToken = result.IsTruncated ? result.NextContinuationToken : null;
          } while (continuationToken);
          analysis.largeFiles.sort((a, b) => b.size - a.size);
          analysis.largeFiles = analysis.largeFiles.slice(0, 20);
          analysis.tempFiles = analysis.tempFiles.slice(0, 50);
          for (const cat of Object.values(analysis.categories)) delete cat.files;
          analyses.push(analysis);
        } catch (bucketErr) {
          analyses.push({ bucket: bucketName, error: bucketErr.message });
        }
      }
      response.s3Analysis = { analyses };
    } catch (e) {
      console.error('[Batch] S3Analysis error:', e);
      response.s3Analysis = null;
    }

    return jsonResponse(200, corsHeaders, response);
  } catch (error) {
    console.error('[AWS Cost Storage Batch] Error:', error);
    return jsonResponse(500, corsHeaders, { success: false, error: error.message });
  }
}
