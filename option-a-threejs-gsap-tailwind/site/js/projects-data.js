/**
 * CoCreate Projects Data
 * --------------------------------------------------------------------------
 * Single source of truth for the Projects showcase (projects.html), the
 * per-category detail page (projects-category.html?cat=KEY), and the
 * click-to-open detail modal.
 *
 * Per-project fields:
 *   name        Display name (required).
 *   slug        Stable id — used for the card image filename + modal anchor.
 *   description One-line summary shown on the card.
 *   overview    Longer blurb shown in the detail modal.
 *   highlights  3–5 short feature bullets shown in the detail modal.
 *   liveUrl     Live site. Leave "" to show a "Coming soon" badge.
 *   featured    true to surface on the projects.html featured grid.
 *
 * CARD / MODAL IMAGE:
 *   - shotImg: "assets/projects/<slug>.webp"  → use this local image (real
 *     screenshot for live sites that don't auto-capture well, or a themed
 *     photo for coming-soon products). Missing files fall back to gradient+icon.
 *   - otherwise, live cards auto-capture a screenshot of liveUrl (thum.io).
 *   - photo: true marks a themed stock photo (centered) vs a screenshot (top).
 *
 * Each `icon` is an SVG path `d` string (Heroicons outline style).
 */
window.PROJECTS_DATA = [
  {
    key: "vedic",
    name: "Vedic & Spiritual",
    tagline: "Astrology, wellness, and spiritual-growth platforms powered by AI.",
    icon: "M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z",
    projects: [
      {
        name: "Vedic Astro", slug: "vedic-astro", featured: true,
        description: "Full Vedic astrology platform — kundli, horoscopes, panchang, and compatibility readings.",
        overview: "A complete Vedic astrology platform that turns 5,000 years of Indian astrological tradition into personalized, on-demand guidance — birth charts, daily horoscopes, and compatibility readings in one place.",
        highlights: ["Personalized kundli & birth-chart generation", "Daily, weekly & monthly horoscopes", "Panchang, doshas & nakshatra insights", "Relationship compatibility readings"],
        liveUrl: "https://astro.vedics.net", shotImg: "assets/projects/vedic-astro.webp"
      },
      {
        name: "Vedic Transform", slug: "vedic-transform",
        description: "Vedic transformation and spiritual-growth web app with guided journeys.",
        overview: "A guided 48-day transformation program that realigns body, mind, and energy through 11 Vedic transformation pillars — a scientific plus spiritual journey.",
        highlights: ["48-day guided transformation journey", "11 Vedic transformation pillars", "Body, mind & energy realignment"],
        liveUrl: "https://10x.vedics.net"
      },
      {
        name: "Vedic Avatar", slug: "vedic-avatar",
        description: "AI avatar that delivers personalized Vedic guidance and consultations.",
        overview: "A conversational AI avatar that delivers personalized Vedic guidance — bringing the experience of a one-on-one consultation to anyone, anytime.",
        highlights: ["Conversational AI avatar", "Personalized Vedic guidance", "On-demand consultations"],
        liveUrl: "", shotImg: "assets/projects/vedic-avatar.webp", photo: true
      },
      {
        name: "Vedic YouTube Studio", slug: "vedic-youtube",
        description: "Astro Vedics YouTube channel — automated Vedic astrology content.",
        overview: "The Astro Vedics YouTube channel — an automated content engine publishing daily Vedic astrology videos and horoscopes.",
        highlights: ["Automated Vedic astrology content", "Daily horoscope videos", "Growing subscriber community"],
        liveUrl: "https://www.youtube.com/@astrovedic-s"
      },
      {
        name: "Transform YouTube", slug: "transform-youtube",
        description: "Vedics Transform YouTube channel — transformation and spiritual content.",
        overview: "The Vedics Transform YouTube channel — transformation, meditation, and spiritual-growth content for a modern audience.",
        highlights: ["Transformation & spiritual content", "Guided meditation videos", "Modern take on ancient wisdom"],
        liveUrl: "https://www.youtube.com/@Vedics_Transform", shotImg: "assets/projects/transform-youtube.webp", photo: true
      },
      {
        name: "Vedic Wellness Store", slug: "wellness-store",
        description: "AyurVeda Living — e-commerce storefront for Vedic wellness products.",
        overview: "AyurVeda Living — an e-commerce storefront pairing AI-powered Ayurvedic consultation with curated wellness products matched to each user's dosha profile.",
        highlights: ["Curated Ayurvedic wellness products", "AI dosha-profile consultation", "Full e-commerce checkout"],
        liveUrl: "https://wellnessstore.vedics.net"
      },
      {
        name: "Vedic Landing", slug: "vedic-landing",
        description: "Vedics.net — ancient wisdom, modern living. Vedic services landing.",
        overview: "Vedics.net — the home of the Vedics ecosystem, bringing ancient wisdom into modern living and routing visitors to every Vedic service.",
        highlights: ["Ancient wisdom, modern living", "Gateway to the Vedics ecosystem", "Elegant, brand-led experience"],
        liveUrl: "https://www.vedics.net", shotImg: "assets/projects/vedic-landing.webp"
      }
    ]
  },
  {
    key: "trading",
    name: "Trading & Fintech",
    tagline: "AI-driven trading, market prediction, and live charting tools.",
    icon: "M3 3v18h18M7 14l3-3 3 3 5-5",
    projects: [
      {
        name: "TradeWell", slug: "tradewell",
        description: "Self-hosted live trading-charts dashboard — your markets, all on one screen.",
        overview: "A self-hosted dashboard for traders who watch many books at once — live crypto via Hyperliquid plus US and Indian equities, all in one tiled workspace.",
        highlights: ["8 panes per workspace", "25+ technical indicators", "3 data sources and growing", "Self-hosted, you own the data"],
        liveUrl: "https://d39c48qrzwnhha.cloudfront.net", shotImg: "assets/projects/tradewell.webp"
      },
      {
        name: "TradePredict", slug: "tradepredict", featured: true,
        description: "AI-powered automated trading platform by CoCreate.",
        overview: "An AI-powered trading platform delivering automated predictions, real-time analysis, and smart execution across 150+ global exchanges — start with paper trading, go live when ready.",
        highlights: ["AI predictions & real-time analysis", "Smart execution across 150+ exchanges", "Risk-free paper trading", "Trusted by 10,000+ traders"],
        liveUrl: "https://trade.cocreateidea.com"
      },
      {
        name: "Tradewise", slug: "tradewise",
        description: "Smart trading insights and portfolio analytics.",
        overview: "Smart trading insights and portfolio analytics that help investors understand performance and act on data-driven signals.",
        highlights: ["Portfolio analytics", "Data-driven trading insights", "Performance tracking"],
        liveUrl: "", shotImg: "assets/projects/tradewise.webp", photo: true
      }
    ]
  },
  {
    key: "career",
    name: "Career, HR & Education",
    tagline: "Tools for learning, hiring, and accelerating careers with AI.",
    icon: "M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z",
    projects: [
      {
        name: "SpeakWell", slug: "speakwell",
        description: "AI-powered spoken-language training application with real-time feedback.",
        overview: "An AI voice coach for spoken-language training — practice English, Hindi, Sanskrit, Chinese, or Spanish through real conversations with instant feedback.",
        highlights: ["AI voice coach with real-time feedback", "5 languages incl. Sanskrit", "Conversation-first practice"],
        liveUrl: "https://speakwell.cocreateidea.com"
      },
      {
        name: "Career Builder", slug: "career-builder", featured: true,
        description: "CareerX — AI-powered career platform and job-application assistant.",
        overview: "CareerX — an AI career platform that matches you to the right roles, tailors your resume, and applies on your behalf in minutes, not hours.",
        highlights: ["AI role matching", "Resume tailored per role", "Applies in minutes, not hours", "10,000+ professionals onboard"],
        liveUrl: "https://career.cocreateidea.com", shotImg: "assets/projects/career-builder.webp"
      },
      {
        name: "Resume Builder", slug: "resume-builder", featured: true,
        description: "ResumeX — free AI resume builder that tailors resumes to each role.",
        overview: "ResumeX — a free AI resume builder that creates ATS-optimized resumes in minutes, with 30+ templates, instant scoring, and per-role tailoring.",
        highlights: ["ATS-optimized resumes", "30+ professional templates", "Instant resume scoring", "Completely free"],
        liveUrl: "https://resume.cocreateidea.com"
      },
      {
        name: "LearnAI", slug: "learnai",
        description: "AI education platform — learn to build with AI (5-day intensive).",
        overview: "An AI education platform that teaches you to build intelligent apps in just one week — from RAG knowledge assistants to production deployments.",
        highlights: ["Build AI apps in one week", "Hands-on, project-based", "From RAG to deployment"],
        liveUrl: "https://learnai.cocreateidea.com"
      },
      {
        name: "Hiring Assistant", slug: "hiring-assistant",
        description: "AI agent orchestration that scores a candidate's join-probability.",
        overview: "An AI agent-orchestration tool for recruiters that scores each candidate's likelihood to join — so teams focus effort where it converts.",
        highlights: ["Join-probability scoring", "AI agent orchestration", "Recruiter-focused workflow"],
        liveUrl: "", shotImg: "assets/projects/hiring-assistant.webp", photo: true
      },
      {
        name: "HR Chatbot", slug: "hr-chatbot",
        description: "Conversational HR assistant for employee queries and support.",
        overview: "A conversational HR assistant that answers employee queries instantly — policies, leave, payroll, and support, available around the clock.",
        highlights: ["Instant answers to HR queries", "Policy, leave & payroll support", "Available 24/7"],
        liveUrl: "", shotImg: "assets/projects/hr-chatbot.webp", photo: true
      }
    ]
  },
  {
    key: "health",
    name: "Healthcare & Wellness",
    tagline: "AI assistants for clinical support and personalized care.",
    icon: "M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z",
    projects: [
      {
        name: "Medical AI Assistant", slug: "medipulse", featured: true,
        description: "MediPulse — your AI health companion for clinical support and triage.",
        overview: "MediPulse — an AI health companion covering diagnosis support, reports, wearables, and triage, with an AI chat assistant at the center.",
        highlights: ["AI chat health companion", "Symptom diagnosis & triage", "Reports & wearables integration", "Emergency & wellness modules"],
        liveUrl: "https://medipulse.cocreateidea.com/login/"
      },
      {
        name: "Prescriptive Beauty Advisor", slug: "beauty-advisor",
        description: "AI-powered skincare recommendations tailored to each user.",
        overview: "An AI skincare advisor that analyzes each user's skin and prescribes tailored routines and product recommendations.",
        highlights: ["Personalized skincare analysis", "Tailored product routines", "AI-driven recommendations"],
        liveUrl: "", shotImg: "assets/projects/beauty-advisor.webp", photo: true
      }
    ]
  },
  {
    key: "data",
    name: "Data & Analytics",
    tagline: "Agentic data warehousing, automation, and social analytics.",
    icon: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4",
    projects: [
      {
        name: "DWH Agentic Analytics", slug: "dwh-analytics",
        description: "Sunrider data-warehouse agentic analytics platform.",
        overview: "Sunrider — an agentic analytics layer over the data warehouse that lets teams ask questions in plain language and get governed, accurate answers.",
        highlights: ["Natural-language analytics", "Agentic query orchestration", "Governed warehouse access"],
        liveUrl: "", shotImg: "assets/projects/dwh-analytics.webp", photo: true
      },
      {
        name: "DWH Datamart", slug: "dwh-datamart",
        description: "Data-warehouse datamart pipeline and modeling layer.",
        overview: "The datamart pipeline and modeling layer that shapes raw warehouse data into clean, analytics-ready marts.",
        highlights: ["Pipeline & modeling layer", "Analytics-ready data marts", "Scalable warehouse design"],
        liveUrl: "", shotImg: "assets/projects/dwh-datamart.webp", photo: true
      },
      {
        name: "Social Media Automation", slug: "social-automation",
        description: "Automation engine for scheduling and generating social content.",
        overview: "An automation engine that generates and schedules social content across channels — keeping a brand's presence consistent without manual effort.",
        highlights: ["AI content generation", "Cross-channel scheduling", "Consistent brand presence"],
        liveUrl: "", shotImg: "assets/projects/social-automation.webp", photo: true
      },
      {
        name: "Viral Analysis", slug: "viral-analysis",
        description: "ViralCharts — analysis of why viral data posts went viral.",
        overview: "ViralCharts — a reasoning-agent study that pulled 117 top data-visualization posts and decoded the 11 that cleared the top-decile engagement bar.",
        highlights: ["117 posts analyzed", "Reasoning-agent vision + discourse pass", "Decoded the real virality patterns"],
        liveUrl: "https://d3e7bo0sizh2ir.cloudfront.net"
      }
    ]
  },
  {
    key: "realestate",
    name: "Real Estate",
    tagline: "Smart property discovery and matching.",
    icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
    projects: [
      {
        name: "HomeMatch", slug: "homematch", featured: true,
        description: "India's smart property-matching platform — find your dream home.",
        overview: "India's smart property-matching platform — post your requirements and let an intelligent matching engine connect you with verified properties nearby.",
        highlights: ["Intelligent property matching", "Verified listings", "Post requirements, get matched"],
        liveUrl: "https://d1rk0r5urb0mbh.cloudfront.net"
      }
    ]
  },
  {
    key: "business",
    name: "Business & SaaS",
    tagline: "Multi-tenant SaaS that runs the front office with AI.",
    icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
    projects: [
      {
        name: "FrontDesk", slug: "frontdesk",
        description: "Appointment SaaS with an AI voice receptionist — multi-tenant, multi-vertical.",
        overview: "An appointment SaaS powered by an AI voice receptionist that books, reschedules, and answers calls — multi-tenant and multi-vertical out of the box.",
        highlights: ["AI voice receptionist", "Automated appointment booking", "Multi-tenant, multi-vertical"],
        liveUrl: "", shotImg: "assets/projects/frontdesk.webp", photo: true
      },
      {
        name: "Trustwise", slug: "trustwise",
        description: "Online wills, done right — guided estate planning.",
        overview: "Trustwise — guided online estate planning that asks plain-English, state-specific questions and produces a print-ready will in about 20 minutes.",
        highlights: ["Plain-English guided questions", "State-specific requirements", "Print-ready will in ~20 minutes"],
        liveUrl: "https://trustwise.cocreateidea.com"
      }
    ]
  },
  {
    key: "platform",
    name: "CoCreate Platform & Tools",
    tagline: "The studio's own platform, CRM, and internal tooling.",
    icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
    projects: [
      {
        name: "AI Product Studio", slug: "ai-product-studio",
        description: "The CoCreate AI Product Studio — idea to deployed MVP.",
        overview: "The CoCreate AI Product Studio — the home base that takes an idea to a deployed MVP, and the launchpad for every product in this portfolio.",
        highlights: ["Idea to deployed MVP", "Full-stack AI product studio", "Launchpad for the portfolio"],
        liveUrl: "https://www.cocreateidea.com"
      },
      {
        name: "CoCreate Admin", slug: "cocreate-admin",
        description: "Unified CRM dashboard for the CoCreate SaaS portfolio.",
        overview: "A unified CRM dashboard that gives the studio one view across the entire CoCreate SaaS portfolio — users, usage, and revenue in one place.",
        highlights: ["Unified portfolio CRM", "Users, usage & revenue view", "One dashboard for every product"],
        liveUrl: "", shotImg: "assets/projects/cocreate-admin.webp", photo: true
      },
      {
        name: "CoCreate AI Lab", slug: "cocreate-ailab",
        description: "Experiments, prototypes, and demos from the CoCreate AI Lab.",
        overview: "The CoCreate AI Lab — a space for experiments, prototypes, and demos where the next products are explored before they graduate to the portfolio.",
        highlights: ["Experiments & prototypes", "Cutting-edge AI demos", "Where new products begin"],
        liveUrl: "", shotImg: "assets/projects/cocreate-ailab.webp", photo: true
      },
      {
        name: "tmux Builder", slug: "tmux-builder",
        description: "Web UI for the Claude CLI with real-time build progress.",
        overview: "A web UI for the Claude CLI that streams real-time build progress — driving agentic coding sessions from the browser.",
        highlights: ["Web UI for the Claude CLI", "Real-time build progress", "Agentic coding from the browser"],
        liveUrl: "", shotImg: "assets/projects/tmux-builder.webp", photo: true
      }
    ]
  }
];

/* Wave A — default-fill status field per project.
   "live" if liveUrl set (and not '#'), else "building".
   CEO can override per project by setting status: 'launching' on a record. */
(function () {
  (window.PROJECTS_DATA || []).forEach(function (cat) {
    (cat.projects || []).forEach(function (p) {
      if (!p.status) {
        p.status = (p.liveUrl && p.liveUrl !== '#') ? 'live' : 'building';
      }
    });
  });
})();
