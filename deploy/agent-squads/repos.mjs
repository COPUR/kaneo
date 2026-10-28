// Which squad owns which EV PnC repository. backlog.mjs uses it to put each
// backlog card on the board of the squad that owns its repository.
//
// Squads without a repository yet (navigation, invoicing, payments) get theirs
// through backlog cards (EV_PNC_planner, EV_PNC_invoicing, EV_PNC_payments).

export const repos = [
  // Platform: shared infrastructure, golden paths, docs and test rigs.
  { repo: "EV_PNC_docs", squad: "platform", chapter: "guild:architecture" },
  { repo: "EV_PNC_infra", squad: "platform", chapter: "chapter:devops" },
  {
    repo: "EV_PNC_infra-modules",
    squad: "platform",
    chapter: "chapter:devops",
  },
  { repo: "EV_PNC_simulator", squad: "platform", chapter: "chapter:qa" },
  // Roaming: OCPI model, eMSP core and the hub side.
  { repo: "EV_PNC_ocpi-model", squad: "roaming", chapter: "chapter:backend" },
  { repo: "EV_PNC_ocpi-emsp", squad: "roaming", chapter: "chapter:backend" },
  {
    repo: "EV_PNC_hub-contracts",
    squad: "roaming",
    chapter: "chapter:backend",
  },
  { repo: "EV_PNC_hub-gateway", squad: "roaming", chapter: "chapter:backend" },
  // Telemetry: charger data and the pilot KPIs built on it.
  { repo: "EV_PNC_telemetry", squad: "telemetry", chapter: "chapter:backend" },
  {
    repo: "EV_PNC_pilot-analytics",
    squad: "telemetry",
    chapter: "chapter:data",
  },
  // Consent: the roaming consent registry family.
  {
    repo: "EV_PnC_Consent_contracts",
    squad: "consent",
    chapter: "chapter:backend",
  },
  {
    repo: "EV_PnC_Consent_registry",
    squad: "consent",
    chapter: "chapter:backend",
  },
  {
    repo: "EV_PnC_Consent_decision",
    squad: "consent",
    chapter: "chapter:backend",
  },
  {
    repo: "EV_PnC_Consent_docs",
    squad: "consent",
    chapter: "guild:architecture",
  },
  { repo: "EV_PnC_Consent_testkit", squad: "consent", chapter: "chapter:qa" },
  { repo: "EV_PnC_Consent_infra", squad: "consent", chapter: "chapter:devops" },
  // Repositories that do not exist yet but already have backlog cards.
  {
    repo: "EV_PNC_planner",
    planned: true,
    squad: "navigation",
    chapter: "chapter:backend",
  },
  {
    repo: "EV_PNC_invoicing",
    planned: true,
    squad: "invoicing",
    chapter: "chapter:backend",
  },
  {
    repo: "EV_PNC_payments",
    planned: true,
    squad: "payments",
    chapter: "chapter:backend",
  },
  // Planned repositories from the v2 backlog (no repository yet): routed so
  // their cards do not all fall back to the Platform board.
  {
    repo: "EV_PNC_mobile",
    planned: true,
    squad: "navigation",
    chapter: "chapter:frontend",
  },
  {
    repo: "EV_PNC_plugcharge",
    planned: true,
    squad: "payments",
    chapter: "chapter:backend",
  },
  {
    repo: "EV_PNC_policy-engine",
    planned: true,
    squad: "payments",
    chapter: "chapter:backend",
  },
  {
    repo: "EV_PNC_pricing",
    planned: true,
    squad: "payments",
    chapter: "chapter:backend",
  },
  {
    repo: "EV_PNC_national-data",
    planned: true,
    squad: "telemetry",
    chapter: "chapter:data",
  },
  {
    repo: "EV_PNC_national-consent",
    planned: true,
    squad: "consent",
    chapter: "chapter:backend",
  },
  {
    repo: "EV_PNC_api-gateway",
    planned: true,
    squad: "platform",
    chapter: "chapter:backend",
  },
  {
    repo: "EV_PnC_Consent_notices",
    planned: true,
    squad: "consent",
    chapter: "chapter:frontend",
  },
  {
    repo: "EV_PnC_Consent_audit",
    planned: true,
    squad: "consent",
    chapter: "chapter:backend",
  },
  {
    repo: "EV_PnC_Consent_tenant-portal",
    planned: true,
    squad: "consent",
    chapter: "chapter:frontend",
  },
  {
    repo: "EV_PnC_Consent_edevlet-bridge",
    planned: true,
    squad: "consent",
    chapter: "chapter:backend",
  },
];

// Backlog owners that map to a squad regardless of the repository.
export const ownerSquads = {
  "Compliance agent": "security",
  "Planner agent": "navigation",
};

export const squadForRepo = (name) =>
  repos.find((r) => r.repo.toLowerCase() === name.toLowerCase());
