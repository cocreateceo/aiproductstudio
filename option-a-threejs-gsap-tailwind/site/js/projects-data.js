/**
 * CoCreate Projects Data
 * --------------------------------------------------------------------------
 * Single source of truth for the Projects showcase (projects.html) and the
 * per-category detail page (projects-category.html?cat=KEY).
 *
 * TO ADD A PROJECT:   add an object to the relevant category's `projects` array.
 * TO ADD A CATEGORY:  add an object to PROJECTS_DATA with a unique `key`.
 * TO SET A LIVE URL:  fill in `liveUrl`. Leave "" to show a "Coming soon" badge.
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
      { name: "Vedic Astro",            description: "Full Vedic astrology platform — kundli, horoscopes, panchang, and compatibility readings.", liveUrl: "" },
      { name: "Vedic Transform",        description: "Vedic transformation and spiritual-growth web app with guided journeys.",                  liveUrl: "" },
      { name: "Vedic Transform (Web)",  description: "Marketing and services website for Vedic / spiritual offerings.",                          liveUrl: "" },
      { name: "Vedic Avatar",           description: "AI avatar that delivers personalized Vedic guidance and consultations.",                   liveUrl: "" },
      { name: "Vedic YouTube Studio",   description: "Automated pipeline that generates and publishes Vedic content to YouTube.",                liveUrl: "" },
      { name: "Transform YouTube",      description: "YouTube content-automation engine for transformation and spiritual channels.",            liveUrl: "" },
      { name: "Vedic Wellness Store",   description: "E-commerce storefront for Vedic wellness and spiritual products.",                        liveUrl: "" },
      { name: "Vedic Landing",          description: "Conversion-focused landing page for Vedic services.",                                     liveUrl: "" }
    ]
  },
  {
    key: "trading",
    name: "Trading & Fintech",
    tagline: "AI-driven trading, market prediction, and live charting tools.",
    icon: "M3 3v18h18M7 14l3-3 3 3 5-5",
    projects: [
      { name: "TradeWell",    description: "Self-hosted live trading-charts dashboard, deployed to AWS via CDK.",        liveUrl: "" },
      { name: "TradePredict", description: "AI-powered automated trading platform by CoCreate.",                        liveUrl: "" },
      { name: "Tradewise",    description: "Smart trading insights and portfolio analytics.",                           liveUrl: "" }
    ]
  },
  {
    key: "career",
    name: "Career, HR & Education",
    tagline: "Tools for learning, hiring, and accelerating careers with AI.",
    icon: "M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z",
    projects: [
      { name: "SpeakWell",       description: "AI-powered spoken-language training application with real-time feedback.", liveUrl: "" },
      { name: "Career Builder",  description: "AI career builder and job-application assistant.",                         liveUrl: "" },
      { name: "Resume Builder",  description: "AI resume builder that tailors resumes to each role.",                     liveUrl: "" },
      { name: "LearnAI",          description: "AI education platform delivering a 5-day intensive program.",              liveUrl: "" },
      { name: "Hiring Assistant", description: "AI agent orchestration that scores a candidate's join-probability.",        liveUrl: "" },
      { name: "HR Chatbot",       description: "Conversational HR assistant for employee queries and support.",            liveUrl: "" }
    ]
  },
  {
    key: "health",
    name: "Healthcare & Wellness",
    tagline: "AI assistants for clinical support and personalized care.",
    icon: "M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z",
    projects: [
      { name: "Medical AI Assistant",        description: "AI medical assistant for clinical support and patient triage.",            liveUrl: "" },
      { name: "Prescriptive Beauty Advisor", description: "AI-powered skincare recommendations tailored to each user.",                liveUrl: "" }
    ]
  },
  {
    key: "data",
    name: "Data & Analytics",
    tagline: "Agentic data warehousing, automation, and social analytics.",
    icon: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4",
    projects: [
      { name: "DWH Agentic Analytics", description: "Sunrider data-warehouse agentic analytics platform.",                liveUrl: "" },
      { name: "DWH Datamart",          description: "Data-warehouse datamart pipeline and modeling layer.",              liveUrl: "" },
      { name: "Social Media Automation",description: "Automation engine for scheduling and generating social content.",   liveUrl: "" },
      { name: "Viral Analysis",         description: "Decoded — analysis of why viral data posts went viral.",            liveUrl: "" }
    ]
  },
  {
    key: "realestate",
    name: "Real Estate",
    tagline: "Smart property discovery and matching.",
    icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
    projects: [
      { name: "HomeMatch", description: "India's smart property-matching platform.", liveUrl: "" }
    ]
  },
  {
    key: "business",
    name: "Business & SaaS",
    tagline: "Multi-tenant SaaS that runs the front office with AI.",
    icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
    projects: [
      { name: "FrontDesk", description: "Appointment SaaS with an AI voice receptionist — multi-tenant, multi-vertical.", liveUrl: "" }
    ]
  },
  {
    key: "platform",
    name: "CoCreate Platform & Tools",
    tagline: "The studio's own platform, CRM, and internal tooling.",
    icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
    projects: [
      { name: "AI Product Studio", description: "The CoCreate AI Product Studio — idea to deployed MVP.",            liveUrl: "https://cocreateidea.com" },
      { name: "CoCreate Admin",    description: "Unified CRM dashboard for the CoCreate SaaS portfolio.",           liveUrl: "" },
      { name: "CoCreate AI Lab",   description: "Experiments, prototypes, and demos from the CoCreate AI Lab.",     liveUrl: "" },
      { name: "tmux Builder",      description: "Web UI for the Claude CLI with real-time build progress.",         liveUrl: "" }
    ]
  }
];
