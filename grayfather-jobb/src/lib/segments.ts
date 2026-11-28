export const JOB_SEGMENTS = [
  "Undersköterska",
  "Snickare",
  "Rivare",
  "Asbestsanerare",
  "Betonghåltagare",
  "Isolerare",
  "Elektriker",
  "VVS-montör",
  "Målare",
  "Plattsättare",
  "Takläggare",
  "Ställningsbyggare",
  "Truckförare",
  "Lagerarbetare",
  "Chaufför",
  "Lokalvårdare",
  "Kock / köksbiträde",
  "Barista / café",
  "Butiksmedarbetare",
  "Administratör",
  "Övrigt",
] as const;

export type JobSegment = (typeof JOB_SEGMENTS)[number];

export function isJobSegment(value: string): value is JobSegment {
  return (JOB_SEGMENTS as readonly string[]).includes(value);
}
