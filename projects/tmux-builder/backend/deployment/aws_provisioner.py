"""
AWS Provisioner
Creates and manages AWS resources for deployed projects.
Handles S3 buckets, CloudFront distributions, and related infrastructure.
"""

import os
import json
import asyncio
import subprocess
from pathlib import Path
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, field
from datetime import datetime

import boto3
from botocore.exceptions import ClientError


@dataclass
class AWSResource:
    """Represents an AWS resource created for a project"""
    resource_type: str  # s3Bucket, cloudfront, lambda, apiGateway
    name: str
    arn: Optional[str] = None
    region: str = "us-east-1"
    status: str = "creating"
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())

    # Type-specific fields
    distribution_id: Optional[str] = None  # CloudFront
    domain_name: Optional[str] = None  # CloudFront
    function_name: Optional[str] = None  # Lambda
    api_id: Optional[str] = None  # API Gateway
    endpoint: Optional[str] = None  # API Gateway

    def to_dict(self) -> Dict[str, Any]:
        return {
            "resource_type": self.resource_type,
            "name": self.name,
            "arn": self.arn,
            "region": self.region,
            "status": self.status,
            "created_at": self.created_at,
            "distribution_id": self.distribution_id,
            "domain_name": self.domain_name,
            "function_name": self.function_name,
            "api_id": self.api_id,
            "endpoint": self.endpoint
        }


@dataclass
class BuildResult:
    """Result of a build operation"""
    success: bool
    output_path: Optional[str] = None
    error: Optional[str] = None
    logs: List[str] = field(default_factory=list)


@dataclass
class UploadResult:
    """Result of an S3 upload operation"""
    success: bool
    files_count: int = 0
    total_size: int = 0
    error: Optional[str] = None


class AWSProvisioner:
    """
    Provisions AWS resources for project deployments.

    Resource naming convention:
    cocreate-{user_id_short}-{project_slug}

    Example: cocreate-a1b2c3-my-app
    """

    def __init__(
        self,
        user_id: str,
        project_name: str,
        region: str = "us-east-1"
    ):
        self.user_id = user_id
        self.project_name = project_name
        self.region = region
        self.resource_prefix = self._generate_resource_prefix()

        # Initialize AWS clients
        self.s3_client = boto3.client('s3', region_name=region)
        self.cf_client = boto3.client('cloudfront', region_name=region)
        self.lambda_client = boto3.client('lambda', region_name=region)
        self.apigateway_client = boto3.client('apigatewayv2', region_name=region)

    def _generate_resource_prefix(self) -> str:
        """Generate consistent resource prefix"""
        user_short = self.user_id[:6].lower()
        slug = ''.join(c if c.isalnum() else '-' for c in self.project_name.lower())
        slug = '-'.join(filter(None, slug.split('-')))[:30]
        return f"cocreate-{user_short}-{slug}"

    async def create_s3_bucket(self) -> AWSResource:
        """
        Create an S3 bucket for hosting static files.

        Returns:
            AWSResource with bucket details
        """
        bucket_name = self.resource_prefix

        try:
            # Create bucket (different call for us-east-1)
            if self.region == 'us-east-1':
                self.s3_client.create_bucket(Bucket=bucket_name)
            else:
                self.s3_client.create_bucket(
                    Bucket=bucket_name,
                    CreateBucketConfiguration={'LocationConstraint': self.region}
                )

            # Configure for static website hosting
            self.s3_client.put_bucket_website_configuration(
                Bucket=bucket_name,
                WebsiteConfiguration={
                    'IndexDocument': {'Suffix': 'index.html'},
                    'ErrorDocument': {'Key': 'index.html'}  # SPA fallback
                }
            )

            # Set bucket policy for CloudFront access
            # We'll use OAC (Origin Access Control) instead of public access
            self.s3_client.put_public_access_block(
                Bucket=bucket_name,
                PublicAccessBlockConfiguration={
                    'BlockPublicAcls': True,
                    'IgnorePublicAcls': True,
                    'BlockPublicPolicy': True,
                    'RestrictPublicBuckets': True
                }
            )

            # Enable versioning for rollback support
            self.s3_client.put_bucket_versioning(
                Bucket=bucket_name,
                VersioningConfiguration={'Status': 'Enabled'}
            )

            arn = f"arn:aws:s3:::{bucket_name}"

            return AWSResource(
                resource_type="s3Bucket",
                name=bucket_name,
                arn=arn,
                region=self.region,
                status="active"
            )

        except ClientError as e:
            error_code = e.response['Error']['Code']
            if error_code == 'BucketAlreadyOwnedByYou':
                # Bucket exists, return it
                return AWSResource(
                    resource_type="s3Bucket",
                    name=bucket_name,
                    arn=f"arn:aws:s3:::{bucket_name}",
                    region=self.region,
                    status="active"
                )
            raise Exception(f"Failed to create S3 bucket: {e}")

    async def create_cloudfront_distribution(
        self,
        s3_bucket_name: str
    ) -> AWSResource:
        """
        Create a CloudFront distribution for the S3 bucket.

        Args:
            s3_bucket_name: Name of the origin S3 bucket

        Returns:
            AWSResource with distribution details
        """
        # Create Origin Access Control
        oac_name = f"{self.resource_prefix}-oac"

        try:
            oac_response = self.cf_client.create_origin_access_control(
                OriginAccessControlConfig={
                    'Name': oac_name,
                    'Description': f'OAC for {self.resource_prefix}',
                    'SigningProtocol': 'sigv4',
                    'SigningBehavior': 'always',
                    'OriginAccessControlOriginType': 's3'
                }
            )
            oac_id = oac_response['OriginAccessControl']['Id']
        except ClientError as e:
            if 'OriginAccessControlAlreadyExists' in str(e):
                # Get existing OAC
                oac_list = self.cf_client.list_origin_access_controls()
                for oac in oac_list.get('OriginAccessControlList', {}).get('Items', []):
                    if oac['Name'] == oac_name:
                        oac_id = oac['Id']
                        break
            else:
                raise

        # Create CloudFront distribution
        s3_origin = f"{s3_bucket_name}.s3.{self.region}.amazonaws.com"
        caller_reference = f"{self.resource_prefix}-{datetime.utcnow().timestamp()}"

        distribution_config = {
            'CallerReference': caller_reference,
            'Comment': f'Distribution for {self.project_name}',
            'Enabled': True,
            'Origins': {
                'Quantity': 1,
                'Items': [{
                    'Id': f'{s3_bucket_name}-origin',
                    'DomainName': s3_origin,
                    'S3OriginConfig': {
                        'OriginAccessIdentity': ''
                    },
                    'OriginAccessControlId': oac_id
                }]
            },
            'DefaultCacheBehavior': {
                'TargetOriginId': f'{s3_bucket_name}-origin',
                'ViewerProtocolPolicy': 'redirect-to-https',
                'AllowedMethods': {
                    'Quantity': 2,
                    'Items': ['GET', 'HEAD'],
                    'CachedMethods': {
                        'Quantity': 2,
                        'Items': ['GET', 'HEAD']
                    }
                },
                'CachePolicyId': '658327ea-f89d-4fab-a63d-7e88639e58f6',  # CachingOptimized
                'Compress': True
            },
            'DefaultRootObject': 'index.html',
            'CustomErrorResponses': {
                'Quantity': 1,
                'Items': [{
                    'ErrorCode': 404,
                    'ResponsePagePath': '/index.html',
                    'ResponseCode': '200',
                    'ErrorCachingMinTTL': 0
                }]
            },
            'PriceClass': 'PriceClass_100',  # US, Canada, Europe only
            'ViewerCertificate': {
                'CloudFrontDefaultCertificate': True
            }
        }

        try:
            response = self.cf_client.create_distribution(
                DistributionConfig=distribution_config
            )

            distribution = response['Distribution']
            distribution_id = distribution['Id']
            domain_name = distribution['DomainName']
            arn = distribution['ARN']

            # Update S3 bucket policy to allow CloudFront access
            bucket_policy = {
                "Version": "2012-10-17",
                "Statement": [{
                    "Sid": "AllowCloudFrontServicePrincipal",
                    "Effect": "Allow",
                    "Principal": {
                        "Service": "cloudfront.amazonaws.com"
                    },
                    "Action": "s3:GetObject",
                    "Resource": f"arn:aws:s3:::{s3_bucket_name}/*",
                    "Condition": {
                        "StringEquals": {
                            "AWS:SourceArn": arn
                        }
                    }
                }]
            }

            self.s3_client.put_bucket_policy(
                Bucket=s3_bucket_name,
                Policy=json.dumps(bucket_policy)
            )

            return AWSResource(
                resource_type="cloudfront",
                name=f"{self.resource_prefix}-cf",
                arn=arn,
                region="global",
                status="deploying",  # CloudFront takes time to deploy
                distribution_id=distribution_id,
                domain_name=domain_name
            )

        except ClientError as e:
            raise Exception(f"Failed to create CloudFront distribution: {e}")

    async def run_build(self, project_path: str) -> BuildResult:
        """
        Run production build for the project.

        Args:
            project_path: Path to the project directory

        Returns:
            BuildResult with build output path
        """
        project_dir = Path(project_path)
        logs = []

        try:
            # Check for package.json
            package_json = project_dir / "package.json"
            if not package_json.exists():
                return BuildResult(
                    success=False,
                    error="No package.json found"
                )

            # Install dependencies if needed
            node_modules = project_dir / "node_modules"
            if not node_modules.exists():
                logs.append("Installing dependencies...")
                result = subprocess.run(
                    ["npm", "install"],
                    cwd=project_dir,
                    capture_output=True,
                    text=True,
                    timeout=300
                )
                if result.returncode != 0:
                    return BuildResult(
                        success=False,
                        error=f"npm install failed: {result.stderr}",
                        logs=logs
                    )
                logs.append("Dependencies installed")

            # Run build
            logs.append("Running production build...")
            result = subprocess.run(
                ["npm", "run", "build"],
                cwd=project_dir,
                capture_output=True,
                text=True,
                timeout=300
            )

            if result.returncode != 0:
                return BuildResult(
                    success=False,
                    error=f"Build failed: {result.stderr}",
                    logs=logs
                )

            # Find build output directory
            possible_dirs = ["dist", "build", "out", ".next/static"]
            output_path = None
            for dir_name in possible_dirs:
                dir_path = project_dir / dir_name
                if dir_path.exists():
                    output_path = str(dir_path)
                    break

            if not output_path:
                return BuildResult(
                    success=False,
                    error="Build output directory not found",
                    logs=logs
                )

            logs.append(f"Build complete: {output_path}")

            return BuildResult(
                success=True,
                output_path=output_path,
                logs=logs
            )

        except subprocess.TimeoutExpired:
            return BuildResult(
                success=False,
                error="Build timed out after 5 minutes",
                logs=logs
            )
        except Exception as e:
            return BuildResult(
                success=False,
                error=str(e),
                logs=logs
            )

    async def upload_to_s3(
        self,
        source_path: str,
        bucket_name: str
    ) -> UploadResult:
        """
        Upload build output to S3 bucket.

        Args:
            source_path: Path to the build output directory
            bucket_name: S3 bucket name

        Returns:
            UploadResult with upload statistics
        """
        source_dir = Path(source_path)
        if not source_dir.exists():
            return UploadResult(
                success=False,
                error=f"Source path does not exist: {source_path}"
            )

        files_count = 0
        total_size = 0

        # Content type mapping
        content_types = {
            '.html': 'text/html',
            '.css': 'text/css',
            '.js': 'application/javascript',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon',
            '.woff': 'font/woff',
            '.woff2': 'font/woff2',
            '.ttf': 'font/ttf',
            '.eot': 'application/vnd.ms-fontobject',
            '.map': 'application/json',
            '.txt': 'text/plain',
            '.xml': 'application/xml',
            '.webp': 'image/webp'
        }

        try:
            for file_path in source_dir.rglob('*'):
                if file_path.is_file():
                    relative_path = file_path.relative_to(source_dir)
                    s3_key = str(relative_path).replace('\\', '/')

                    # Determine content type
                    ext = file_path.suffix.lower()
                    content_type = content_types.get(ext, 'application/octet-stream')

                    # Set cache headers
                    cache_control = 'max-age=31536000'  # 1 year for assets
                    if ext == '.html':
                        cache_control = 'no-cache, no-store, must-revalidate'

                    # Upload file
                    with open(file_path, 'rb') as f:
                        file_content = f.read()
                        total_size += len(file_content)

                    self.s3_client.put_object(
                        Bucket=bucket_name,
                        Key=s3_key,
                        Body=file_content,
                        ContentType=content_type,
                        CacheControl=cache_control
                    )

                    files_count += 1

            return UploadResult(
                success=True,
                files_count=files_count,
                total_size=total_size
            )

        except ClientError as e:
            return UploadResult(
                success=False,
                files_count=files_count,
                total_size=total_size,
                error=str(e)
            )

    async def invalidate_cloudfront_cache(
        self,
        distribution_id: str,
        paths: List[str] = None
    ):
        """
        Invalidate CloudFront cache for the distribution.

        Args:
            distribution_id: CloudFront distribution ID
            paths: Paths to invalidate (default: all)
        """
        if paths is None:
            paths = ['/*']

        caller_reference = f"invalidation-{datetime.utcnow().timestamp()}"

        try:
            self.cf_client.create_invalidation(
                DistributionId=distribution_id,
                InvalidationBatch={
                    'Paths': {
                        'Quantity': len(paths),
                        'Items': paths
                    },
                    'CallerReference': caller_reference
                }
            )
        except ClientError as e:
            raise Exception(f"Failed to invalidate CloudFront cache: {e}")

    async def delete_s3_bucket(self, bucket_name: str):
        """
        Delete an S3 bucket and all its contents.

        Args:
            bucket_name: Name of the bucket to delete
        """
        try:
            # First, delete all objects (including versions)
            paginator = self.s3_client.get_paginator('list_object_versions')
            for page in paginator.paginate(Bucket=bucket_name):
                objects_to_delete = []

                for version in page.get('Versions', []):
                    objects_to_delete.append({
                        'Key': version['Key'],
                        'VersionId': version['VersionId']
                    })

                for marker in page.get('DeleteMarkers', []):
                    objects_to_delete.append({
                        'Key': marker['Key'],
                        'VersionId': marker['VersionId']
                    })

                if objects_to_delete:
                    self.s3_client.delete_objects(
                        Bucket=bucket_name,
                        Delete={'Objects': objects_to_delete}
                    )

            # Then delete the bucket
            self.s3_client.delete_bucket(Bucket=bucket_name)

        except ClientError as e:
            raise Exception(f"Failed to delete S3 bucket: {e}")

    async def delete_cloudfront_distribution(self, distribution_id: str):
        """
        Delete a CloudFront distribution (must be disabled first).

        Args:
            distribution_id: Distribution ID to delete
        """
        try:
            # Get distribution config
            response = self.cf_client.get_distribution_config(Id=distribution_id)
            config = response['DistributionConfig']
            etag = response['ETag']

            # Disable if enabled
            if config['Enabled']:
                config['Enabled'] = False
                self.cf_client.update_distribution(
                    Id=distribution_id,
                    DistributionConfig=config,
                    IfMatch=etag
                )

                # Wait for distribution to be disabled
                waiter = self.cf_client.get_waiter('distribution_deployed')
                waiter.wait(Id=distribution_id)

                # Get new ETag
                response = self.cf_client.get_distribution_config(Id=distribution_id)
                etag = response['ETag']

            # Delete distribution
            self.cf_client.delete_distribution(Id=distribution_id, IfMatch=etag)

        except ClientError as e:
            raise Exception(f"Failed to delete CloudFront distribution: {e}")
