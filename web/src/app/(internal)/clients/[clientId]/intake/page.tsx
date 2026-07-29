import Link from "next/link";
import { notFound } from "next/navigation";

import { saveClientIntake } from "@/actions/tools";
import { PageHeader } from "@/components/app-shell";
import { isSupabaseConfigured } from "@/lib/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: "Client intake" };
export const dynamic = "force-dynamic";

type Intake = {
  developer_contact?: string;
  main_contact?: string;
  goals?: string;
  competitors?: string;
  target_markets?: string;
  avoided_terms?: string;
  differentiators?: string;
  amenities?: string;
  renovations?: string;
  events_partnerships?: string;
  content_plans?: string;
  nap?: { name?: string; address?: string; phone?: string; website?: string };
};

export default async function ClientIntakePage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  if (!isSupabaseConfigured) notFound();

  const supabase = await createSupabaseServerClient();
  const { data: client, error } = await supabase
    .from("clients")
    .select("id,name,intake")
    .eq("id", clientId)
    .maybeSingle();
  if (error || !client) notFound();

  const intake = (client.intake ?? {}) as Intake;
  const nap = intake.nap ?? {};

  return (
    <div className="narrow-page">
      <PageHeader
        eyebrow="Client intake"
        title={`${client.name} questionnaire`}
        description="These answers become the approved facts used by crawls, AI generation, and the local listing checklist."
      />
      <form className="form-card" action={saveClientIntake}>
        <input type="hidden" name="clientId" value={client.id} />
        <div className="form-section">
          <div>
            <span className="step-number">1</span>
            <h2>Contacts and goals</h2>
            <p>Who implements changes and what success looks like.</p>
          </div>
          <div className="fields">
            <label>
              Website developer contact
              <input name="developerContact" defaultValue={intake.developer_contact ?? ""} />
            </label>
            <label>
              Main point of contact
              <input name="mainContact" defaultValue={intake.main_contact ?? ""} />
            </label>
            <label>
              Goals for the SEO engagement
              <textarea name="goals" rows={2} defaultValue={intake.goals ?? ""} />
            </label>
            <label>
              Top competitors
              <textarea name="competitors" rows={2} defaultValue={intake.competitors ?? ""} />
            </label>
          </div>
        </div>
        <div className="form-section">
          <div>
            <span className="step-number">2</span>
            <h2>Market and positioning</h2>
            <p>What to target and, just as important, what to avoid.</p>
          </div>
          <div className="fields">
            <label>
              Target market segments
              <textarea name="targetMarkets" rows={2} defaultValue={intake.target_markets ?? ""} />
            </label>
            <label>
              Terms or markets to avoid
              <textarea name="avoidedTerms" rows={2} defaultValue={intake.avoided_terms ?? ""} />
            </label>
            <label>
              Unique features and differentiators
              <textarea
                name="differentiators"
                rows={2}
                defaultValue={intake.differentiators ?? ""}
              />
            </label>
            <label>
              Amenities and special services
              <textarea name="amenities" rows={2} defaultValue={intake.amenities ?? ""} />
            </label>
          </div>
        </div>
        <div className="form-section">
          <div>
            <span className="step-number">3</span>
            <h2>Property updates</h2>
            <p>Facts content writers may reference.</p>
          </div>
          <div className="fields">
            <label>
              Planned renovations or site changes
              <textarea name="renovations" rows={2} defaultValue={intake.renovations ?? ""} />
            </label>
            <label>
              Events, sponsorships, and partnerships
              <textarea
                name="eventsPartnerships"
                rows={2}
                defaultValue={intake.events_partnerships ?? ""}
              />
            </label>
            <label>
              Blog or content plans
              <textarea name="contentPlans" rows={2} defaultValue={intake.content_plans ?? ""} />
            </label>
          </div>
        </div>
        <div className="form-section">
          <div>
            <span className="step-number">4</span>
            <h2>NAP for local listings</h2>
            <p>The exact name, address, and phone every listing must match.</p>
          </div>
          <div className="fields">
            <label>
              Business name
              <input name="napName" defaultValue={nap.name ?? ""} />
            </label>
            <label>
              Address
              <input name="napAddress" defaultValue={nap.address ?? ""} />
            </label>
            <div className="field-row">
              <label>
                Phone
                <input name="napPhone" defaultValue={nap.phone ?? ""} />
              </label>
              <label>
                Website
                <input name="napWebsite" defaultValue={nap.website ?? ""} />
              </label>
            </div>
          </div>
        </div>
        <div className="form-actions">
          <Link className="button secondary" href={`/clients/${client.id}`}>
            Cancel
          </Link>
          <button className="button primary" type="submit">
            Save intake
          </button>
        </div>
      </form>
    </div>
  );
}
