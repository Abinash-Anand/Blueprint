import { type DistrictDef, roadmap, docs, article } from "./types.js";

export const consolidation: DistrictDef = {
  slug: "ec",
  name: "Engineering Consolidation",
  subtitle: "Bring it together, ship it, show it",
  layer: 5,
  color: "#a8a096",
  cols: 3,
  goal: "Ship one complete, well-documented project that uses every district, and be able to explain and defend its design in an interview.",
  note: "No new technologies here. This stage exists to turn nine months of learning into evidence.",
  topics: [
    {
      slug: "ec.practices", name: "Engineering practices", priority: "CORE", hours: 8,
      description: "The habits that separate writing code from delivering software: version control, review and clean code.",
      subtopics: ["Git workflows and pull requests", "Code review", "Clean code and refactoring", "Documentation habits"],
      exercise: "Review a pull request from an open-source project or a peer using Google's review guide, and refactor one module of your capstone.",
      resources: [docs("Pro Git", "https://git-scm.com/book/en/v2"), article("Google — Code review developer guide", "https://google.github.io/eng-practices/review/"), article("Refactoring.Guru — Refactoring", "https://refactoring.guru/refactoring"), roadmap("roadmap.sh — Git and GitHub", "https://roadmap.sh/git-github")],
    },
    {
      slug: "ec.debugging", name: "Debugging and profiling", priority: "IMPORTANT", hours: 6,
      description: "Finding the cause instead of guessing: debuggers, profilers and logs.",
      subtopics: ["Browser DevTools", "Node.js debugger and inspector", "CPU and memory profiling"],
      exercise: "Find and fix one real performance or memory problem in your capstone using a profiler, and write up the investigation.",
      resources: [docs("Chrome DevTools", "https://developer.chrome.com/docs/devtools"), docs("Node.js — Debugging", "https://nodejs.org/en/learn/getting-started/debugging")],
    },
    {
      slug: "ec.capstone", name: "Capstone integration", priority: "CORE", hours: 22,
      description: "One project that uses the frontend, backend, database, architecture, cloud and AI districts together.",
      subtopics: ["Scope and requirements", "Frontend and API integration", "Data model and migrations", "AI feature with evaluation", "Deployment and monitoring", "Hardening and tests"],
      exercise: "Ship the capstone: deployed, tested in CI, with one evaluated AI feature and a recorded demo.",
      resources: [roadmap("roadmap.sh — Full Stack", "https://roadmap.sh/full-stack"), roadmap("roadmap.sh — Backend", "https://roadmap.sh/backend")],
      dependsOn: ["cl.capstone", "ai.evals"],
    },
    {
      slug: "ec.portfolio", name: "Portfolio and documentation", priority: "CORE", hours: 8,
      description: "Making your work legible to other people: READMEs, architecture docs and a short case study.",
      subtopics: ["README and setup guide", "Architecture documentation", "Case-study write-up"],
      exercise: "Publish the capstone repository with a README, C4 diagrams, ADRs and a one-page case study.",
      resources: [article("Diátaxis documentation framework", "https://diataxis.fr/"), article("The C4 model", "https://c4model.com/")],
      dependsOn: ["ec.capstone"],
    },
    {
      slug: "ec.interview", name: "Interview readiness", priority: "CORE", hours: 14,
      description: "Turning knowledge into performance under interview conditions.",
      subtopics: ["Data structures and algorithms refresh", "System design mock interviews", "Behavioural stories", "Explaining your projects"],
      exercise: "Complete two timed system-design mocks and one coding mock, and record what you would do differently.",
      resources: [article("Tech Interview Handbook", "https://www.techinterviewhandbook.org/"), article("NeetCode roadmap", "https://neetcode.io/roadmap"), article("The System Design Primer", "https://github.com/donnemartin/system-design-primer")],
    },
    {
      slug: "ec.retro", name: "Retrospective and next direction", priority: "CORE", hours: 4,
      description: "Looking back at the journey with the data in this app, and deciding the next six months deliberately.",
      subtopics: ["Review progress and hours", "Identify gaps", "Plan the next six months"],
      exercise: "Write a retrospective using this app's progress data, and a one-page plan for the next six months.",
      resources: [roadmap("roadmap.sh — All roadmaps", "https://roadmap.sh/roadmaps")],
    },
  ],
};
