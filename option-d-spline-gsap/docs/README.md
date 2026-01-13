# Option D: Spline-Style CSS 3D + GSAP

## Overview

A visually stunning landing page using pure CSS 3D transforms to create Spline-like 3D shapes, combined with gradient orb backgrounds and GSAP scroll animations. No external 3D libraries required - everything is CSS-based.

## Live Demo

**URL:** http://ai-product-studio-option-d.s3-website-us-east-1.amazonaws.com

## Tech Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| CSS 3D Transforms | Native | 3D shape rendering |
| GSAP | 3.12.2 | Animation engine |
| ScrollTrigger | 3.12.2 | Scroll-based animations |
| Tailwind CSS | 3.4 | Utility styling |

## Key Features

### 1. CSS 3D Shapes
Pure CSS-based 3D objects:
- **Cube**: 6-faced rotating box
- **Sphere**: CSS gradient sphere
- **Torus**: Ring shape with gradient
- **Pyramid**: 4-sided pyramid
- **Ring**: Flat ring shape

### 2. Gradient Orb Backgrounds
- Floating blurred gradient orbs
- Dynamic color shifting
- Creates depth without WebGL

### 3. Mouse Parallax
- Shapes respond to mouse movement
- Subtle depth-enhancing effect
- Smooth easing transitions

### 4. Four Theme Options
- **Dark**: Deep purple-black
- **Midnight**: Rich purple tones
- **Dusk**: Warm amber sunset
- **Light**: Soft gradient light

## File Structure

```
option-d-spline-gsap/
├── site/
│   └── index.html      # Main single-file application
└── docs/
    └── README.md       # This documentation
```

## CSS 3D Cube Implementation

```css
.shape-cube {
    width: 80px;
    height: 80px;
    transform-style: preserve-3d;
    animation: rotateCube 12s linear infinite;
}

.shape-cube > div {
    position: absolute;
    width: 80px;
    height: 80px;
    background: linear-gradient(135deg,
        rgba(99, 102, 241, 0.6),
        rgba(139, 92, 246, 0.3));
    border: 1px solid rgba(255, 255, 255, 0.2);
    backdrop-filter: blur(5px);
}

.shape-cube .front  { transform: translateZ(40px); }
.shape-cube .back   { transform: translateZ(-40px) rotateY(180deg); }
.shape-cube .right  { transform: translateX(40px) rotateY(90deg); }
.shape-cube .left   { transform: translateX(-40px) rotateY(-90deg); }
.shape-cube .top    { transform: translateY(-40px) rotateX(90deg); }
.shape-cube .bottom { transform: translateY(40px) rotateX(-90deg); }

@keyframes rotateCube {
    0% { transform: rotateX(0deg) rotateY(0deg); }
    100% { transform: rotateX(360deg) rotateY(360deg); }
}
```

## CSS 3D Sphere

```css
.shape-sphere {
    width: 100px;
    height: 100px;
    border-radius: 50%;
    background: radial-gradient(circle at 30% 30%,
        rgba(139, 92, 246, 0.8),
        rgba(99, 102, 241, 0.4) 50%,
        rgba(59, 130, 246, 0.2) 100%);
    box-shadow:
        inset -20px -20px 40px rgba(0, 0, 0, 0.4),
        inset 10px 10px 20px rgba(255, 255, 255, 0.1),
        0 0 60px rgba(139, 92, 246, 0.3);
    animation: float 6s ease-in-out infinite;
}

@keyframes float {
    0%, 100% { transform: translateY(0) rotateX(0deg); }
    50% { transform: translateY(-20px) rotateX(10deg); }
}
```

## Mouse Parallax Effect

```javascript
document.addEventListener('mousemove', (e) => {
    const mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
    const mouseY = (e.clientY / window.innerHeight - 0.5) * 2;

    shapes.forEach((shape, index) => {
        const depth = (index + 1) * 0.5;
        const moveX = mouseX * 30 * depth;
        const moveY = mouseY * 30 * depth;

        gsap.to(shape, {
            x: moveX,
            y: moveY,
            duration: 0.5,
            ease: "power2.out"
        });
    });
});
```

## Gradient Orb Backgrounds

```css
.gradient-orb {
    position: absolute;
    border-radius: 50%;
    filter: blur(60px);
    opacity: 0.5;
    animation: orbFloat 20s ease-in-out infinite;
}

.orb-1 {
    width: 400px;
    height: 400px;
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    top: 10%;
    left: 10%;
    animation-delay: 0s;
}

.orb-2 {
    width: 300px;
    height: 300px;
    background: linear-gradient(135deg, #8b5cf6, #a855f7);
    top: 60%;
    right: 10%;
    animation-delay: -5s;
}

@keyframes orbFloat {
    0%, 100% { transform: translate(0, 0) scale(1); }
    25% { transform: translate(50px, -30px) scale(1.1); }
    50% { transform: translate(-20px, 50px) scale(0.9); }
    75% { transform: translate(30px, 20px) scale(1.05); }
}
```

## Theme System

### CSS Variables

```css
:root {
    --bg-primary: #0a0810;
    --bg-secondary: #12101a;
    --text-primary: #ffffff;
    --accent: #8b5cf6;
    --accent-secondary: #a855f7;
    --orb-color-1: #6366f1;
    --orb-color-2: #8b5cf6;
}
```

### Theme Switching

```javascript
function setTheme(themeName) {
    const theme = themes[themeName];
    Object.entries(theme.vars).forEach(([key, value]) => {
        document.documentElement.style.setProperty(key, value);
    });
    updateOrbColors(theme);
    updateShapeColors(theme);
    localStorage.setItem('theme', themeName);
}
```

## Deployment

### S3 Static Hosting

```bash
# Create bucket
aws s3 mb s3://ai-product-studio-option-d --region us-east-1 --profile sunwaretech

# Configure public access
aws s3api put-public-access-block \
    --bucket ai-product-studio-option-d \
    --public-access-block-configuration "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false" \
    --profile sunwaretech

# Enable static website hosting
aws s3 website s3://ai-product-studio-option-d --index-document index.html --profile sunwaretech

# Apply bucket policy
aws s3api put-bucket-policy \
    --bucket ai-product-studio-option-d \
    --policy '{"Version":"2012-10-17","Statement":[{"Sid":"PublicReadGetObject","Effect":"Allow","Principal":"*","Action":"s3:GetObject","Resource":"arn:aws:s3:::ai-product-studio-option-d/*"}]}' \
    --profile sunwaretech

# Upload
aws s3 cp site/index.html s3://ai-product-studio-option-d/index.html \
    --content-type "text/html" --profile sunwaretech
```

## Performance Benefits

### Advantages over WebGL

| Aspect | CSS 3D | WebGL (Three.js) |
|--------|--------|------------------|
| GPU Usage | Low | High |
| Battery Impact | Minimal | Significant |
| Mobile Performance | Excellent | Variable |
| No JS Required | Possible | No |
| Hardware Acceleration | Yes | Yes |
| File Size | Smallest | Larger |

### Why CSS 3D?

1. **No external dependencies** for 3D shapes
2. **Hardware accelerated** via CSS transforms
3. **Works on low-end devices**
4. **Integrates seamlessly** with existing CSS
5. **Easy to customize** without 3D knowledge

## Comparison with Other Options

| Feature | Option A | Option B | Option C | Option D |
|---------|----------|----------|----------|----------|
| 3D Method | WebGL | Canvas 2D | WebGL | **CSS 3D** |
| Dependencies | Three.js | tsParticles | Three.js | **None** |
| Visual Style | Particles | Particles | Shapes | **Spline-like** |
| Performance | Medium | Excellent | Lower | **Excellent** |
| Mobile | Good | Best | Fair | **Best** |

## Customization

### Adding New CSS Shapes

```css
/* Pentagon */
.shape-pentagon {
    width: 80px;
    height: 76px;
    background: linear-gradient(135deg, var(--accent), var(--accent-secondary));
    clip-path: polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%);
    animation: float 8s ease-in-out infinite;
}

/* Hexagon */
.shape-hexagon {
    width: 87px;
    height: 100px;
    background: linear-gradient(135deg, var(--accent), var(--accent-secondary));
    clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
}
```

### Adjusting Animations

```css
/* Slower, more subtle rotation */
@keyframes slowRotate {
    0% { transform: rotateY(0deg); }
    100% { transform: rotateY(360deg); }
}

.shape-cube {
    animation: slowRotate 30s linear infinite;
}
```

## Browser Support

- Chrome 36+ (full support)
- Firefox 16+ (full support)
- Safari 9+ (full support)
- Edge 12+ (full support)

**Best compatibility** of all four options due to CSS-only 3D.

## License

Internal use - Sunware Technologies
