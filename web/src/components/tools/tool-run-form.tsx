"use client";

import Link from "next/link";
import { useActionState } from "react";

import { createToolRun, type ToolRunState } from "@/actions/tools";
import type { ToolType } from "@/lib/data/types";

const INITIAL_STATE: ToolRunState = {};

export function ToolRunForm({ toolType }: { toolType: ToolType }) {
  const [state, action, pending] = useActionState(createToolRun, INITIAL_STATE);

  return (
    <form className="form-card" action={action}>
      <input type="hidden" name="toolType" value={toolType} />
      <div className="form-section">
        <div>
          <span className="step-number">1</span>
          <h2>Client</h2>
          <p>
            Type the client name. New names create the client automatically
            when a website URL is provided.
          </p>
        </div>
        <div className="fields">
          <label>
            Client name
            <input name="clientName" required autoComplete="organization" />
          </label>
        </div>
      </div>
      <div className="form-section">
        <div>
          <span className="step-number">2</span>
          <h2>{sectionTitle(toolType)}</h2>
          <p>{sectionDescription(toolType)}</p>
        </div>
        <div className="fields">{renderFields(toolType)}</div>
      </div>
      <div className="form-actions">
        {state.error ? <p className="field-error">{state.error}</p> : null}
        <Link className="button secondary" href="/tools">
          Cancel
        </Link>
        <button className="button primary" type="submit" disabled={pending}>
          {pending ? "Queuing…" : "Start run"}
        </button>
      </div>
    </form>
  );
}

function sectionTitle(toolType: ToolType): string {
  switch (toolType) {
    case "keyword_research":
      return "Research inputs";
    case "bulk_metadata":
      return "Pages and mode";
    case "one_off_metadata":
      return "Page details";
    case "schema_generation":
      return "Community facts";
    case "llms_txt":
      return "Site details";
    case "local_audit":
      return "Checklist";
    case "listing_optimization":
      return "Listing details";
  }
}

function sectionDescription(toolType: ToolType): string {
  switch (toolType) {
    case "keyword_research":
      return "Rankings, related keywords, and backlinks are pulled from Semrush and scored against the site's pages.";
    case "bulk_metadata":
      return "Pages come from an uploaded SEOPress template or the XML sitemap. Existing sites keep their current metadata for comparison.";
    case "one_off_metadata":
      return "Writes one focused title, description, and H1 with rationale.";
    case "schema_generation":
      return "Only the facts you enter are used. Nothing is invented.";
    case "llms_txt":
      return "Generates a deterministic llms.txt from the site's sitemap and page metadata.";
    case "local_audit":
      return "Seeds a staff-verifiable checklist for Google, Bing, Apple Maps, and off-site NAP consistency.";
    case "listing_optimization":
      return "Rewrites third-party listing copy (Greystar or any other provider) around target keywords.";
  }
}

function renderFields(toolType: ToolType) {
  switch (toolType) {
    case "keyword_research":
      return (
        <>
          <label>
            Website URL
            <input name="targetUrl" type="url" required placeholder="https://example.com" />
          </label>
          <label>
            Target location
            <input name="location" required placeholder="Long Beach, California" />
          </label>
          <label>
            Property name (optional)
            <input name="propertyName" placeholder="Alexan West End" />
          </label>
        </>
      );
    case "bulk_metadata":
      return (
        <>
          <label>
            Website URL
            <input name="targetUrl" type="url" placeholder="https://example.com" />
          </label>
          <label>
            Mode
            <select name="mode" defaultValue="existing">
              <option value="existing">Existing site — propose edits</option>
              <option value="development">New / development site — full first pass</option>
            </select>
          </label>
          <label>
            Target keywords (one per line, optional)
            <textarea name="keywords" rows={3} />
          </label>
          <label>
            SEOPress template CSV (optional)
            <input name="templateFile" type="file" accept=".csv,text/csv" />
            <small className="label-hint">
              Upload an existing SEOPress export to preserve its exact columns
              on export.
            </small>
          </label>
        </>
      );
    case "one_off_metadata":
      return (
        <>
          <label>
            Page URL
            <input name="pageUrl" type="url" required placeholder="https://example.com/floor-plans/" />
          </label>
          <label>
            Target keywords (one per line)
            <textarea name="keywords" rows={3} />
          </label>
          <label>
            Page context (optional)
            <textarea
              name="pageContext"
              rows={3}
              placeholder="Paste page copy if the page is not live yet"
            />
          </label>
        </>
      );
    case "schema_generation":
      return (
        <>
          <label>
            Community name
            <input name="communityName" required />
          </label>
          <label>
            Community URL
            <input name="communityUrl" type="url" required />
          </label>
          <label>
            Street address
            <input name="streetAddress" required />
          </label>
          <div className="field-row">
            <label>
              City
              <input name="city" required />
            </label>
            <label>
              State / region
              <input name="region" required />
            </label>
            <label>
              Postal code
              <input name="postalCode" required />
            </label>
          </div>
          <label>
            Phone (optional)
            <input name="telephone" />
          </label>
          <label>
            Description (optional)
            <textarea name="description" rows={2} />
          </label>
          <label>
            Amenities (one per line, optional)
            <textarea name="amenities" rows={3} />
          </label>
          <label>
            Pets allowed
            <select name="petsAllowed" defaultValue="">
              <option value="">Not specified</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
          <label>
            Floor plans (optional, one per line: Name | URL | Beds | Baths | SqFt)
            <textarea
              name="floorPlans"
              rows={4}
              placeholder="Plan A1 | https://example.com/floorplan/a1/ | 1 | 1 | 750"
            />
          </label>
        </>
      );
    case "llms_txt":
      return (
        <>
          <label>
            Website URL
            <input name="targetUrl" type="url" required placeholder="https://example.com" />
          </label>
          <label>
            Site name (optional — defaults to the client name)
            <input name="siteName" />
          </label>
          <label>
            One-line site description (optional)
            <input name="description" />
          </label>
        </>
      );
    case "local_audit":
      return (
        <p className="label-hint">
          The checklist covers Google Business Profile, Google Maps, Bing Maps,
          Apple Maps, and off-site NAP fields. Expected name, address, and phone
          values come from the client intake questionnaire when filled in.
        </p>
      );
    case "listing_optimization":
      return (
        <>
          <label>
            Listing URL
            <input
              name="listingUrl"
              type="url"
              required
              placeholder="https://www.greystar.com/properties/..."
            />
          </label>
          <label>
            Target keywords (one per line)
            <textarea name="keywords" rows={3} />
          </label>
          <label>
            Current listing copy (paste if the listing cannot be fetched)
            <textarea name="originalCopy" rows={4} />
          </label>
        </>
      );
  }
}
