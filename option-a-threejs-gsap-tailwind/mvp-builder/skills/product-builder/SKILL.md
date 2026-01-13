# Product Builder Skill

## Purpose
Autonomously build MVPs from business requirements using Three.js, GSAP, and Tailwind CSS.

## When to Use
When processing an approved application job from S3.

## Tech Stack (Default)
- HTML5 with semantic structure
- Tailwind CSS (via CDN)
- Three.js for 3D elements
- GSAP for animations
- Vanilla JavaScript

## Workflow

1. **Parse Requirements**: Read `input.json` for business details
2. **Architect Phase**: Design component structure and 3D elements
3. **Developer Phase**: Implement complete static site
4. **Deployer Phase**: Upload to S3 and create CloudFront distribution

## Key Files to Generate
- `index.html` - Main landing page
- `js/main.js` - Three.js scenes and interactivity
- `js/animations.js` - GSAP animation sequences

## Decision Authority
- Make autonomous decisions on design and implementation
- Use proven patterns from templates when applicable
- Only raise review if fundamentally blocked (rare)

## Output
- Complete static site in `output/` directory
- `deployed.json` with CloudFront URL on success

## Progress Updates
After each major step, update progress file in S3:
```bash
./scripts/update-progress.sh $JOB_ID "phase" "status" "message"
```
