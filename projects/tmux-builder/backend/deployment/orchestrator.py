"""
Deployment Orchestrator
Main workflow controller for 1-click-deploy functionality.
Coordinates skill checks, AWS provisioning, and deployment phases.
"""

import asyncio
import uuid
from datetime import datetime
from enum import Enum
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, field

from .skill_runner import SkillRunner, SkillReport
from .aws_provisioner import AWSProvisioner, AWSResource
from .rollback_manager import RollbackManager
from .websocket_notifier import WebSocketNotifier


class DeploymentPhase(Enum):
    """Deployment workflow phases"""
    PRE_DEPLOY_CHECKS = "pre_deploy_checks"
    AWS_PROVISIONING = "aws_provisioning"
    CODE_DEPLOYMENT = "code_deployment"
    POST_DEPLOY_TESTS = "post_deploy_tests"
    FINALIZE = "finalize"


class DeploymentStatus(Enum):
    """Overall deployment status"""
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    ROLLED_BACK = "rolled_back"


@dataclass
class DeploymentConfig:
    """Configuration for a deployment"""
    user_guid: str
    session_guid: str
    project_name: str
    project_type: str  # "frontend" or "fullstack"
    project_path: str
    cocreate_api_url: str = "https://api.cocreateidea.com"
    cocreate_api_key: str = ""


@dataclass
class PhaseResult:
    """Result of a deployment phase"""
    phase: DeploymentPhase
    success: bool
    message: str
    details: Dict[str, Any] = field(default_factory=dict)
    duration_ms: int = 0


@dataclass
class DeploymentResult:
    """Final result of a deployment"""
    deployment_id: str
    status: DeploymentStatus
    deployment_url: Optional[str]
    phases: List[PhaseResult]
    resources_created: List[Dict[str, Any]]
    started_at: str
    completed_at: str
    error: Optional[str] = None


class DeploymentOrchestrator:
    """
    Orchestrates the full deployment workflow:
    1. Pre-deploy checks (skills validation)
    2. AWS provisioning (S3, CloudFront)
    3. Code deployment (build, upload)
    4. Post-deploy tests
    5. Finalization
    """

    def __init__(
        self,
        config: DeploymentConfig,
        notifier: Optional[WebSocketNotifier] = None
    ):
        self.config = config
        self.deployment_id = str(uuid.uuid4())
        self.notifier = notifier or WebSocketNotifier()

        self.skill_runner = SkillRunner(config.project_path)
        self.provisioner = AWSProvisioner(
            user_id=config.user_guid,
            project_name=config.project_name
        )
        self.rollback_manager = RollbackManager(self.provisioner)

        self.phases_completed: List[PhaseResult] = []
        self.resources_created: List[AWSResource] = []
        self.status = DeploymentStatus.PENDING

    async def deploy(self) -> DeploymentResult:
        """
        Execute the full deployment workflow.
        Returns DeploymentResult with status and details.
        """
        started_at = datetime.utcnow().isoformat()
        self.status = DeploymentStatus.IN_PROGRESS

        await self._notify("deployment_started", {
            "deployment_id": self.deployment_id,
            "project_name": self.config.project_name,
            "project_type": self.config.project_type
        })

        try:
            # Phase 1: Pre-deploy checks
            phase1 = await self._run_pre_deploy_checks()
            self.phases_completed.append(phase1)
            if not phase1.success:
                return await self._fail_deployment(
                    "Pre-deploy checks failed",
                    started_at,
                    phase1.details.get("issues", [])
                )

            # Phase 2: AWS Provisioning
            phase2 = await self._run_aws_provisioning()
            self.phases_completed.append(phase2)
            if not phase2.success:
                await self._rollback("AWS provisioning failed")
                return await self._fail_deployment(
                    "AWS provisioning failed",
                    started_at,
                    phase2.details
                )

            # Phase 3: Code Deployment
            phase3 = await self._run_code_deployment()
            self.phases_completed.append(phase3)
            if not phase3.success:
                await self._rollback("Code deployment failed")
                return await self._fail_deployment(
                    "Code deployment failed",
                    started_at,
                    phase3.details
                )

            # Phase 4: Post-deploy tests
            phase4 = await self._run_post_deploy_tests()
            self.phases_completed.append(phase4)
            if not phase4.success:
                await self._rollback("Post-deploy tests failed")
                return await self._fail_deployment(
                    "Post-deploy tests failed",
                    started_at,
                    phase4.details
                )

            # Phase 5: Finalize
            phase5 = await self._run_finalize()
            self.phases_completed.append(phase5)

            self.status = DeploymentStatus.COMPLETED
            completed_at = datetime.utcnow().isoformat()

            deployment_url = self._get_deployment_url()

            await self._notify("deployment_completed", {
                "deployment_id": self.deployment_id,
                "deployment_url": deployment_url,
                "status": "completed"
            })

            # Update CoCreate backend
            await self._update_cocreate_project_status("deployed", deployment_url)

            return DeploymentResult(
                deployment_id=self.deployment_id,
                status=self.status,
                deployment_url=deployment_url,
                phases=self.phases_completed,
                resources_created=[r.to_dict() for r in self.resources_created],
                started_at=started_at,
                completed_at=completed_at
            )

        except Exception as e:
            await self._rollback(str(e))
            return await self._fail_deployment(str(e), started_at, {"exception": str(e)})

    async def _run_pre_deploy_checks(self) -> PhaseResult:
        """
        Phase 1: Run pre-deployment skill checks
        - standard-features.md
        - route-inventory.md
        - schema-alignment.md (fullstack only)
        """
        start_time = datetime.utcnow()

        await self._notify("phase_started", {
            "phase": DeploymentPhase.PRE_DEPLOY_CHECKS.value,
            "message": "Running pre-deploy checks..."
        })

        skills_to_run = [
            "standard-features",
            "route-inventory"
        ]

        if self.config.project_type == "fullstack":
            skills_to_run.append("schema-alignment")

        all_issues = []
        for skill_name in skills_to_run:
            await self._notify("skill_started", {"skill": skill_name})

            report = await self.skill_runner.run_skill(skill_name, {
                "project_type": self.config.project_type
            })

            await self._notify("skill_completed", {
                "skill": skill_name,
                "success": report.passed,
                "issues_count": len(report.issues)
            })

            if not report.passed:
                all_issues.extend(report.issues)

        duration_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)

        if all_issues:
            return PhaseResult(
                phase=DeploymentPhase.PRE_DEPLOY_CHECKS,
                success=False,
                message=f"Pre-deploy checks failed with {len(all_issues)} issues",
                details={"issues": all_issues},
                duration_ms=duration_ms
            )

        return PhaseResult(
            phase=DeploymentPhase.PRE_DEPLOY_CHECKS,
            success=True,
            message="All pre-deploy checks passed",
            details={"skills_checked": skills_to_run},
            duration_ms=duration_ms
        )

    async def _run_aws_provisioning(self) -> PhaseResult:
        """
        Phase 2: Provision AWS resources
        - Create S3 bucket
        - Create CloudFront distribution
        - Run aws-deployment-checklist skill
        """
        start_time = datetime.utcnow()

        await self._notify("phase_started", {
            "phase": DeploymentPhase.AWS_PROVISIONING.value,
            "message": "Provisioning AWS resources..."
        })

        try:
            # Create S3 bucket
            await self._notify("resource_creating", {"type": "s3Bucket"})
            s3_resource = await self.provisioner.create_s3_bucket()
            self.resources_created.append(s3_resource)
            self.rollback_manager.track_resource(s3_resource)

            await self._notify("resource_created", {
                "type": "s3Bucket",
                "name": s3_resource.name,
                "arn": s3_resource.arn
            })

            # Update CoCreate with S3 resource
            await self._add_cocreate_resource("s3Bucket", {
                "name": s3_resource.name,
                "arn": s3_resource.arn,
                "region": s3_resource.region
            })

            # Create CloudFront distribution
            await self._notify("resource_creating", {"type": "cloudfront"})
            cf_resource = await self.provisioner.create_cloudfront_distribution(
                s3_bucket_name=s3_resource.name
            )
            self.resources_created.append(cf_resource)
            self.rollback_manager.track_resource(cf_resource)

            await self._notify("resource_created", {
                "type": "cloudfront",
                "distribution_id": cf_resource.distribution_id,
                "domain_name": cf_resource.domain_name
            })

            # Update CoCreate with CloudFront resource
            await self._add_cocreate_resource("cloudfront", {
                "distributionId": cf_resource.distribution_id,
                "domainName": cf_resource.domain_name
            })

            # Run AWS deployment checklist skill
            await self._notify("skill_started", {"skill": "aws-deployment-checklist"})
            checklist_report = await self.skill_runner.run_skill(
                "aws-deployment-checklist",
                {"s3_bucket": s3_resource.name, "cloudfront_id": cf_resource.distribution_id}
            )
            await self._notify("skill_completed", {
                "skill": "aws-deployment-checklist",
                "success": checklist_report.passed
            })

            duration_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)

            return PhaseResult(
                phase=DeploymentPhase.AWS_PROVISIONING,
                success=True,
                message="AWS resources provisioned successfully",
                details={
                    "s3_bucket": s3_resource.name,
                    "cloudfront_distribution": cf_resource.distribution_id,
                    "cloudfront_domain": cf_resource.domain_name
                },
                duration_ms=duration_ms
            )

        except Exception as e:
            duration_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)
            return PhaseResult(
                phase=DeploymentPhase.AWS_PROVISIONING,
                success=False,
                message=f"AWS provisioning failed: {str(e)}",
                details={"error": str(e)},
                duration_ms=duration_ms
            )

    async def _run_code_deployment(self) -> PhaseResult:
        """
        Phase 3: Build and deploy code
        - Run production build
        - Upload to S3
        - Invalidate CloudFront cache
        """
        start_time = datetime.utcnow()

        await self._notify("phase_started", {
            "phase": DeploymentPhase.CODE_DEPLOYMENT.value,
            "message": "Building and deploying code..."
        })

        try:
            # Get S3 bucket from provisioned resources
            s3_bucket = next(
                (r for r in self.resources_created if r.resource_type == "s3Bucket"),
                None
            )
            cf_distribution = next(
                (r for r in self.resources_created if r.resource_type == "cloudfront"),
                None
            )

            if not s3_bucket or not cf_distribution:
                raise Exception("Required AWS resources not found")

            # Run production build
            await self._notify("progress", {"step": "building", "progress": 10})
            build_result = await self.provisioner.run_build(self.config.project_path)

            if not build_result.success:
                raise Exception(f"Build failed: {build_result.error}")

            await self._notify("progress", {"step": "uploading", "progress": 50})

            # Upload to S3
            upload_result = await self.provisioner.upload_to_s3(
                source_path=build_result.output_path,
                bucket_name=s3_bucket.name
            )

            if not upload_result.success:
                raise Exception(f"Upload failed: {upload_result.error}")

            await self._notify("progress", {"step": "invalidating_cache", "progress": 80})

            # Invalidate CloudFront cache
            await self.provisioner.invalidate_cloudfront_cache(
                distribution_id=cf_distribution.distribution_id
            )

            await self._notify("progress", {"step": "complete", "progress": 100})

            duration_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)

            return PhaseResult(
                phase=DeploymentPhase.CODE_DEPLOYMENT,
                success=True,
                message="Code deployed successfully",
                details={
                    "files_uploaded": upload_result.files_count,
                    "total_size": upload_result.total_size
                },
                duration_ms=duration_ms
            )

        except Exception as e:
            duration_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)
            return PhaseResult(
                phase=DeploymentPhase.CODE_DEPLOYMENT,
                success=False,
                message=f"Code deployment failed: {str(e)}",
                details={"error": str(e)},
                duration_ms=duration_ms
            )

    async def _run_post_deploy_tests(self) -> PhaseResult:
        """
        Phase 4: Run post-deployment tests
        - post-deploy-test.md
        - api-contract-check.md (fullstack only)
        """
        start_time = datetime.utcnow()

        await self._notify("phase_started", {
            "phase": DeploymentPhase.POST_DEPLOY_TESTS.value,
            "message": "Running post-deploy tests..."
        })

        deployment_url = self._get_deployment_url()

        skills_to_run = ["post-deploy-test"]
        if self.config.project_type == "fullstack":
            skills_to_run.append("api-contract-check")

        all_issues = []
        for skill_name in skills_to_run:
            await self._notify("skill_started", {"skill": skill_name})

            report = await self.skill_runner.run_skill(skill_name, {
                "deployment_url": deployment_url,
                "project_type": self.config.project_type
            })

            await self._notify("skill_completed", {
                "skill": skill_name,
                "success": report.passed,
                "issues_count": len(report.issues)
            })

            if not report.passed:
                all_issues.extend(report.issues)

        duration_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)

        if all_issues:
            return PhaseResult(
                phase=DeploymentPhase.POST_DEPLOY_TESTS,
                success=False,
                message=f"Post-deploy tests failed with {len(all_issues)} issues",
                details={"issues": all_issues},
                duration_ms=duration_ms
            )

        return PhaseResult(
            phase=DeploymentPhase.POST_DEPLOY_TESTS,
            success=True,
            message="All post-deploy tests passed",
            details={"skills_checked": skills_to_run},
            duration_ms=duration_ms
        )

    async def _run_finalize(self) -> PhaseResult:
        """
        Phase 5: Finalize deployment
        - Update DynamoDB status
        - Send notifications
        """
        start_time = datetime.utcnow()

        await self._notify("phase_started", {
            "phase": DeploymentPhase.FINALIZE.value,
            "message": "Finalizing deployment..."
        })

        deployment_url = self._get_deployment_url()

        duration_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)

        return PhaseResult(
            phase=DeploymentPhase.FINALIZE,
            success=True,
            message="Deployment finalized",
            details={"deployment_url": deployment_url},
            duration_ms=duration_ms
        )

    async def _rollback(self, reason: str):
        """Rollback all created resources"""
        await self._notify("rollback_started", {"reason": reason})

        await self.rollback_manager.rollback_all()

        # Update CoCreate project status
        await self._update_cocreate_project_status("failed")

        await self._notify("rollback_completed", {
            "resources_deleted": len(self.resources_created)
        })

        self.status = DeploymentStatus.ROLLED_BACK

    async def _fail_deployment(
        self,
        error: str,
        started_at: str,
        details: Any
    ) -> DeploymentResult:
        """Create a failed deployment result"""
        self.status = DeploymentStatus.FAILED
        completed_at = datetime.utcnow().isoformat()

        await self._notify("deployment_failed", {
            "deployment_id": self.deployment_id,
            "error": error,
            "details": details
        })

        return DeploymentResult(
            deployment_id=self.deployment_id,
            status=self.status,
            deployment_url=None,
            phases=self.phases_completed,
            resources_created=[r.to_dict() for r in self.resources_created],
            started_at=started_at,
            completed_at=completed_at,
            error=error
        )

    def _get_deployment_url(self) -> Optional[str]:
        """Get the CloudFront deployment URL"""
        cf_resource = next(
            (r for r in self.resources_created if r.resource_type == "cloudfront"),
            None
        )
        if cf_resource and cf_resource.domain_name:
            return f"https://{cf_resource.domain_name}"
        return None

    async def _notify(self, event_type: str, data: Dict[str, Any]):
        """Send WebSocket notification"""
        await self.notifier.send(
            channel=f"deploy:{self.deployment_id}",
            event=event_type,
            data=data
        )

    async def _update_cocreate_project_status(
        self,
        status: str,
        deployment_url: Optional[str] = None
    ):
        """Update project status in CoCreate backend"""
        import aiohttp

        try:
            async with aiohttp.ClientSession() as session:
                payload = {
                    "action": "update-project-status",
                    "userId": self.config.user_guid,
                    "projectId": self.config.session_guid,
                    "status": status
                }
                if deployment_url:
                    payload["deploymentUrl"] = deployment_url

                async with session.post(
                    self.config.cocreate_api_url,
                    json=payload,
                    headers={"Content-Type": "application/json"}
                ) as response:
                    return await response.json()
        except Exception as e:
            print(f"Failed to update CoCreate project status: {e}")

    async def _add_cocreate_resource(
        self,
        resource_type: str,
        resource_data: Dict[str, Any]
    ):
        """Add resource to CoCreate project"""
        import aiohttp

        try:
            async with aiohttp.ClientSession() as session:
                payload = {
                    "action": "add-project-resource",
                    "userId": self.config.user_guid,
                    "projectId": self.config.session_guid,
                    "resourceType": resource_type,
                    "resourceData": resource_data
                }

                async with session.post(
                    self.config.cocreate_api_url,
                    json=payload,
                    headers={"Content-Type": "application/json"}
                ) as response:
                    return await response.json()
        except Exception as e:
            print(f"Failed to add CoCreate resource: {e}")
