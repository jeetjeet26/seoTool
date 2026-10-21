import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOnboarding, onboardingProgress, needsAdvisory, PHASES } from '../src/lib/onboarding.ts';
test('drafts can save with outstanding access and zero hours', () => {
  const form = new FormData(); form.set('onboarding.monthly_hours', '0');
  const draft = parseOnboarding(form);
  assert.equal(draft.fields.monthly_hours, '0');
  assert.equal(draft.access.cms.status, 'Not requested');
  assert.equal(onboardingProgress(draft).done, 0);
});
test('locked platforms and missing CMS access trigger advisory scope', () => {
  for (const [key, value] of [['onboarding.tier','Locked / vendor-controlled'],['access.cms.status','No access']]) {
    const form = new FormData(); form.set(key,value); assert.equal(needsAdvisory(parseOnboarding(form)), true);
  }
});
test('approval cannot be completed without evidence', () => {
  const form = new FormData(); form.set('onboarding.audit_status','Approved');
  assert.throws(() => parseOnboarding(form), /approval date/);
  form.set('onboarding.approval_date', '2026-09-23'); form.set('onboarding.approved_by','Reviewer'); form.set('onboarding.approval_evidence','Approval email reference');
  assert.equal(parseOnboarding(form).fields.audit_status,'Approved');
});
test('invalid URLs, dates, statuses and hours are rejected', () => {
  for (const [key, value] of [['onboarding.basecamp_link','javascript:alert(1)'],['onboarding.contract_start','2026-02-30'],['onboarding.monthly_hours','-1'],['onboarding.monthly_hours','Infinity'],['access.cms.status','invented']]) {
    const form = new FormData(); form.set(key,value); assert.throws(() => parseOnboarding(form));
  }
});
test('unknown inputs cannot add steps or overwrite other client data', () => {
  const form = new FormData(); form.set('check.platform_verified','on'); form.set('check.forged','on'); form.set('onboarding.__proto__','oops');
  const value = parseOnboarding(form); assert.equal(onboardingProgress(value).done,1); assert.equal(value.checks.forged,undefined); assert.equal(Object.hasOwn(value.fields,'__proto__'),false);
});
test('SOP onboarding contains SEO audit and monthly handoff but no GEO workflow', () => {
  assert.equal(PHASES.length,6); assert.equal(/\bGEO\b|quarterly/i.test(JSON.stringify(PHASES)),false);
  assert.ok(PHASES.find(phase => phase.id==='audit').checks.some(([id]) => id==='audit_tracking'));
});
