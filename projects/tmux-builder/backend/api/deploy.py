"""
Deploy API Router
FastAPI router for 1-click-deploy endpoints.
"""

import os
from typing import Optional
from datetime import datetime

from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from pydantic import BaseModel, Field

from ..deployment import (
    DeploymentOrchestrator,
    DeploymentConfig,
    DeploymentStatus,
    create_notifier
)


# ============================================
# Request/Response Models
# ============================================

class DeployRequest(BaseModel):
    """Request to start a deployment"""
    user_guid: str = Field(..., description="Cognito user UUID")
    session_guid: str = Field(..., description="Tmux session UUID (project ID)")
    project_name: str = Field(..., description="Human-readable project name")
    project_type: str = Field(default="frontend", description="frontend or fullstack")


class DeployResponse(BaseModel):
    """Response from deploy endpoint"""
    success: bool
    deployment_id: Optional[str] = None
    message: str
    websocket_channel: Optional[str] = None


class DeployStatusResponse(BaseModel):
    """Response from deployment status endpoint"""
    deployment_id: str
    status: str
    current_phase: Optional[str] = None
    progress: int = 0
    deployment_url: Optional[str] = None
    error: Optional[str] = None
    phases_completed: list = []
    resources_created: list = []


class SkillCheckRequest(BaseModel):
    """Request to run skill checks without deploying"""
    session_guid: str
    skills: list = Field(
        default=["standard-features", "route-inventory"],
        description="Skills to run"
    )


class SkillCheckResponse(BaseModel):
    """Response from skill check endpoint"""
    success: bool
    passed: bool
    skills_run: list
    issues: list
    details: dict


# ============================================
# State Management
# ============================================

# In-memory deployment tracking (use Redis/DynamoDB in production)
active_deployments: dict = {}


# ============================================
# Router
# ============================================

router = APIRouter(prefix="/api/deploy", tags=["deployment"])


def get_project_path(session_guid: str) -> str:
    """
    Get the project path for a Tmux session.
    This should be adapted to your Tmux Builder's directory structure.
    """
    # Example path structure
    base_path = os.environ.get("PROJECTS_BASE_PATH", "/home/ubuntu/projects")
    return os.path.join(base_path, session_guid)


def get_cocreate_api_url() -> str:
    """Get the CoCreate backend API URL"""
    return os.environ.get(
        "COCREATE_API_URL",
        "https://api.cocreateidea.com"
    )


# ============================================
# Endpoints
# ============================================

@router.post("", response_model=DeployResponse)
async def start_deployment(
    request: DeployRequest,
    background_tasks: BackgroundTasks
):
    """
    Start a new deployment for a project.

    This endpoint:
    1. Validates the project exists
    2. Creates a deployment record
    3. Starts the deployment in the background
    4. Returns immediately with deployment ID and WebSocket channel

    The client should connect to the WebSocket channel to receive real-time updates.
    """
    project_path = get_project_path(request.session_guid)

    # Validate project exists
    if not os.path.exists(project_path):
        raise HTTPException(
            status_code=404,
            detail=f"Project not found: {request.session_guid}"
        )

    # Check for existing active deployment
    existing = next(
        (d for d in active_deployments.values()
         if d["session_guid"] == request.session_guid
         and d["status"] == DeploymentStatus.IN_PROGRESS.value),
        None
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Deployment already in progress: {existing['deployment_id']}"
        )

    # Create deployment config
    config = DeploymentConfig(
        user_guid=request.user_guid,
        session_guid=request.session_guid,
        project_name=request.project_name,
        project_type=request.project_type,
        project_path=project_path,
        cocreate_api_url=get_cocreate_api_url()
    )

    # Create orchestrator with notifier
    notifier = create_notifier()  # Will use existing WS server if available
    orchestrator = DeploymentOrchestrator(config, notifier)

    # Track deployment
    deployment_id = orchestrator.deployment_id
    active_deployments[deployment_id] = {
        "deployment_id": deployment_id,
        "session_guid": request.session_guid,
        "project_name": request.project_name,
        "status": DeploymentStatus.PENDING.value,
        "started_at": datetime.utcnow().isoformat(),
        "orchestrator": orchestrator
    }

    # Start deployment in background
    background_tasks.add_task(run_deployment, deployment_id)

    return DeployResponse(
        success=True,
        deployment_id=deployment_id,
        message="Deployment started",
        websocket_channel=f"deploy:{deployment_id}"
    )


async def run_deployment(deployment_id: str):
    """Background task to run the deployment"""
    deployment = active_deployments.get(deployment_id)
    if not deployment:
        return

    orchestrator = deployment["orchestrator"]

    try:
        # Update status
        deployment["status"] = DeploymentStatus.IN_PROGRESS.value

        # Run the deployment
        result = await orchestrator.deploy()

        # Update final status
        deployment["status"] = result.status.value
        deployment["deployment_url"] = result.deployment_url
        deployment["completed_at"] = result.completed_at
        deployment["phases"] = [p.__dict__ for p in result.phases]
        deployment["resources"] = result.resources_created
        deployment["error"] = result.error

    except Exception as e:
        deployment["status"] = DeploymentStatus.FAILED.value
        deployment["error"] = str(e)


@router.get("/{deployment_id}", response_model=DeployStatusResponse)
async def get_deployment_status(deployment_id: str):
    """
    Get the status of a deployment.
    """
    deployment = active_deployments.get(deployment_id)
    if not deployment:
        raise HTTPException(
            status_code=404,
            detail=f"Deployment not found: {deployment_id}"
        )

    orchestrator = deployment.get("orchestrator")
    current_phase = None
    progress = 0

    if orchestrator:
        phases_completed = len(orchestrator.phases_completed)
        total_phases = 5
        progress = int((phases_completed / total_phases) * 100)

        if orchestrator.status == DeploymentStatus.IN_PROGRESS and phases_completed > 0:
            current_phase = orchestrator.phases_completed[-1].phase.value

    return DeployStatusResponse(
        deployment_id=deployment_id,
        status=deployment["status"],
        current_phase=current_phase,
        progress=progress,
        deployment_url=deployment.get("deployment_url"),
        error=deployment.get("error"),
        phases_completed=deployment.get("phases", []),
        resources_created=deployment.get("resources", [])
    )


@router.delete("/{deployment_id}")
async def cancel_deployment(deployment_id: str):
    """
    Cancel an in-progress deployment and rollback resources.
    """
    deployment = active_deployments.get(deployment_id)
    if not deployment:
        raise HTTPException(
            status_code=404,
            detail=f"Deployment not found: {deployment_id}"
        )

    if deployment["status"] != DeploymentStatus.IN_PROGRESS.value:
        raise HTTPException(
            status_code=400,
            detail="Deployment is not in progress"
        )

    orchestrator = deployment.get("orchestrator")
    if orchestrator:
        await orchestrator._rollback("Deployment cancelled by user")

    deployment["status"] = DeploymentStatus.ROLLED_BACK.value
    deployment["error"] = "Cancelled by user"

    return {"success": True, "message": "Deployment cancelled and rolled back"}


@router.post("/check-skills", response_model=SkillCheckResponse)
async def run_skill_checks(request: SkillCheckRequest):
    """
    Run skill checks on a project without deploying.

    Useful for pre-validation before triggering a full deployment.
    """
    from ..deployment import SkillRunner

    project_path = get_project_path(request.session_guid)

    if not os.path.exists(project_path):
        raise HTTPException(
            status_code=404,
            detail=f"Project not found: {request.session_guid}"
        )

    skill_runner = SkillRunner(project_path)

    all_issues = []
    skills_run = []
    all_details = {}

    for skill_name in request.skills:
        report = await skill_runner.run_skill(skill_name, {})
        skills_run.append(skill_name)
        all_issues.extend([i.to_dict() for i in report.issues])
        all_details[skill_name] = report.details

    passed = len([i for i in all_issues if i.get("severity") == "error"]) == 0

    return SkillCheckResponse(
        success=True,
        passed=passed,
        skills_run=skills_run,
        issues=all_issues,
        details=all_details
    )


@router.get("/{deployment_id}/resources")
async def get_deployment_resources(deployment_id: str):
    """
    Get all AWS resources created for a deployment.
    """
    deployment = active_deployments.get(deployment_id)
    if not deployment:
        raise HTTPException(
            status_code=404,
            detail=f"Deployment not found: {deployment_id}"
        )

    return {
        "success": True,
        "deployment_id": deployment_id,
        "resources": deployment.get("resources", [])
    }


@router.get("/{deployment_id}/logs")
async def get_deployment_logs(deployment_id: str, since: Optional[str] = None):
    """
    Get deployment logs/events.

    Args:
        deployment_id: The deployment ID
        since: Optional ISO timestamp to get events after
    """
    deployment = active_deployments.get(deployment_id)
    if not deployment:
        raise HTTPException(
            status_code=404,
            detail=f"Deployment not found: {deployment_id}"
        )

    orchestrator = deployment.get("orchestrator")
    if not orchestrator:
        return {"success": True, "logs": []}

    # Get messages from notifier
    channel = f"deploy:{deployment_id}"
    messages = orchestrator.notifier.get_messages(channel, since)

    return {
        "success": True,
        "deployment_id": deployment_id,
        "logs": messages
    }


# ============================================
# WebSocket Integration Placeholder
# ============================================

# If using FastAPI's WebSocket support, add this:
#
# from fastapi import WebSocket
#
# @router.websocket("/ws/{deployment_id}")
# async def deployment_websocket(websocket: WebSocket, deployment_id: str):
#     await websocket.accept()
#
#     notifier = create_notifier()
#     notifier.subscribe(f"deploy:{deployment_id}", websocket)
#
#     try:
#         while True:
#             # Keep connection alive
#             await websocket.receive_text()
#     except Exception:
#         pass
#     finally:
#         notifier.unsubscribe(f"deploy:{deployment_id}", websocket)
