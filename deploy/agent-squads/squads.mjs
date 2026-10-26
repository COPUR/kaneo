// The tribe's shape, in one place. Edit this file to add a squad, rename a
// column or change a field, then re-run seed.mjs (new projects only).

// Columns in board order. `from` renames one of the four columns every new
// project starts with (to-do, in-progress, in-review, done), so its slug stays.
// Only Done is final, so only roles with task:close (the product owner and the
// CI/CD agent) can move work there.
const squadColumns = [
  { name: "Backlog", from: "to-do", isFinal: false },
  { name: "In Progress", from: "in-progress", isFinal: false },
  { name: "Decision Needed", isFinal: false },
  { name: "In Review", from: "in-review", isFinal: false },
  { name: "Done", from: "done", isFinal: true },
];

const squadFields = [
  { name: "Decision", type: "text" },
  { name: "Pull request", type: "text" },
  {
    name: "Agent status",
    type: "dropdown",
    options: ["Claimed", "Working", "Blocked", "Handed to CI/CD"],
  },
];

const squad = (id, key, name, icon) => ({
  id,
  key,
  name: `${name} squad`,
  icon,
  columns: squadColumns,
  fields: squadFields,
});

export const squads = [
  squad("navigation", "NAV", "Navigation", "Map"),
  squad("consent", "CON", "Consent", "ShieldCheck"),
  squad("roaming", "ROA", "Roaming", "Globe"),
  squad("telemetry", "TEL", "Telemetry", "Activity"),
  squad("platform", "PLT", "Platform", "Server"),
  squad("invoicing", "INV", "Invoicing", "Receipt"),
  squad("payments", "PAY", "Payments", "CreditCard"),
  squad("security", "SEC", "Security", "Lock"),
];

export const tribe = {
  name: "EV PnC Tribe",
  slug: "ev-pnc-tribe",
  description: "Agent squads for EV Plug and Charge",
  agentEmailDomain: "agents.kaneo.local",
  // Decisions taken by the tribe. Accepted and Rejected are final, and the
  // CI/CD agent has no access to this board, so only the product owner
  // (owner or admin) can settle a decision.
  decisions: {
    id: "decisions",
    key: "DEC",
    name: "Tribe decisions",
    icon: "Scale",
    columns: [
      { name: "Proposed", from: "to-do", isFinal: false },
      { name: "In Discussion", from: "in-progress", isFinal: false },
      { name: "Ready for PO", from: "in-review", isFinal: false },
      { name: "Accepted", from: "done", isFinal: true },
      { name: "Rejected", isFinal: true },
    ],
    fields: [
      { name: "ADR", type: "text" },
      {
        name: "Squads affected",
        type: "multiselect",
        options: squads.map((s) => s.key),
      },
      { name: "Decided on", type: "date" },
    ],
  },
  // Chapters cut across squads (same craft); guilds are interest groups.
  labels: [
    { name: "decision", color: "#7c3aed" },
    { name: "adr", color: "#6366f1" },
    { name: "blocked", color: "#dc2626" },
    { name: "needs-human", color: "#f59e0b" },
    { name: "chapter:backend", color: "#0ea5e9" },
    { name: "chapter:frontend", color: "#14b8a6" },
    { name: "chapter:data", color: "#22c55e" },
    { name: "chapter:qa", color: "#84cc16" },
    { name: "chapter:devops", color: "#64748b" },
    { name: "guild:security", color: "#be123c" },
    { name: "guild:architecture", color: "#a855f7" },
  ],
};
