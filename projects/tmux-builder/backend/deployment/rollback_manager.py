"""
Rollback Manager
Handles cleanup and rollback of AWS resources on deployment failure.
Tracks created resources and deletes them in reverse order.
"""

import asyncio
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum

from .aws_provisioner import AWSProvisioner, AWSResource


class RollbackStatus(Enum):
    """Status of a rollback operation"""
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    PARTIAL = "partial"  # Some resources failed to delete
    FAILED = "failed"


@dataclass
class RollbackEntry:
    """A resource to be rolled back"""
    resource: AWSResource
    order: int  # Deletion order (higher = delete first)
    status: str = "pending"
    error: Optional[str] = None


@dataclass
class RollbackReport:
    """Result of a rollback operation"""
    status: RollbackStatus
    resources_deleted: List[str]
    resources_failed: List[Dict[str, str]]
    started_at: str
    completed_at: str
    duration_ms: int


class RollbackManager:
    """
    Manages rollback of AWS resources on deployment failure.

    Deletion order (reverse of creation):
    1. CloudFront distribution (must be disabled first)
    2. API Gateway
    3. Lambda functions
    4. S3 bucket (must be emptied first)
    5. DynamoDB tables (if any)
    """

    # Resource deletion priority (higher = delete first)
    DELETION_PRIORITY = {
        "cloudfront": 100,
        "apiGateway": 90,
        "lambda": 80,
        "s3Bucket": 70,
        "dynamodb": 60
    }

    def __init__(self, provisioner: AWSProvisioner):
        self.provisioner = provisioner
        self.tracked_resources: List[RollbackEntry] = []

    def track_resource(self, resource: AWSResource):
        """
        Track a resource for potential rollback.

        Args:
            resource: The AWS resource to track
        """
        priority = self.DELETION_PRIORITY.get(resource.resource_type, 50)
        entry = RollbackEntry(
            resource=resource,
            order=priority
        )
        self.tracked_resources.append(entry)

    def get_tracked_resources(self) -> List[AWSResource]:
        """Get all tracked resources"""
        return [entry.resource for entry in self.tracked_resources]

    async def rollback_all(self) -> RollbackReport:
        """
        Rollback all tracked resources in proper order.

        Returns:
            RollbackReport with results
        """
        started_at = datetime.utcnow()
        resources_deleted = []
        resources_failed = []

        # Sort by priority (highest first)
        sorted_entries = sorted(
            self.tracked_resources,
            key=lambda e: e.order,
            reverse=True
        )

        for entry in sorted_entries:
            try:
                await self._delete_resource(entry.resource)
                entry.status = "deleted"
                resources_deleted.append(entry.resource.name)
            except Exception as e:
                entry.status = "failed"
                entry.error = str(e)
                resources_failed.append({
                    "name": entry.resource.name,
                    "type": entry.resource.resource_type,
                    "error": str(e)
                })

        completed_at = datetime.utcnow()
        duration_ms = int((completed_at - started_at).total_seconds() * 1000)

        # Determine status
        if not resources_failed:
            status = RollbackStatus.COMPLETED
        elif not resources_deleted:
            status = RollbackStatus.FAILED
        else:
            status = RollbackStatus.PARTIAL

        return RollbackReport(
            status=status,
            resources_deleted=resources_deleted,
            resources_failed=resources_failed,
            started_at=started_at.isoformat(),
            completed_at=completed_at.isoformat(),
            duration_ms=duration_ms
        )

    async def rollback_resource(self, resource_name: str) -> bool:
        """
        Rollback a specific resource by name.

        Args:
            resource_name: Name of the resource to rollback

        Returns:
            True if successful, False otherwise
        """
        entry = next(
            (e for e in self.tracked_resources if e.resource.name == resource_name),
            None
        )

        if not entry:
            return False

        try:
            await self._delete_resource(entry.resource)
            entry.status = "deleted"
            return True
        except Exception as e:
            entry.status = "failed"
            entry.error = str(e)
            return False

    async def _delete_resource(self, resource: AWSResource):
        """
        Delete a single AWS resource.

        Args:
            resource: The resource to delete
        """
        resource_type = resource.resource_type

        if resource_type == "cloudfront":
            if resource.distribution_id:
                await self.provisioner.delete_cloudfront_distribution(
                    resource.distribution_id
                )

        elif resource_type == "s3Bucket":
            await self.provisioner.delete_s3_bucket(resource.name)

        elif resource_type == "lambda":
            if resource.function_name:
                await self._delete_lambda(resource.function_name)

        elif resource_type == "apiGateway":
            if resource.api_id:
                await self._delete_api_gateway(resource.api_id)

        elif resource_type == "dynamodb":
            await self._delete_dynamodb_table(resource.name)

    async def _delete_lambda(self, function_name: str):
        """Delete a Lambda function"""
        try:
            self.provisioner.lambda_client.delete_function(
                FunctionName=function_name
            )
        except Exception as e:
            raise Exception(f"Failed to delete Lambda {function_name}: {e}")

    async def _delete_api_gateway(self, api_id: str):
        """Delete an API Gateway"""
        try:
            self.provisioner.apigateway_client.delete_api(ApiId=api_id)
        except Exception as e:
            raise Exception(f"Failed to delete API Gateway {api_id}: {e}")

    async def _delete_dynamodb_table(self, table_name: str):
        """Delete a DynamoDB table"""
        import boto3
        dynamodb = boto3.client('dynamodb', region_name=self.provisioner.region)

        try:
            dynamodb.delete_table(TableName=table_name)

            # Wait for table deletion
            waiter = dynamodb.get_waiter('table_not_exists')
            waiter.wait(TableName=table_name)
        except Exception as e:
            raise Exception(f"Failed to delete DynamoDB table {table_name}: {e}")

    def clear_tracked_resources(self):
        """Clear all tracked resources"""
        self.tracked_resources.clear()

    def get_rollback_status(self) -> Dict[str, Any]:
        """Get current status of all tracked resources"""
        return {
            "total_resources": len(self.tracked_resources),
            "resources": [
                {
                    "name": entry.resource.name,
                    "type": entry.resource.resource_type,
                    "status": entry.status,
                    "error": entry.error
                }
                for entry in self.tracked_resources
            ]
        }
