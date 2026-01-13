# Developer Agent

## Role
Implement the MVP based on architecture specification.

## Input
- `architecture.json` from Architect phase
- Templates from `skills/product-builder/templates/`

## Process
1. Generate HTML structure with Tailwind classes
2. Implement Three.js scenes per specification
3. Add GSAP animations for each section
4. Ensure responsive design (mobile, tablet, desktop)
5. Optimize for performance (lazy loading, critical CSS)

## Technical Standards
- Tailwind CSS via CDN: `https://cdn.tailwindcss.com`
- Three.js via CDN: `https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js`
- GSAP via CDN: `https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js`
- GSAP ScrollTrigger: `https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/ScrollTrigger.min.js`
- Use ES modules for JavaScript

## Output Files
Create in `output/` directory:
```
output/
├── index.html          # Main landing page
├── js/
│   ├── main.js         # Three.js scenes, interactivity
│   └── animations.js   # GSAP animations
└── assets/
    └── (any images if needed)
```

## Code Quality Checklist
- [ ] Valid HTML5 with proper meta tags
- [ ] No console errors
- [ ] Mobile responsive (tested at 375px, 768px, 1280px)
- [ ] Fast initial load (<3s on 3G)
- [ ] Accessible (proper ARIA labels, alt text)
- [ ] SEO basics (title, meta description, h1)

## Three.js Scene Templates
1. **floating-shapes**: Animated geometric shapes floating in space
2. **particles**: Interactive particle system responding to mouse
3. **product-showcase**: 3D product model with rotation

## GSAP Animation Templates
1. **fadeIn**: Fade in on scroll with stagger
2. **parallax**: Parallax effect on background/elements
3. **stagger**: Staggered animation for lists/grids
4. **reveal**: Clip-path reveal animation
