# CUR Migration Design — Replace Cost Explorer API with S3-based CUR

## Goal
Replace 6 Cost Explorer API calls ($0.06/load, ~$9/month) with free S3-based CUR data reading (~$0.03/month total).

## Architecture
```
AWS CUR → S3 Bucket (auto, 2-3x/day) → Lambda reads CSV/gzip → Same response shapes → Frontend unchanged
```

## What Changes
- **New:** S3 bucket `cocreate-cur-reports`, CUR report definition
- **Backend:** New CUR reading functions replace 6 CE API calls
- **Backend:** Self-calculated forecast replaces `GetCostForecastCommand`
- **Frontend:** Zero changes — same response shapes

## What Stays
- All 12 resource inventory calls (free)
- All frontend rendering code
- All response data shapes
- Storage batch handler (no CE API calls)

## Cost: ~$0.03/month vs current ~$9/month
