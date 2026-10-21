export type Onboarding = {
  fields: Record<string, string>;
  checks: Record<string, boolean>;
  access: Record<string, { status: string; owner: string; requested: string; notes: string }>;
};
export type Field = { key: string; label: string; type?: "text" | "textarea" | "date" | "number" | "url" | "select"; options?: string[]; hint?: string };
export const ACCESS = [
  ["cms", "CMS admin/editor", "Record the platform and the edits your team can actually make."],
  ["gsc", "Google Search Console", "Full or Owner access; record whether the domain or URL property is verified."],
  ["ga4", "Google Analytics 4", "Analyst or Editor access; confirm the intended property."],
  ["gtm", "Google Tag Manager", "Container access when P11 manages tracking or schema."],
  ["crm", "CRM / ILS", "View access for lead source and attribution checks."],
  ["floorplans", "Sightmap / floorplan tools", "Record URL, filtering, and embedding limitations when applicable."],
  ["hosting", "Hosting / DNS", "Only needed when changes require it and no client developer can help."],
  ["gbp", "Google Business Profile", "Record access when local listings are in the agreed scope."],
] as const;
export const ACCESS_STATUSES = ["Not requested", "Requested", "Granted", "No access", "Not applicable"];
export const PHASES: Array<{ id: string; title: string; owner: string; timing: string; description: string; fields: Field[]; checks: Array<[string, string]> }> = [
  { id: "feasibility", title: "0 · Platform feasibility", owner: "SEO Lead / Business Development", timing: "Before the proposal", description: "Confirm what can be implemented before committing to the scope.", fields: [
    { key: "platform", label: "CMS and hosting platform", hint: "For example: WordPress, Webflow, RentCafe, or a Yardi-hosted site." },
    { key: "tier", label: "Feasibility tier", type: "select", options: ["Not assessed", "Full CMS access", "Limited / templated access", "Locked / vendor-controlled"] },
    { key: "restrictions", label: "Verified permissions and platform restrictions", type: "textarea" },
    { key: "month_one_scope", label: "Achievable Month 1 work", type: "textarea" },
    { key: "ongoing_scope", label: "Sustainable ongoing SEO scope", type: "textarea" },
    { key: "feasibility_link", label: "Feasibility assessment / opportunity link", type: "url" },
    { key: "feasibility_owner", label: "SEO lead / business development owner" },
  ], checks: [["platform_verified", "Platform and actual edit permissions verified"], ["scope_tier", "Proposal scope, deliverables, and pricing reflect the feasibility tier"], ["assessment_attached", "Assessment attached to the Accelo / Basecamp opportunity"]] },
  { id: "discovery", title: "1 · Client discovery and access", owner: "Digital Marketing Manager", timing: "Week 1", description: "Complete the questionnaire and request access promptly. Outstanding access should not prevent audit scheduling.", fields: [
    { key: "discovery_owner", label: "Digital marketing manager" },
    { key: "portfolio", label: "Properties, communities, floorplans, and model homes in scope", type: "textarea", hint: "Keep a separate client/property record for each audited website." },
    { key: "lifecycle", label: "Business stage and timeline", type: "textarea", hint: "Lease-up vs. stabilized; pre-sale vs. active sales; priority communities and deadlines." },
    { key: "brand", label: "Brand guidelines and approved messaging", type: "textarea" },
    { key: "disclosures", label: "State-specific disclosures and compliance requirements", type: "textarea" },
    { key: "seo_history", label: "Prior SEO work, rankings, technical issues, or penalties", type: "textarea" },
    { key: "crm", label: "CRM / ILS and lead attribution setup" },
    { key: "approval_chain", label: "Content and technical approval chain", type: "textarea" },
    { key: "deliverables", label: "Contracted SEO deliverables", type: "textarea", hint: "Technical SEO, on-page work, content, local listings, citations, and reporting as agreed." },
    { key: "no_access_reason", label: "No CMS access: reason", type: "select", options: ["Not applicable", "Platform locked", "Client restricted", "Awaiting access"] },
    { key: "handoff_owner", label: "Client / vendor implementation owner" },
    { key: "contingency", label: "Work P11 can control and revised advisory scope", type: "textarea", hint: "Local listings, citations, separately hosted content, analytics, and reporting. Route CMS changes to the client/vendor." },
    { key: "access_review", label: "Next access / implementation review", type: "date" },
  ], checks: [["kickoff", "Kickoff and discovery questionnaire completed"], ["access_requested", "Required access requested and outstanding items assigned"], ["compliance_reviewed", "Brand, approved facts, and compliance needs reviewed"], ["scope_confirmed", "Scope confirmed with the account lead, including any access contingency"]] },
  { id: "setup", title: "2 · Tracker and Basecamp setup", owner: "Digital Marketing Manager", timing: "Week 1", description: "Track each property and confirm the project structure. These are team-maintained records; checking a box does not create anything in Basecamp.", fields: [
    { key: "contract_start", label: "Contract start date", type: "date" },
    { key: "monthly_hours", label: "Contracted monthly hours", type: "number" },
    { key: "assigned_team", label: "Assigned team members" },
    { key: "account_lead", label: "Account lead" },
    { key: "tracker_link", label: "Master tracker link", type: "url" },
    { key: "basecamp_link", label: "Basecamp project link", type: "url" },
    { key: "next_report", label: "Next monthly report-out date", type: "date" },
  ], checks: [["tracker_added", "Property added to master tracker with access, hours, owner, and report date"], ["bc_onboarding", "Basecamp Onboarding to-do list ready"], ["bc_audit", "Technical Audit to-do list ready"], ["bc_monthly", "Monthly Execution to-do list ready"], ["bc_docs", "Docs & Files ready for audits, approvals, and monthly recaps"], ["bc_messages", "Monthly updates and approval threads arranged"], ["bc_team", "Team, notifications, and applicable client access confirmed"], ["bc_pending", "Client implementation list with due dates ready, if CMS access is unavailable"]] },
  { id: "audit", title: "3 · Technical SEO audit", owner: "SEO Lead / Digital Marketing Director", timing: "Weeks 2–3", description: "Track review coverage, including checks that need GSC, analytics, or manual review. A completed scan alone does not check these boxes.", fields: [
    { key: "audit_owner", label: "SEO audit owner" },
    { key: "audit_status", label: "Audit review status", type: "select", options: ["Not started", "In progress", "Presented", "Approved"] },
    { key: "audit_date", label: "Planned audit date", type: "date" },
    { key: "audit_link", label: "Audit report / handoff link", type: "url" },
    { key: "audit_notes", label: "Audit limitations and manual review notes", type: "textarea" },
  ], checks: [["audit_indexing", "Crawlability and indexation reviewed: robots.txt, sitemap, and GSC coverage"], ["audit_architecture", "Site architecture and internal linking reviewed"], ["audit_speed", "Page speed and Core Web Vitals reviewed"], ["audit_onpage", "Titles, descriptions, and heading structure reviewed"], ["audit_schema", "Applicable Organization, LocalBusiness, and property schema reviewed"], ["audit_mobile", "Mobile usability reviewed"], ["audit_tracking", "GA4 / GTM events and CRM attribution reviewed"], ["audit_report", "SEO report prepared with severity and estimated effort"]] },
  { id: "approval", title: "4 · Findings and approval", owner: "Account Lead + SEO Lead", timing: "Week 4", description: "Prioritize work within the hour allowance and document written approval for anything outside standard scope.", fields: [
    { key: "presentation_date", label: "Findings walkthrough date", type: "date" },
    { key: "quick_wins", label: "Quick wins within contracted hours", type: "textarea" },
    { key: "dependencies", label: "Strategic work, developer dependencies, and extra budget", type: "textarea" },
    { key: "approval_date", label: "Written approval date", type: "date" },
    { key: "approved_by", label: "Approved by" },
    { key: "approval_evidence", label: "Approval email / Basecamp link or reference", type: "textarea" },
  ], checks: [["findings_presented", "Findings presented to the client"], ["work_prioritized", "Quick wins and strategic work prioritized within scope"], ["dependencies_flagged", "Client-side resources and out-of-scope costs flagged"], ["approval_logged", "Required written approvals recorded in the tracker and Basecamp"]] },
  { id: "handoff", title: "5–6 · Monthly execution and reporting handoff", owner: "Assigned SEO team member + Account Lead", timing: "Ongoing monthly", description: "Establish the monthly routine before handing off onboarding. Log task-level time and monthly history in the linked tracker and Basecamp project.", fields: [
    { key: "execution_owner", label: "Monthly execution owner" },
    { key: "reporting_owner", label: "Monthly reporting owner" },
    { key: "reporting_plan", label: "Reporting cadence and delivery plan", type: "textarea" },
    { key: "baseline_metrics", label: "Baseline organic traffic, rankings, and attributable leads / sales", type: "textarea" },
    { key: "escalation_plan", label: "Scope, hours overage, and stalled implementation escalation plan", type: "textarea", hint: "Review stalled client implementation after 2–3 months with the account lead." },
  ], checks: [["monthly_execution", "Approved tasks, time logging, and carry-forward process agreed"], ["monthly_budget", "Monthly hours reconciliation and overage escalation agreed"], ["monthly_backlog", "New issues route to a backlog for prioritization"], ["monthly_metrics", "Monthly recap covers work completed, organic traffic, rankings, and attributable leads / sales"], ["monthly_implementation", "Reporting separates recommendations from verified implementation"], ["monthly_meeting", "Client meeting / async recap cadence agreed"]] },
];
export const emptyOnboarding = (): Onboarding => ({ fields: {}, checks: {}, access: {} });
export function onboardingProgress(value?: Onboarding) {
  const checks = PHASES.flatMap(phase => phase.checks);
  return { done: checks.filter(([id]) => value?.checks?.[id]).length, total: checks.length };
}
export function needsAdvisory(value: Onboarding) {
  return value.fields.tier === "Locked / vendor-controlled" || value.access.cms?.status === "No access";
}
export function parseOnboarding(form: FormData): Onboarding {
  const result = emptyOnboarding();
  const read = (key: string, max = 6000) => {
    const entry = form.get(key);
    if (entry !== null && typeof entry !== "string") throw new Error("Invalid form value.");
    const value = String(entry ?? "").trim();
    if (value.length > max) throw new Error("Please shorten answers to 6,000 characters or fewer.");
    return value;
  };
  const date = (value: string) => !value || (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
  for (const phase of PHASES) {
    for (const field of phase.fields) {
      const value = read(`onboarding.${field.key}`);
      if (field.type === "select" && value && !field.options?.includes(value)) throw new Error(`Choose a valid ${field.label.toLowerCase()}.`);
      if (field.type === "date" && !date(value)) throw new Error(`Enter a valid date for ${field.label.toLowerCase()}.`);
      if (field.type === "number" && value && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 10000)) throw new Error("Monthly hours must be between 0 and 10,000.");
      if (field.type === "url" && value) {
        let valid = false;
        try { const url = new URL(value); valid = ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; } catch {}
        if (!valid) throw new Error(`Enter a valid HTTP or HTTPS URL for ${field.label.toLowerCase()}.`);
      }
      result.fields[field.key] = value;
    }
    for (const [id] of phase.checks) result.checks[id] = form.get(`check.${id}`) === "on";
  }
  for (const [id] of ACCESS) {
    const status = read(`access.${id}.status`) || "Not requested";
    const requested = read(`access.${id}.requested`);
    if (!ACCESS_STATUSES.includes(status) || !date(requested)) throw new Error("Choose valid access statuses and request dates.");
    result.access[id] = { status, requested, owner: read(`access.${id}.owner`), notes: read(`access.${id}.notes`) };
  }
  if ((result.checks.approval_logged || result.fields.audit_status === "Approved") && (!result.fields.approval_date || !result.fields.approved_by || !result.fields.approval_evidence)) throw new Error("Record the approval date, approver, and written approval reference before marking approval complete.");
  return result;
}
