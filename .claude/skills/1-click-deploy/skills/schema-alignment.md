---
name: schema-alignment
description: Verify TypeScript interfaces match Pydantic schemas. Prevents undefined values and type errors in production.
---

# Schema Alignment Verification

## Overview

This skill ensures frontend TypeScript interfaces match backend Pydantic schemas. Misaligned schemas cause undefined values, NaN displays, and runtime errors.

**Core principle:** Frontend and backend must agree on data shapes.

## When to Use

- Before deploying new API endpoints
- After modifying response schemas
- When debugging undefined values in UI
- During API contract review

## The Verification Process

### Step 1: Identify Schema Pairs

```bash
# Find TypeScript interfaces/types
grep -rn "interface\|type " frontend/src/types/ frontend/src/hooks/

# Find Pydantic schemas
grep -rn "class.*BaseModel" backend/app/schemas/
```

Create mapping table:

| Feature | TypeScript Location | Pydantic Location |
|---------|---------------------|-------------------|
| User | types/user.ts | schemas/user.py |
| Application | hooks/useDashboard.ts | schemas/application.py |
| ApplicationStats | hooks/useDashboard.ts | api/v1/applications.py |
| Job | types/job.ts | schemas/job.py |
| Resume | hooks/useResume.ts | schemas/resume.py |

### Step 2: Compare Field by Field

For each schema pair, verify:

1. **Field names match exactly**
2. **Field types are compatible**
3. **Optional fields match**
4. **Nested structures align**

### Step 3: Document Mismatches

| Schema | Frontend Field | Backend Field | Status |
|--------|----------------|---------------|--------|
| ApplicationStats | `total_applications` | `total` | ❌ MISMATCH |
| ApplicationStats | `by_status` | N/A | ❌ MISSING |
| ApplicationStats | `interview_rate` | N/A | ❌ MISSING |
| ApplicationStats | `this_week` | N/A | ❌ MISSING |
| Resume | `file_type` | `content_type` | ❌ MISMATCH |
| Resume | `status` | `processing_status` | ❌ MISMATCH |

## Common Schema Mismatches

### Issue 1: Different Field Names

```typescript
// Frontend expects:
interface ApplicationStats {
  total_applications: number;  // ❌ Wrong name
  by_status: Record<string, number>;
}

// Backend returns:
class ApplicationStats(BaseModel):
    total: int  # Different name!
    pending: int
    interviewing: int
```

**Fix Option 1: Update backend**
```python
class ApplicationStats(BaseModel):
    total_applications: int  # Match frontend
    by_status: dict[str, int]

@router.get("/stats")
async def get_stats(...):
    return ApplicationStats(
        total_applications=total,
        by_status={
            "pending": pending_count,
            "interviewing": interview_count,
            ...
        }
    )
```

**Fix Option 2: Update frontend**
```typescript
interface ApplicationStats {
  total: number;  // Match backend
  pending: number;
  interviewing: number;
}
```

### Issue 2: Missing Fields

```typescript
// Frontend expects:
interface ApplicationStats {
  interview_rate: number;  // Backend doesn't return this!
  this_week: number;       // Backend doesn't return this!
}
```

**Fix: Add computed fields to backend**
```python
class ApplicationStats(BaseModel):
    total: int
    interview_rate: float  # Add
    this_week: int         # Add

@router.get("/stats")
async def get_stats(...):
    total = await count_applications(user_id)
    interviewing = await count_by_status(user_id, "interviewing")
    this_week = await count_since(user_id, days=7)

    return ApplicationStats(
        total=total,
        interview_rate=interviewing / total if total > 0 else 0,
        this_week=this_week
    )
```

### Issue 3: Type Mismatches

```typescript
// Frontend:
interface Job {
  salary: string;  // "50000-70000"
}

// Backend:
class Job(BaseModel):
    salary_min: int  # 50000
    salary_max: int  # 70000
```

**Fix: Transform in one direction**
```python
# Option 1: Add computed property
class JobResponse(BaseModel):
    salary_min: Optional[int]
    salary_max: Optional[int]

    @property
    def salary_range(self) -> str:
        if self.salary_min and self.salary_max:
            return f"${self.salary_min:,}-${self.salary_max:,}"
        return "Not specified"
```

### Issue 4: Nested Structure Differences

```typescript
// Frontend expects nested:
interface Application {
  job: {
    title: string;
    company: string;
  }
}

// Backend returns flat:
class Application(BaseModel):
    job_title: str
    company: str
```

**Fix: Either nest in backend or flatten in frontend**

## Schema Alignment Checklist

For each endpoint, verify:

- [ ] All field names match (case-sensitive)
- [ ] All field types are compatible
- [ ] Optional fields are marked optional on both sides
- [ ] Arrays/lists match (`[]` vs `List[]`)
- [ ] Objects/dicts match structure
- [ ] Date formats match (`ISO string` vs `datetime`)
- [ ] Enum values match
- [ ] Null handling matches (`null` vs `undefined` vs `None`)

## Type Compatibility Table

| TypeScript | Pydantic | Notes |
|------------|----------|-------|
| `number` | `int`, `float` | Both work |
| `string` | `str` | Direct match |
| `boolean` | `bool` | Direct match |
| `null` | `None` | Map carefully |
| `string[]` | `List[str]` | Direct match |
| `Record<string, T>` | `Dict[str, T]` | Direct match |
| `Date` | `datetime` | Serialize as ISO string |
| `T \| null` | `Optional[T]` | Match nullability |

## Verification Script

```bash
#!/bin/bash
# schema-check.sh

echo "=== Schema Alignment Check ==="

echo -e "\n=== ApplicationStats ==="
echo "Frontend expects:"
grep -A 10 "interface ApplicationStats\|type ApplicationStats" frontend/src/hooks/useDashboard.ts frontend/src/types/*.ts 2>/dev/null

echo -e "\nBackend returns:"
grep -A 10 "class ApplicationStats" backend/app/schemas/*.py backend/app/api/v1/*.py

echo -e "\n=== Resume ==="
echo "Frontend expects:"
grep -A 10 "interface Resume\|type Resume" frontend/src/hooks/useResume.ts frontend/src/types/*.ts 2>/dev/null

echo -e "\nBackend returns:"
grep -A 10 "class ResumeResponse\|class Resume" backend/app/schemas/*.py backend/app/api/v1/*.py

# Add more schemas as needed
```

## Output Format

```
=== Schema Alignment Report ===

✅ ALIGNED (5 schemas)
  - User ↔ UserResponse
  - Job ↔ JobResponse
  - Resume ↔ ResumeResponse
  ...

❌ MISALIGNED (2 schemas)

ApplicationStats:
  Frontend (useDashboard.ts:4-15):
    - total_applications: number
    - by_status: Record<string, number>
    - interview_rate: number
    - this_week: number

  Backend (applications.py:26-31):
    - total: int
    - pending: int
    - interviewing: int
    - offered: int
    - rejected: int

  Differences:
    - Field 'total_applications' → 'total' (name mismatch)
    - Field 'by_status' missing in backend
    - Field 'interview_rate' missing in backend
    - Field 'this_week' missing in backend

ResumeListItem:
  Frontend (useResume.ts:4-11):
    - file_type: string
    - status: string

  Backend (resume.py:189):
    - content_type: string
    - processing_status: string

  Differences:
    - Field 'file_type' → 'content_type' (name mismatch)
    - Field 'status' → 'processing_status' (name mismatch)

=== Action Required ===
1. Update ApplicationStats in applications.py to match frontend expectations
2. Add aliases or update ResumeResponse field names
```
