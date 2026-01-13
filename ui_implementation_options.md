 ---
  Animation/Visual Framework Options

  | Option                      | Best For                                     | Performance | Impressiveness | Complexity |
  |-----------------------------|----------------------------------------------|-------------|----------------|------------|
  | Three.js                    | Full 3D scenes, particle backgrounds         | Medium      | ⭐⭐⭐⭐⭐     | High       |
  | GSAP + ScrollTrigger        | Scroll animations, timeline effects          | High        | ⭐⭐⭐⭐       | Medium     |
  | tsParticles                 | Particle backgrounds (lighter than Three.js) | High        | ⭐⭐⭐⭐       | Low        |
  | Framer Motion               | React page transitions                       | High        | ⭐⭐⭐         | Medium     |
  | Spline                      | No-code 3D embeds                            | Medium      | ⭐⭐⭐⭐⭐     | Low        |
  | CSS + Intersection Observer | Lightweight reveal animations                | Highest     | ⭐⭐⭐         | Low        |
  | Lottie                      | Vector animations (After Effects)            | High        | ⭐⭐⭐⭐       | Low        |

  ---
  UI Framework Options

  | Option       | Pros                                        | Cons                             |
  |--------------|---------------------------------------------|----------------------------------|
  | Tailwind CSS | Utility-first, unique designs, small bundle | Verbose classes                  |
  | Material UI  | Comprehensive, good theming                 | Can look generic, React required |
  | Vanilla CSS  | Zero dependencies, fastest                  | More manual work                 |
  | Bootstrap 5  | Quick setup                                 | Generic look                     |

  ---
  My Recommended Approaches

  Option A: Premium Minimal (Recommended)

  Tailwind CSS + GSAP ScrollTrigger + Three.js hero background
  - Subtle 3D particle/geometric animation in hero
  - Smooth scroll-triggered reveals
  - Clean, professional corporate feel
  - Best balance of impressive + performant

  Option B: Lightweight Elegant

  Tailwind CSS + tsParticles + CSS animations
  - Particle background (less heavy than Three.js)
  - CSS-based scroll reveals
  - Fastest loading
  - Best for mobile performance

  Option C: Full Immersive 3D

  React + Three.js (React Three Fiber) + Framer Motion
  - Full 3D interactive scene
  - Camera movements on scroll
  - Most impressive visually
  - Best for "wow" factor, higher complexity

  Option D: No-Code 3D

  Tailwind CSS + Spline embed + GSAP
  - Drag-and-drop 3D design in Spline
  - Easy to iterate visually
  - Best for quick iteration on 3D elements

  ---
  Deployment: S3 Static Hosting

  All options deploy the same way:
  # Build static files → Upload to S3 → Enable static hosting
  aws s3 sync ./dist s3://ai-product-studio-site --profile sunwaretech

  Optional: Add CloudFront CDN for global performance + HTTPS.

  ---
  My Recommendation for AI-Powered Product Studio

  Option A (Premium Minimal) because:
  1. Your audience is business founders — they want professional, not flashy
  2. Three.js hero gives the "tech co-founder" impression
  3. GSAP scroll animations feel polished
  4. Tailwind allows unique branding (not generic MUI look)
  5. Fast loading = better conversions

  Hero concept: Abstract floating geometric shapes or interconnected nodes (representing "partnership/collaboration") with subtle mouse parallax.
