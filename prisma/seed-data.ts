// Static fixtures for the seed. Nothing here is random; seed.ts combines these
// with a seeded PRNG so every run produces identical data.

import type { Region, Sentiment } from "../lib/generated/prisma/enums";

export const COURSES: {
  code: string;
  name: string;
  region: Region;
  track: string;
  description: string;
  inDevelopment?: boolean;
}[] = [
  { code: "AAI", name: "Agentic AI", region: "US", track: "AI",
    description: "Design, build and operate tool-using agents, from single-agent loops to multi-agent systems." },
  { code: "TGA", name: "Transformative GenAI", region: "INDIA", track: "AI",
    description: "GenAI strategy and hands-on automation for business leaders and operators." },
  { code: "AIE", name: "AI Engineering", region: "GLOBAL", track: "AI",
    description: "Ship production LLM applications: RAG pipelines, evals, guardrails and observability." },
  { code: "PM", name: "Product Management", region: "GLOBAL", track: "Management",
    description: "Discovery, strategy and roadmapping for product managers." },
  { code: "TPM", name: "Technical Program Management", region: "GLOBAL", track: "Management",
    description: "Running cross-team technical programs: planning, dependencies and risk." },
  { code: "EM", name: "Engineering Management", region: "GLOBAL", track: "Management",
    description: "Leading engineering teams: hiring, delivery, feedback and career growth." },
  { code: "SWE", name: "Software Engineering", region: "GLOBAL", track: "Engineering",
    description: "Data structures, systems design and production engineering practices." },
  { code: "FDE", name: "Forward Deployed Engineering", region: "US", track: "Engineering", inDevelopment: true,
    description: "Deploying and integrating software in the field with enterprise customers." },
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

// tags are comma-separated (SQLite has no scalar lists), like Instructor.expertise.
export type ModuleDef = { title: string; description: string; tags: string };

export const MODULES: Record<string, ModuleDef[]> = {
  AAI: [
    { title: "Agent Foundations & Tool Use", tags: "agents,tool-use,function-calling",
      description: "The agent loop, tool schemas and function calling, with handling for tool failures." },
    { title: "Planning, Memory & Reflection", tags: "agents,planning,memory",
      description: "Task decomposition, short- and long-term memory stores, and self-critique loops." },
    { title: "Multi-Agent Systems in Production", tags: "agents,orchestration,mlops",
      description: "Orchestrating multiple agents, handoffs, cost control and monitoring in production." },
  ],
  TGA: [
    { title: "GenAI for Business Transformation", tags: "strategy,use-cases",
      description: "Finding high-value GenAI use cases and building the business case." },
    { title: "Prompting & Workflow Automation", tags: "prompting,automation",
      description: "Prompt patterns and no-code automation of everyday business workflows." },
  ],
  AIE: [
    { title: "LLM Application Architecture & RAG", tags: "llm-apps,rag,embeddings,vector-search",
      description: "Retrieval-augmented generation end to end: chunking, embeddings, vector search, re-ranking and grounding answers in sources." },
    { title: "Evals, Guardrails & Observability", tags: "evals,guardrails,observability",
      description: "Offline and online evals, including retrieval quality for RAG, plus guardrails and tracing." },
  ],
  PM: [
    { title: "Product Discovery & Strategy", tags: "discovery,strategy",
      description: "Customer discovery, opportunity sizing and product strategy." },
  ],
  TPM: [
    { title: "Program Execution at Scale", tags: "program-management,planning",
      description: "Planning, dependency management and risk tracking across teams." },
  ],
  EM: [
    { title: "Leading Engineering Teams", tags: "people-leadership,hiring",
      description: "Hiring, one-on-ones, performance feedback and team health." },
  ],
  SWE: [
    { title: "Data Structures & Systems Design", tags: "system-design,algorithms",
      description: "Core data structures and designing scalable distributed systems." },
    { title: "Production Engineering Practices", tags: "backend,testing,ci-cd",
      description: "Testing, CI/CD, code review and on-call practices." },
  ],
  FDE: [
    { title: "Customer Deployment Playbook", tags: "deployment,customer",
      description: "Scoping, deploying and supporting software at customer sites." },
    { title: "Field Integration Engineering", tags: "integration,apis,rag",
      description: "Integrating with customer data systems and APIs, including RAG over customer documents." },
  ],
};

// Titles stay "<Course> Mid-program Project" / "<Course> Capstone"; the brief says what's built.
export const PROJECT_BRIEFS: Record<string, { PROJECT: string; CAPSTONE: string }> = {
  AAI: { PROJECT: "Build a tool-using agent that completes a multi-step research task.",
    CAPSTONE: "Ship a multi-agent system with memory, evaluation and cost monitoring." },
  TGA: { PROJECT: "Automate one real workflow from your team with prompting and no-code tools.",
    CAPSTONE: "Present a GenAI transformation plan with a working prototype and ROI case." },
  AIE: { PROJECT: "Build a RAG assistant over the course docs and measure its retrieval quality.",
    CAPSTONE: "Ship a production LLM app with RAG, an eval suite, guardrails and tracing." },
  PM: { PROJECT: "Run a discovery sprint and write an opportunity assessment.",
    CAPSTONE: "Write and defend a product strategy and two-quarter roadmap." },
  TPM: { PROJECT: "Build a program plan with a dependency map and risk register.",
    CAPSTONE: "Run a simulated cross-team launch end to end." },
  EM: { PROJECT: "Design a hiring loop and onboarding plan for a new team.",
    CAPSTONE: "Write a team health diagnosis and a 90-day improvement plan." },
  SWE: { PROJECT: "Design and implement a rate-limited key-value service.",
    CAPSTONE: "Build, test and deploy a production-grade service with CI/CD." },
  FDE: { PROJECT: "Integrate a customer data source behind a clean API.",
    CAPSTONE: "Deliver a field deployment, including RAG over the customer's own documents." },
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
  "Agentic AI", "LLM Evaluation", "RAG & Retrieval", "AI Safety", "MLOps", "Product Strategy",
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

// Topic-specific comments for sessions whose module carries the tag. seed.ts mixes them
// into the generic pool for the same sentiment and theme.
export const TOPIC_COMMENTS: Record<string, Partial<Record<Sentiment, Record<string, string[]>>>> = {
  rag: {
    POSITIVE: {
      examples: ["The RAG demo over a real document set made retrieval click."],
      depth: ["Loved the deep dive on chunking and re-ranking for RAG."],
      clarity: ["Clear walkthrough of how RAG grounds answers in retrieved sources."],
    },
    NEUTRAL: {
      depth: ["RAG section was fine, wanted more on hybrid search."],
      examples: ["The RAG example used a toy corpus, a realistic one would help."],
    },
    NEGATIVE: {
      pacing: ["Rushed through the RAG pipeline, couldn't follow the chunking code."],
      clarity: ["Still unclear how RAG retrieval feeds into the prompt."],
      depth: ["RAG coverage was shallow, nothing on evaluating retrieval quality."],
    },
  },
};

export const ISSUE_TEMPLATES: {
  title: string;
  category: "CONTENT" | "INSTRUCTOR" | "TECHNICAL" | "SCHEDULING" | "PLATFORM" | "LEARNER_SUPPORT";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  description: string;
}[] = [
  { title: "Lab environment fails to provision GPU notebooks", category: "TECHNICAL", severity: "HIGH",
    description: "Notebook launches time out waiting for a GPU; learners can't start the hands-on labs." },
  { title: "Session recording missing from LMS", category: "PLATFORM", severity: "MEDIUM",
    description: "The recording link never appeared in the LMS, so learners who missed the session can't catch up." },
  { title: "Outdated API examples in module notebook", category: "CONTENT", severity: "MEDIUM",
    description: "Notebook cells call a deprecated SDK method and fail on the current version." },
  { title: "Learners report instructor pace too fast", category: "INSTRUCTOR", severity: "HIGH",
    description: "Learners say the live coding moves faster than they can follow; negative feedback clusters on pacing." },
  { title: "Time-zone clash with India cohort office hours", category: "SCHEDULING", severity: "MEDIUM",
    description: "Office hours fall after 11pm IST, so the India cohort can't attend." },
  { title: "Quiz answer key incorrect for Q4", category: "CONTENT", severity: "LOW",
    description: "The answer key marks the wrong option as correct; learners are disputing scores." },
  { title: "Zoom audio dropouts during live session", category: "TECHNICAL", severity: "HIGH",
    description: "Instructor audio dropped repeatedly during the live session, and the recording has the same gaps." },
  { title: "Capstone rubric unclear on grading weights", category: "CONTENT", severity: "MEDIUM",
    description: "The rubric doesn't say how demo, write-up and code quality are weighted." },
  { title: "Refund requests after week 2", category: "LEARNER_SUPPORT", severity: "MEDIUM",
    description: "Refund requests spiked after week 2, mostly citing workload." },
  { title: "Guest SME cancelled with 24h notice", category: "SCHEDULING", severity: "HIGH",
    description: "The guest SME cancelled at short notice and a replacement speaker is needed." },
  { title: "Slack workspace invites not delivered", category: "PLATFORM", severity: "LOW",
    description: "Some learners never received the Slack invite email." },
  { title: "Module prerequisites not communicated", category: "CONTENT", severity: "MEDIUM",
    description: "The RAG module assumes embeddings and vector database experience that wasn't listed as a prerequisite." },
  { title: "Instructor unavailable for next two sessions", category: "INSTRUCTOR", severity: "CRITICAL",
    description: "The lead instructor is out for the next two sessions and no cover is confirmed." },
  { title: "Certificate generation failing for completed learners", category: "PLATFORM", severity: "HIGH",
    description: "The certificate job errors for learners who completed the course." },
  { title: "Assignment deadline overlaps with holiday", category: "SCHEDULING", severity: "LOW",
    description: "The assignment is due on a public holiday in the cohort's main region." },
  { title: "API credits exhausted for lab accounts", category: "TECHNICAL", severity: "CRITICAL",
    description: "Shared LLM and embedding API credits ran out, blocking the RAG and evals labs until topped up." },
  { title: "Learners asking for more office hours", category: "LEARNER_SUPPORT", severity: "LOW",
    description: "Repeated requests for extra office hours before the project deadline." },
  { title: "Explanations confusing in evaluation module", category: "CONTENT", severity: "HIGH",
    description: "Learners found the evaluation metrics section confusing; low ratings cluster on clarity." },
  { title: "LMS progress tracking not updating", category: "PLATFORM", severity: "MEDIUM",
    description: "Completed lessons don't show as complete in the LMS progress bar." },
  { title: "Mentor matching delayed for capstone teams", category: "LEARNER_SUPPORT", severity: "MEDIUM",
    description: "Capstone teams are still waiting to be matched with mentors." },
  { title: "Dataset link broken in project brief", category: "CONTENT", severity: "LOW",
    description: "The dataset URL in the project brief returns a 404." },
  { title: "Double-booked instructor across cohorts", category: "SCHEDULING", severity: "HIGH",
    description: "One instructor is scheduled for overlapping sessions in two cohorts." },
  { title: "Learner accessibility request: captions", category: "LEARNER_SUPPORT", severity: "MEDIUM",
    description: "A learner requested live captions for all sessions." },
  { title: "Auto-grader timing out on submissions", category: "TECHNICAL", severity: "MEDIUM",
    description: "The auto-grader times out on larger submissions, leaving them ungraded." },
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
