// Shared limits keep pasted reviews, file imports, and the API consistent.
export const MAX_REVIEW_CHARACTERS = 100_000;
export const MAX_MESSAGE_CHARACTERS = MAX_REVIEW_CHARACTERS + 2_100;
export function reviewMessage(draft: string, selection = "") {
  if (draft.length > MAX_REVIEW_CHARACTERS) throw new Error("Keep your review under 100,000 characters. Nothing was sent or truncated.");
  return `${draft.trim()}${selection ? `\n\nSelected report text:\n${selection.slice(0, 2000)}` : ""}`;
}
