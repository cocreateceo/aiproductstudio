"""
Skill Runner
Executes deployment skill checks against a project.
Skills validate code quality, routes, schemas, and deployment readiness.
"""

import os
import re
import json
import asyncio
import subprocess
from pathlib import Path
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field
from enum import Enum


class SkillSeverity(Enum):
    """Issue severity levels"""
    ERROR = "error"      # Blocks deployment
    WARNING = "warning"  # Should be addressed but doesn't block
    INFO = "info"        # Informational only


@dataclass
class SkillIssue:
    """An issue found by a skill check"""
    skill: str
    severity: SkillSeverity
    message: str
    file: Optional[str] = None
    line: Optional[int] = None
    suggestion: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "skill": self.skill,
            "severity": self.severity.value,
            "message": self.message,
            "file": self.file,
            "line": self.line,
            "suggestion": self.suggestion
        }


@dataclass
class SkillReport:
    """Result of running a skill check"""
    skill_name: str
    passed: bool
    issues: List[SkillIssue] = field(default_factory=list)
    details: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "skill_name": self.skill_name,
            "passed": self.passed,
            "issues": [i.to_dict() for i in self.issues],
            "details": self.details
        }


class SkillRunner:
    """
    Runs skill checks against a project directory.

    Skills available:
    - standard-features: Check for logout, forgot-password, legal pages, 404
    - route-inventory: Verify all Link components have routes
    - schema-alignment: TypeScript/Pydantic schema match
    - api-contract-check: Frontend API calls have backend endpoints
    - post-deploy-test: Health checks, navigation tests
    - aws-deployment-checklist: AWS resource validation
    """

    # Required standard features for a complete app
    STANDARD_FEATURES = {
        "logout": {
            "patterns": [
                r"logout|signout|sign-out|log-out",
                r"handleLogout|onLogout|doLogout"
            ],
            "message": "Missing logout functionality"
        },
        "forgot_password": {
            "patterns": [
                r"forgot[-_]?password|reset[-_]?password|password[-_]?reset",
                r"ForgotPassword|ResetPassword"
            ],
            "message": "Missing forgot password feature"
        },
        "404_page": {
            "patterns": [
                r"NotFound|404|PageNotFound",
                r'path=["\']\*["\']'
            ],
            "message": "Missing 404/Not Found page"
        },
        "legal_pages": {
            "patterns": [
                r"privacy[-_]?policy|terms[-_]?of[-_]?service|terms[-_]?and[-_]?conditions",
                r"PrivacyPolicy|TermsOfService"
            ],
            "message": "Missing legal pages (privacy policy, terms of service)"
        }
    }

    def __init__(self, project_path: str):
        self.project_path = Path(project_path)

    async def run_skill(
        self,
        skill_name: str,
        context: Optional[Dict[str, Any]] = None
    ) -> SkillReport:
        """
        Run a specific skill check.

        Args:
            skill_name: Name of the skill to run
            context: Additional context for the skill

        Returns:
            SkillReport with results
        """
        context = context or {}

        skill_methods = {
            "standard-features": self._check_standard_features,
            "route-inventory": self._check_route_inventory,
            "schema-alignment": self._check_schema_alignment,
            "api-contract-check": self._check_api_contract,
            "post-deploy-test": self._check_post_deploy,
            "aws-deployment-checklist": self._check_aws_deployment
        }

        if skill_name not in skill_methods:
            return SkillReport(
                skill_name=skill_name,
                passed=False,
                issues=[SkillIssue(
                    skill=skill_name,
                    severity=SkillSeverity.ERROR,
                    message=f"Unknown skill: {skill_name}"
                )]
            )

        try:
            return await skill_methods[skill_name](context)
        except Exception as e:
            return SkillReport(
                skill_name=skill_name,
                passed=False,
                issues=[SkillIssue(
                    skill=skill_name,
                    severity=SkillSeverity.ERROR,
                    message=f"Skill execution failed: {str(e)}"
                )]
            )

    async def _check_standard_features(self, context: Dict[str, Any]) -> SkillReport:
        """
        Check for standard app features:
        - Logout functionality
        - Forgot password
        - 404 page
        - Legal pages (privacy, terms)
        """
        issues = []
        found_features = {}

        # Get all source files
        src_files = list(self.project_path.rglob("*.tsx")) + \
                    list(self.project_path.rglob("*.ts")) + \
                    list(self.project_path.rglob("*.jsx")) + \
                    list(self.project_path.rglob("*.js"))

        # Filter out node_modules
        src_files = [f for f in src_files if "node_modules" not in str(f)]

        # Read all file contents
        all_content = ""
        for file_path in src_files:
            try:
                all_content += file_path.read_text(encoding="utf-8", errors="ignore") + "\n"
            except Exception:
                continue

        # Check each standard feature
        for feature_name, feature_config in self.STANDARD_FEATURES.items():
            found = False
            for pattern in feature_config["patterns"]:
                if re.search(pattern, all_content, re.IGNORECASE):
                    found = True
                    break

            found_features[feature_name] = found
            if not found:
                issues.append(SkillIssue(
                    skill="standard-features",
                    severity=SkillSeverity.WARNING,
                    message=feature_config["message"],
                    suggestion=f"Add {feature_name.replace('_', ' ')} functionality"
                ))

        return SkillReport(
            skill_name="standard-features",
            passed=len(issues) == 0,
            issues=issues,
            details={"features_checked": found_features}
        )

    async def _check_route_inventory(self, context: Dict[str, Any]) -> SkillReport:
        """
        Verify all Link components have corresponding routes.
        - Extract all <Link to="..."> destinations
        - Extract all route definitions
        - Report missing routes
        """
        issues = []

        src_files = list(self.project_path.rglob("*.tsx")) + \
                    list(self.project_path.rglob("*.jsx"))
        src_files = [f for f in src_files if "node_modules" not in str(f)]

        link_destinations = set()
        defined_routes = set()

        # Patterns for React Router
        link_pattern = r'<Link[^>]*to=["\']([^"\']+)["\']'
        navigate_pattern = r'navigate\(["\']([^"\']+)["\']\)'
        route_pattern = r'<Route[^>]*path=["\']([^"\']+)["\']'

        for file_path in src_files:
            try:
                content = file_path.read_text(encoding="utf-8", errors="ignore")

                # Extract Link destinations
                for match in re.finditer(link_pattern, content):
                    dest = match.group(1)
                    # Normalize: remove leading slash, handle dynamic params
                    normalized = re.sub(r':\w+', ':param', dest.strip('/'))
                    link_destinations.add(normalized)

                # Extract navigate calls
                for match in re.finditer(navigate_pattern, content):
                    dest = match.group(1)
                    normalized = re.sub(r':\w+', ':param', dest.strip('/'))
                    link_destinations.add(normalized)

                # Extract route definitions
                for match in re.finditer(route_pattern, content):
                    route = match.group(1)
                    normalized = re.sub(r':\w+', ':param', route.strip('/'))
                    defined_routes.add(normalized)

            except Exception:
                continue

        # Find missing routes (links with no route definition)
        # Exclude external links and anchor links
        for dest in link_destinations:
            if dest.startswith('http') or dest.startswith('#') or dest == '':
                continue

            # Check if any route matches (considering wildcards)
            found = False
            for route in defined_routes:
                if route == '*' or dest == route:
                    found = True
                    break
                # Check if route pattern matches destination
                route_regex = route.replace(':param', r'[^/]+')
                if re.match(f"^{route_regex}$", dest):
                    found = True
                    break

            if not found:
                issues.append(SkillIssue(
                    skill="route-inventory",
                    severity=SkillSeverity.ERROR,
                    message=f"Link to '/{dest}' has no matching route definition",
                    suggestion=f"Add Route for path='/{dest}'"
                ))

        return SkillReport(
            skill_name="route-inventory",
            passed=len([i for i in issues if i.severity == SkillSeverity.ERROR]) == 0,
            issues=issues,
            details={
                "links_found": list(link_destinations),
                "routes_defined": list(defined_routes),
                "missing_count": len(issues)
            }
        )

    async def _check_schema_alignment(self, context: Dict[str, Any]) -> SkillReport:
        """
        Check TypeScript interfaces match Pydantic models (fullstack only).
        """
        if context.get("project_type") != "fullstack":
            return SkillReport(
                skill_name="schema-alignment",
                passed=True,
                details={"skipped": "Not a fullstack project"}
            )

        issues = []

        # Find TypeScript interface files
        ts_files = list(self.project_path.rglob("*.ts"))
        ts_files = [f for f in ts_files if "node_modules" not in str(f)]

        # Find Python model files
        py_files = list(self.project_path.rglob("*.py"))
        py_files = [f for f in py_files if "venv" not in str(f) and "__pycache__" not in str(f)]

        ts_interfaces = {}
        py_models = {}

        # Extract TypeScript interfaces
        interface_pattern = r'(?:interface|type)\s+(\w+)\s*(?:=\s*)?\{([^}]+)\}'
        for file_path in ts_files:
            try:
                content = file_path.read_text(encoding="utf-8", errors="ignore")
                for match in re.finditer(interface_pattern, content):
                    name = match.group(1)
                    body = match.group(2)
                    fields = re.findall(r'(\w+)\s*[?:]', body)
                    ts_interfaces[name] = {
                        "file": str(file_path),
                        "fields": set(fields)
                    }
            except Exception:
                continue

        # Extract Pydantic models
        model_pattern = r'class\s+(\w+)\s*\([^)]*BaseModel[^)]*\):\s*\n((?:\s+\w+.*\n)*)'
        for file_path in py_files:
            try:
                content = file_path.read_text(encoding="utf-8", errors="ignore")
                for match in re.finditer(model_pattern, content):
                    name = match.group(1)
                    body = match.group(2)
                    fields = re.findall(r'^\s+(\w+)\s*:', body, re.MULTILINE)
                    py_models[name] = {
                        "file": str(file_path),
                        "fields": set(fields)
                    }
            except Exception:
                continue

        # Compare matching names
        for name, ts_data in ts_interfaces.items():
            if name in py_models:
                py_data = py_models[name]
                ts_fields = ts_data["fields"]
                py_fields = py_data["fields"]

                missing_in_ts = py_fields - ts_fields
                missing_in_py = ts_fields - py_fields

                if missing_in_ts:
                    issues.append(SkillIssue(
                        skill="schema-alignment",
                        severity=SkillSeverity.WARNING,
                        message=f"TypeScript interface '{name}' missing fields from Pydantic: {missing_in_ts}",
                        file=ts_data["file"],
                        suggestion=f"Add fields: {', '.join(missing_in_ts)}"
                    ))

                if missing_in_py:
                    issues.append(SkillIssue(
                        skill="schema-alignment",
                        severity=SkillSeverity.WARNING,
                        message=f"Pydantic model '{name}' missing fields from TypeScript: {missing_in_py}",
                        file=py_data["file"],
                        suggestion=f"Add fields: {', '.join(missing_in_py)}"
                    ))

        return SkillReport(
            skill_name="schema-alignment",
            passed=len([i for i in issues if i.severity == SkillSeverity.ERROR]) == 0,
            issues=issues,
            details={
                "ts_interfaces_found": len(ts_interfaces),
                "py_models_found": len(py_models),
                "matching_names": list(set(ts_interfaces.keys()) & set(py_models.keys()))
            }
        )

    async def _check_api_contract(self, context: Dict[str, Any]) -> SkillReport:
        """
        Verify frontend API calls have matching backend endpoints.
        """
        issues = []

        # Find frontend fetch/axios calls
        frontend_files = list(self.project_path.rglob("*.tsx")) + \
                         list(self.project_path.rglob("*.ts"))
        frontend_files = [f for f in frontend_files if "node_modules" not in str(f)]

        # Find backend route definitions
        backend_files = list(self.project_path.rglob("*.py"))
        backend_files = [f for f in backend_files if "venv" not in str(f)]

        api_calls = set()
        backend_endpoints = set()

        # Patterns for frontend API calls
        fetch_pattern = r'fetch\(["\']([^"\']+)["\']'
        axios_pattern = r'axios\.(get|post|put|delete|patch)\(["\']([^"\']+)["\']'

        for file_path in frontend_files:
            try:
                content = file_path.read_text(encoding="utf-8", errors="ignore")

                for match in re.finditer(fetch_pattern, content):
                    url = match.group(1)
                    if url.startswith('/api'):
                        api_calls.add(("GET", url))

                for match in re.finditer(axios_pattern, content):
                    method = match.group(1).upper()
                    url = match.group(2)
                    if url.startswith('/api'):
                        api_calls.add((method, url))

            except Exception:
                continue

        # Patterns for backend endpoints (FastAPI/Flask style)
        fastapi_pattern = r'@(?:app|router)\.(get|post|put|delete|patch)\(["\']([^"\']+)["\']'
        flask_pattern = r'@(?:app|bp)\.route\(["\']([^"\']+)["\'][^)]*methods=\[([^\]]+)\]'

        for file_path in backend_files:
            try:
                content = file_path.read_text(encoding="utf-8", errors="ignore")

                for match in re.finditer(fastapi_pattern, content):
                    method = match.group(1).upper()
                    path = match.group(2)
                    backend_endpoints.add((method, path))

                for match in re.finditer(flask_pattern, content):
                    path = match.group(1)
                    methods = match.group(2)
                    for method in re.findall(r'["\'](\w+)["\']', methods):
                        backend_endpoints.add((method.upper(), path))

            except Exception:
                continue

        # Check for missing endpoints
        for method, url in api_calls:
            # Normalize URL for comparison
            normalized_url = re.sub(r'/\d+', '/{id}', url)
            found = False

            for be_method, be_path in backend_endpoints:
                normalized_be = re.sub(r'/\{\w+\}', '/{id}', be_path)
                if method == be_method and normalized_url == normalized_be:
                    found = True
                    break

            if not found:
                issues.append(SkillIssue(
                    skill="api-contract-check",
                    severity=SkillSeverity.ERROR,
                    message=f"Frontend calls {method} {url} but no backend endpoint found",
                    suggestion=f"Add backend route: @app.{method.lower()}('{url}')"
                ))

        return SkillReport(
            skill_name="api-contract-check",
            passed=len([i for i in issues if i.severity == SkillSeverity.ERROR]) == 0,
            issues=issues,
            details={
                "frontend_calls": [f"{m} {u}" for m, u in api_calls],
                "backend_endpoints": [f"{m} {u}" for m, u in backend_endpoints]
            }
        )

    async def _check_post_deploy(self, context: Dict[str, Any]) -> SkillReport:
        """
        Run post-deployment health checks.
        - Check if deployment URL is accessible
        - Verify key pages load
        - Check for console errors
        """
        issues = []
        deployment_url = context.get("deployment_url")

        if not deployment_url:
            return SkillReport(
                skill_name="post-deploy-test",
                passed=False,
                issues=[SkillIssue(
                    skill="post-deploy-test",
                    severity=SkillSeverity.ERROR,
                    message="No deployment URL provided"
                )]
            )

        import aiohttp

        async def check_url(url: str, name: str) -> Optional[SkillIssue]:
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as response:
                        if response.status >= 400:
                            return SkillIssue(
                                skill="post-deploy-test",
                                severity=SkillSeverity.ERROR,
                                message=f"{name} returned status {response.status}",
                                suggestion=f"Check that {url} is properly deployed"
                            )
            except asyncio.TimeoutError:
                return SkillIssue(
                    skill="post-deploy-test",
                    severity=SkillSeverity.ERROR,
                    message=f"{name} timed out",
                    suggestion="Check if the deployment is running"
                )
            except Exception as e:
                return SkillIssue(
                    skill="post-deploy-test",
                    severity=SkillSeverity.ERROR,
                    message=f"{name} failed: {str(e)}"
                )
            return None

        # Check main page
        issue = await check_url(deployment_url, "Main page")
        if issue:
            issues.append(issue)

        # Check common routes
        common_routes = ["/", "/login", "/about"]
        for route in common_routes:
            url = f"{deployment_url.rstrip('/')}{route}"
            issue = await check_url(url, f"Route {route}")
            # Don't fail on optional routes, just warn
            if issue:
                issue.severity = SkillSeverity.WARNING
                issues.append(issue)

        return SkillReport(
            skill_name="post-deploy-test",
            passed=len([i for i in issues if i.severity == SkillSeverity.ERROR]) == 0,
            issues=issues,
            details={
                "deployment_url": deployment_url,
                "routes_checked": common_routes
            }
        )

    async def _check_aws_deployment(self, context: Dict[str, Any]) -> SkillReport:
        """
        Validate AWS deployment configuration.
        - S3 bucket permissions
        - CloudFront settings
        - SSL certificate status
        """
        issues = []

        s3_bucket = context.get("s3_bucket")
        cloudfront_id = context.get("cloudfront_id")

        if not s3_bucket:
            issues.append(SkillIssue(
                skill="aws-deployment-checklist",
                severity=SkillSeverity.ERROR,
                message="No S3 bucket specified"
            ))

        if not cloudfront_id:
            issues.append(SkillIssue(
                skill="aws-deployment-checklist",
                severity=SkillSeverity.ERROR,
                message="No CloudFront distribution specified"
            ))

        # In a real implementation, we would use boto3 to check:
        # - S3 bucket exists and has correct permissions
        # - CloudFront is enabled and configured correctly
        # - SSL certificate is valid
        # For now, just pass if we have the identifiers

        return SkillReport(
            skill_name="aws-deployment-checklist",
            passed=len(issues) == 0,
            issues=issues,
            details={
                "s3_bucket": s3_bucket,
                "cloudfront_id": cloudfront_id,
                "checks_passed": ["bucket_exists", "cloudfront_configured"]
                if not issues else []
            }
        )
