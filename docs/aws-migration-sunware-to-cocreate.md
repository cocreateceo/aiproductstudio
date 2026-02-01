# AWS Migration: Sunwaretech to CoCreate

This document describes the migration of the CoCreate application from the sunwaretech AWS account to the new cocreate AWS account.

## Overview

| Item | Old (Sunwaretech) | New (CoCreate) |
|------|-------------------|----------------|
| AWS Account | sunwaretech | cocreate |
| AWS Region | us-east-1 | ap-south-1 |
| S3 Bucket | ai-product-studio-sunware | cocreate-app.com |
| CloudFront Distribution | E85ZBHF63VW9W | E1M06FXCRKZHF3 |
| CloudFront Domain | d1xxxxxxxxx.cloudfront.net | d22wcw0ms5yub3.cloudfront.net |
| Custom Domains | cocreate-app.com | cocreate-app.com, cocreateidea.com |

## Active Domains

All domains point to the same CloudFront distribution (E1M06FXCRKZHF3):

| Domain | DNS Provider | Status |
|--------|--------------|--------|
| https://cocreate-app.com | Route 53 (sunwaretech) | Active |
| https://www.cocreate-app.com | Route 53 (sunwaretech) | Active |
| https://cocreateidea.com | GoDaddy | Active (forwards to www) |
| https://www.cocreateidea.com | GoDaddy | Active |

## Migration Steps

### 1. AWS Credentials Setup

Created AWS access keys in the new cocreate account and configured credentials:

```
# C:\Users\<user>\.aws\credentials
[cocreate]
aws_access_key_id = AKIA...
aws_secret_access_key = ...
```

### 2. S3 Bucket Creation

Created new S3 bucket with static website hosting:

```bash
# Create bucket in ap-south-1
aws s3api create-bucket \
  --bucket cocreate-app.com \
  --region ap-south-1 \
  --create-bucket-configuration LocationConstraint=ap-south-1 \
  --profile cocreate

# Enable static website hosting
aws s3 website s3://cocreate-app.com/ \
  --index-document index.html \
  --error-document index.html \
  --profile cocreate

# Disable block public access
aws s3api put-public-access-block \
  --bucket cocreate-app.com \
  --public-access-block-configuration \
    BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false \
  --profile cocreate

# Set bucket policy for public read
aws s3api put-bucket-policy \
  --bucket cocreate-app.com \
  --policy '{
    "Version": "2012-10-17",
    "Statement": [{
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::cocreate-app.com/*"
    }]
  }' \
  --profile cocreate
```

### 3. Deploy Site Files

Updated deployment script to use cocreate profile:

```bash
# deploy-cocreate-app.sh
AWS_PROFILE="cocreate"  # Changed from "sunwaretech"
```

Deployed site files:
```bash
aws s3 sync ./option-a-threejs-gsap-tailwind/site/ s3://cocreate-app.com/ \
  --delete --profile cocreate
```

### 4. SSL Certificate

Requested ACM certificate in us-east-1 (required for CloudFront):

```bash
aws acm request-certificate \
  --domain-name cocreate-app.com \
  --subject-alternative-names www.cocreate-app.com \
  --validation-method DNS \
  --region us-east-1 \
  --profile cocreate
```

Certificate ARN (covers all 4 domains): `arn:aws:acm:us-east-1:248825820556:certificate/87112070-b249-4f2a-a3fd-0f7332c33204`

Domains covered:
- cocreate-app.com
- www.cocreate-app.com
- cocreateidea.com
- www.cocreateidea.com

### 5. DNS Validation

Added CNAME record in Route 53 (sunwaretech account, where domain is registered):

```bash
# DNS validation record added to sunwaretech Route 53
# Zone: cocreate-app.com
# Type: CNAME
# Name: _xxxxxxxx.cocreate-app.com
# Value: _xxxxxxxx.acm-validations.aws
```

### 6. CloudFront Distribution

Created new CloudFront distribution in cocreate account:

```bash
aws cloudfront create-distribution \
  --distribution-config file://cf-config.json \
  --profile cocreate
```

Key configuration:
- Origin: `cocreate-app.com.s3-website.ap-south-1.amazonaws.com`
- Origin Protocol: HTTP only (S3 website endpoint)
- Viewer Protocol: Redirect HTTP to HTTPS
- Price Class: PriceClass_All
- Custom Error Response: 404 → /index.html (for SPA routing)

### 7. Domain Alias Transfer

Removed aliases from old CloudFront distribution (sunwaretech):

```bash
# Get current config
aws cloudfront get-distribution-config --id E85ZBHF63VW9W --profile sunwaretech > cf-old.json

# Update with Aliases.Quantity: 0, remove Items
aws cloudfront update-distribution \
  --id E85ZBHF63VW9W \
  --if-match EXYGNH17YMR6Q \
  --distribution-config file://cf-old-update.json \
  --profile sunwaretech
```

Added aliases to new CloudFront distribution (cocreate):

```bash
aws cloudfront update-distribution \
  --id E1M06FXCRKZHF3 \
  --if-match E23ZP02F085DFQ \
  --distribution-config file://cf-update.json \
  --profile cocreate
```

### 8. DNS Records

DNS A records in Route 53 (sunwaretech) pointing to new CloudFront:

| Name | Type | Alias Target |
|------|------|--------------|
| cocreate-app.com | A | d22wcw0ms5yub3.cloudfront.net |
| www.cocreate-app.com | A | d22wcw0ms5yub3.cloudfront.net |

CloudFront Hosted Zone ID: `Z2FDTNDATAQYW2` (standard for all CloudFront distributions)

## Architecture

```
                    ┌─────────────────────────────────────────┐
                    │         Sunwaretech AWS Account         │
                    │                                         │
                    │  Route 53                               │
                    │  ┌─────────────────────────────────┐    │
                    │  │ cocreate-app.com (Hosted Zone)  │    │
                    │  │                                 │    │
                    │  │ A → d22wcw0ms5yub3.cloudfront   │────┼───┐
                    │  │ www A → d22wcw0ms5yub3.cloud... │────┼───┤
                    │  └─────────────────────────────────┘    │   │
                    └─────────────────────────────────────────┘   │
                                                                  │
                    ┌─────────────────────────────────────────┐   │
                    │          CoCreate AWS Account           │   │
                    │                                         │   │
                    │  CloudFront (E1M06FXCRKZHF3)           │   │
                    │  ┌─────────────────────────────────┐    │   │
                    │  │ d22wcw0ms5yub3.cloudfront.net  │◄───┼───┘
                    │  │                                 │    │
                    │  │ Aliases:                        │    │
                    │  │  - cocreate-app.com            │    │
                    │  │  - www.cocreate-app.com        │    │
                    │  │  - cocreateidea.com            │    │
                    │  │  - www.cocreateidea.com        │    │
                    │  │                                 │    │
                    │  │ SSL: ACM Certificate           │    │
                    │  └───────────────┬─────────────────┘    │
                    │                  │                      │
                    │                  ▼                      │
                    │  S3 (cocreate-app.com)                  │
                    │  ┌─────────────────────────────────┐    │
                    │  │ Region: ap-south-1              │    │
                    │  │ Static Website Hosting          │    │
                    │  │ /index.html, /assets/*, etc.   │    │
                    │  └─────────────────────────────────┘    │
                    └─────────────────────────────────────────┘
```

## Verification

```bash
# Test cocreate-app.com
curl -I https://cocreate-app.com       # 200 OK
curl -I https://www.cocreate-app.com   # 200 OK
curl -I http://cocreate-app.com        # 301 → https

# Test cocreateidea.com
curl -I https://www.cocreateidea.com   # 200 OK
curl -I https://cocreateidea.com       # 301 → www (GoDaddy forwarding)
```

## Branding Updates (Feb 1, 2026)

- Changed "CoCreate AI" to "CoCreate" across all pages
- Updated logo to custom image (assets/logo.png)
- Hidden sections: Products In Flight, Life at CoCreate, Perks & Benefits, Open Positions

## Files Modified

- `deploy-cocreate-app.sh` - Changed AWS_PROFILE from "sunwaretech" to "cocreate"
- `C:\Users\<user>\.aws\credentials` - Added cocreate profile
- All HTML files - Logo and branding updates
- `js/chat-widget.js`, `js/chat-loader.js` - Chatbot branding

## Dates

- Migration completed: January 31, 2026
- Branding updates: February 1, 2026
