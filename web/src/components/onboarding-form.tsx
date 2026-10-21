"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { saveOnboarding } from "@/actions/onboarding";
import { ACCESS, ACCESS_STATUSES, PHASES, emptyOnboarding, needsAdvisory, onboardingProgress, type Onboarding } from "@/lib/onboarding";

export function OnboardingForm({ clientId, updatedAt, initial, saved, children }: { clientId: string; updatedAt: string; initial?: Onboarding; saved: boolean; children: React.ReactNode }) {
  const [state, action, pending] = useActionState(saveOnboarding, {});
  const [value, setValue] = useState<Onboarding>(() => ({ ...emptyOnboarding(), ...initial }));
  const progress = onboardingProgress(value);
  const setField = (key: string, next: string) => setValue(previous => ({ ...previous, fields: { ...previous.fields, [key]: next } }));
  return <form action={action} className="form-card onboarding-form">
    <input type="hidden" name="clientId" value={clientId}/><input type="hidden" name="updatedAt" value={updatedAt}/>
    <div className="onboarding-overview">
      <div><strong>SEO onboarding</strong><p>{progress.done} of {progress.total} checkpoints complete</p></div>
      <progress value={progress.done} max={progress.total} aria-label="Onboarding checkpoints completed"/>
      <p>Save progress at any stage. Access statuses and checkpoints are confirmed by your team. Store access details here, not passwords or API keys.</p>
      <nav aria-label="Onboarding phases">{PHASES.map(phase => <a key={phase.id} href={`#${phase.id}`} onClick={() => { const section = document.getElementById(phase.id); if (section instanceof HTMLDetailsElement) section.open = true; }}>{phase.title}</a>)}</nav>
    </div>
    {saved && !state.error && <p className="notice success" role="status">Onboarding saved.</p>}
    {state.error && <p className="notice" role="alert">{state.error}</p>}
    {needsAdvisory(value) && <aside className="notice"><strong>Advisory scope for CMS-dependent work</strong><p>Route website changes to the client or platform vendor. Record the implementation owner, next follow-up, and work P11 can control. Keep recommended work separate from verified changes.</p></aside>}
    {PHASES.map((phase, index) => {
      const completed = phase.checks.filter(([id]) => value.checks[id]).length;
      return <details className="onboarding-phase" id={phase.id} key={phase.id} open={index === 0}>
        <summary><strong>{phase.title}</strong><span>{completed}/{phase.checks.length} complete</span></summary>
        <div className="onboarding-phase-body">
          <p><strong>{phase.owner}</strong> · {phase.timing}</p><p>{phase.description}</p>
          <div className="onboarding-fields">{phase.fields.map(field => <label key={field.key}>{field.label}
            {field.type === "textarea" ? <textarea name={`onboarding.${field.key}`} rows={3} maxLength={6000} value={value.fields[field.key] ?? ""} onChange={event => setField(field.key, event.target.value)}/> : field.type === "select" ? <select name={`onboarding.${field.key}`} value={value.fields[field.key] || field.options?.[0]} onChange={event => setField(field.key, event.target.value)}>{field.options?.map(option => <option key={option}>{option}</option>)}</select> : <input name={`onboarding.${field.key}`} type={field.type ?? "text"} maxLength={6000} min={field.type === "number" ? 0 : undefined} max={field.type === "number" ? 10000 : undefined} step={field.type === "number" ? "0.25" : undefined} value={value.fields[field.key] ?? ""} onChange={event => setField(field.key, event.target.value)}/>}
            {field.hint && <small>{field.hint}</small>}
          </label>)}</div>
          {phase.id === "discovery" && <>
            <h3>Client questionnaire</h3>{children}
            <h3>Platform access</h3><div className="onboarding-access">{ACCESS.map(([id, label, hint]) => <fieldset key={id}><legend>{label}</legend><p>{hint}</p><div className="onboarding-fields">{(["status", "owner", "requested", "notes"] as const).map(key => <label key={key}>{key === "status" ? "Access status" : key === "owner" ? "Request / follow-up owner" : key === "requested" ? "Date requested" : "Property, permissions, and limitations"}{key === "status" ? <select name={`access.${id}.${key}`} value={value.access[id]?.status ?? "Not requested"} onChange={event => setValue(previous => ({ ...previous, access: { ...previous.access, [id]: { ...(previous.access[id] ?? { owner: "", requested: "", notes: "" }), status: event.target.value } } }))}>{ACCESS_STATUSES.map(status => <option key={status}>{status}</option>)}</select> : <input name={`access.${id}.${key}`} type={key === "requested" ? "date" : "text"} maxLength={6000} defaultValue={initial?.access?.[id]?.[key] ?? ""}/>}</label>)}</div></fieldset>)}</div>
          </>}
          <fieldset className="onboarding-checks"><legend>Checkpoints</legend>{phase.checks.map(([id, label]) => <label key={id}><input name={`check.${id}`} type="checkbox" checked={Boolean(value.checks[id])} onChange={event => setValue(previous => ({ ...previous, checks: { ...previous.checks, [id]: event.target.checked } }))}/><span>{label}</span></label>)}</fieldset>
        </div>
      </details>;
    })}
    <div className="form-actions onboarding-save"><Link className="button secondary" href={`/clients/${clientId}`}>Client overview</Link><button className="button primary" type="submit" disabled={pending}>{pending ? "Saving…" : "Save onboarding"}</button></div>
  </form>;
}
