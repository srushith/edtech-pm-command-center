import type { Sentiment } from "@/lib/generated/prisma/enums";

// Single source of truth for how a 1–5 rating maps to sentiment.
// Used by the seed (to generate) and the integrity checks (to verify).
export function sentimentForRating(rating: number): Sentiment {
  if (rating >= 4) return "POSITIVE";
  if (rating === 3) return "NEUTRAL";
  return "NEGATIVE";
}

// Plausible share of attendees who leave post-session feedback.
export const RESPONSE_RATE_BAND = { min: 0.1, max: 0.8 } as const;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
