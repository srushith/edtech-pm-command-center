// Static fixtures for the seed. Nothing here is random; seed.ts combines these
// with a seeded PRNG so every run produces identical data.

import type { Region, Sentiment } from "../lib/generated/prisma/enums";

export const COURSES: {
  code: string;
  name: string;
  region: Region;
  track: string;
  inDevelopment?: boolean;
}[] = [
  { code: "AAI", name: "Agentic AI", region: "US", track: "AI" },
  { code: "TGA", name: "Transformative GenAI", region: "INDIA", track: "AI" },
  { code: "AIE", name: "AI Engineering", region: "GLOBAL", track: "AI" },
  { code: "PM", name: "Product Management", region: "GLOBAL", track: "Management" },
  { code: "TPM", name: "Technical Program Management", region: "GLOBAL", track: "Management" },
  { code: "EM", name: "Engineering Management", region: "GLOBAL", track: "Management" },
  { code: "SWE", name: "Software Engineering", region: "GLOBAL", track: "Engineering" },
  { code: "FDE", name: "Forward Deployed Engineering", region: "US", track: "Engineering", inDevelopment: true },
];

// startOffset is days relative to the anchor date; capacity always < 100.
export const COHORTS: { course: string; n: number; startOffset: number; weeks: number; capacity: number }[] = [
  { course: "AAI", n: 1, startOffset: -120, weeks: 12, capacity: 60 },
  { course: "AAI", n: 2, startOffset: -35, weeks: 12, capacity: 80 },
  { course: "TGA", n: 1, startOffset: -56, weeks: 10, capacity: 95 },
  { course: "TGA", n: 2, startOffset: 21, weeks: 10, capacity: 90 },
  { course: "AIE", n: 1, startOffset: -63, weeks: 14, capacity: 70 },
  { course: "PM", n: 1, startOffset: -42, weeks: 10, capacity: 75 },
  { course: "TPM", n: 1, startOffset: -28, weeks: 8, capacity: 40 },
  { course: "EM", n: 1, startOffset: -49, weeks: 8, capacity: 45 },
  { course: "SWE", n: 1, startOffset: -14, weeks: 16, capacity: 85 },
  { course: "FDE", n: 1, startOffset: 35, weeks: 12, capacity: 40 },
];

export const MODULES: Record<string, string[]> = {
  AAI: ["Agent Foundations & Tool Use", "Planning, Memory & Reflection", "Multi-Agent Systems in Production"],
  TGA: ["GenAI for Business Transformation", "Prompting & Workflow Automation"],
  AIE: ["LLM Application Architecture", "Evals, Guardrails & Observability"],
  PM: ["Product Discovery & Strategy"],
  TPM: ["Program Execution at Scale"],
  EM: ["Leading Engineering Teams"],
  SWE: ["Data Structures & Systems Design", "Production Engineering Practices"],
  FDE: ["Customer Deployment Playbook", "Field Integration Engineering"],
};

export const FIRST_NAMES = [
  "Aarav", "Priya", "Marcus", "Elena", "Rohan", "Sofia", "Daniel", "Ananya", "Kenji", "Leah",
  "Vikram", "Grace", "Omar", "Meera", "Lucas", "Nia", "Arjun", "Hannah", "Diego", "Kavya",
  "Samuel", "Isha", "Tomás", "Chloe", "Rahul", "Amara", "Ethan", "Divya", "Noah", "Zara",
  "Karthik", "Maya", "Felix", "Sneha", "Julian", "Aisha", "Nikhil", "Olivia", "Ravi", "Emma",
];

export const LAST_NAMES = [
  "Sharma", "Chen", "Okafor", "Martinez", "Iyer", "Nguyen", "Patel", "Kim", "Reddy", "Johnson",
  "Kapoor", "Schmidt", "Rao", "Alvarez", "Menon", "Tanaka", "Gupta", "Williams", "Das", "Ibrahim",
];

export const INSTRUCTOR_EXPERTISE = [
  "agents", "llm-apps", "rag", "evals", "mlops", "product-strategy", "discovery",
  "program-management", "people-leadership", "system-design", "backend", "cloud", "prompting",
];

export const SME_DOMAINS = [
  "Agentic AI", "LLM Evaluation", "Retrieval & Search", "AI Safety", "MLOps", "Product Strategy",
  "Growth", "Program Management", "Engineering Leadership", "Distributed Systems", "Cloud Infrastructure",
  "Customer Engineering", "GenAI for Enterprise",
];

export const SME_COMPANIES = [
  "Northwind Labs", "Contoso AI", "Fabrikam", "Initech Cloud", "Globex", "Umbrella Health",
  "Stark Analytics", "Wayne Fintech", "Tyrell Robotics", "Acme Retail",
];

// Themes a learner comment can be tagged with. Negative themes are the root causes
// Phase 3 will cluster on.
export const THEMES: Record<Sentiment, string[]> = {
  POSITIVE: ["examples", "engagement", "clarity", "depth"],
  NEUTRAL: ["pacing", "depth", "examples", "clarity"],
  NEGATIVE: ["pacing", "clarity", "audio", "engagement", "depth"],
};

export const COMMENTS: Record<Sentiment, Record<string, string[]>> = {
  POSITIVE: {
    examples: ["The worked examples made this click.", "Loved the live demo, very practical.", "Real-world case studies were great."],
    engagement: ["Great energy, kept everyone engaged.", "Breakout exercise was the highlight.", "Q&A was genuinely useful."],
    clarity: ["Very clear explanations throughout.", "Complex topic, explained simply.", "Slides and narration were crisp."],
    depth: ["Went deep without losing us.", "Good balance of theory and practice.", "Covered edge cases I hadn't considered."],
  },
  NEUTRAL: {
    pacing: ["Okay overall, a bit rushed near the end.", "Decent session, pacing was uneven."],
    depth: ["Fine, but mostly things I already knew.", "Would have liked one more advanced example."],
    examples: ["Examples were fine, could be more realistic.", "Demo was okay, hard to follow at times."],
    clarity: ["Mostly clear, some slides were dense.", "Good content, delivery could be tighter."],
  },
  NEGATIVE: {
    pacing: ["Way too fast, couldn't keep up with the code.", "Rushed through the key concepts.", "Spent too long on basics, then rushed the hard part."],
    clarity: ["Explanations were confusing and jumped around.", "Didn't understand the core idea by the end.", "Slides contradicted what was said."],
    audio: ["Audio kept cutting out, missed half the session.", "Couldn't hear the instructor clearly.", "Recording has audio issues too."],
    engagement: ["Felt like a lecture, no interaction.", "Questions in chat were ignored.", "Hard to stay engaged, very monotone."],
    depth: ["Too shallow for the level of the course.", "Didn't go beyond what's in the docs."],
  },
};

export const ISSUE_TEMPLATES: {
  title: string;
  category: "CONTENT" | "INSTRUCTOR" | "TECHNICAL" | "SCHEDULING" | "PLATFORM" | "LEARNER_SUPPORT";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}[] = [
  { title: "Lab environment fails to provision GPU notebooks", category: "TECHNICAL", severity: "HIGH" },
  { title: "Session recording missing from LMS", category: "PLATFORM", severity: "MEDIUM" },
  { title: "Outdated API examples in module notebook", category: "CONTENT", severity: "MEDIUM" },
  { title: "Learners report instructor pace too fast", category: "INSTRUCTOR", severity: "HIGH" },
  { title: "Time-zone clash with India cohort office hours", category: "SCHEDULING", severity: "MEDIUM" },
  { title: "Quiz answer key incorrect for Q4", category: "CONTENT", severity: "LOW" },
  { title: "Zoom audio dropouts during live session", category: "TECHNICAL", severity: "HIGH" },
  { title: "Capstone rubric unclear on grading weights", category: "CONTENT", severity: "MEDIUM" },
  { title: "Refund requests after week 2", category: "LEARNER_SUPPORT", severity: "MEDIUM" },
  { title: "Guest SME cancelled with 24h notice", category: "SCHEDULING", severity: "HIGH" },
  { title: "Slack workspace invites not delivered", category: "PLATFORM", severity: "LOW" },
  { title: "Module prerequisites not communicated", category: "CONTENT", severity: "MEDIUM" },
  { title: "Instructor unavailable for next two sessions", category: "INSTRUCTOR", severity: "CRITICAL" },
  { title: "Certificate generation failing for completed learners", category: "PLATFORM", severity: "HIGH" },
  { title: "Assignment deadline overlaps with holiday", category: "SCHEDULING", severity: "LOW" },
  { title: "API credits exhausted for lab accounts", category: "TECHNICAL", severity: "CRITICAL" },
  { title: "Learners asking for more office hours", category: "LEARNER_SUPPORT", severity: "LOW" },
  { title: "Explanations confusing in evaluation module", category: "CONTENT", severity: "HIGH" },
  { title: "LMS progress tracking not updating", category: "PLATFORM", severity: "MEDIUM" },
  { title: "Mentor matching delayed for capstone teams", category: "LEARNER_SUPPORT", severity: "MEDIUM" },
  { title: "Dataset link broken in project brief", category: "CONTENT", severity: "LOW" },
  { title: "Double-booked instructor across cohorts", category: "SCHEDULING", severity: "HIGH" },
  { title: "Learner accessibility request: captions", category: "LEARNER_SUPPORT", severity: "MEDIUM" },
  { title: "Auto-grader timing out on submissions", category: "TECHNICAL", severity: "MEDIUM" },
];

export const PM_TEAM = ["Srushith", "Ops: Nadia", "Ops: Karan", "Content: Mei", "Content: Arun", "Program: Lisa"];

export const CHECKLIST_TEMPLATE: { label: string; daysBefore: number; owner: string }[] = [
  { label: "Instructors contracted", daysBefore: 45, owner: "Srushith" },
  { label: "Curriculum modules published", daysBefore: 30, owner: "Content: Mei" },
  { label: "Pricing & landing page live", daysBefore: 28, owner: "Program: Lisa" },
  { label: "LMS course shell configured", daysBefore: 14, owner: "Ops: Karan" },
  { label: "Welcome email sequence scheduled", daysBefore: 7, owner: "Ops: Nadia" },
  { label: "Orientation session scheduled", daysBefore: 5, owner: "Srushith" },
  { label: "Office hours staffed", daysBefore: 2, owner: "Ops: Nadia" },
];
