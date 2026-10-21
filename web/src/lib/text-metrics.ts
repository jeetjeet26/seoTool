/** Count Unicode code points, including spaces and punctuation, like Python len(). */
export function characterCount(text: string): number {
  return Array.from(text).length;
}
