import type { Job } from "./jobs";
import { formatOffersFooterForTelegram } from "./offers";

/** Jobbannons + reklamtext, redo att klistra in i Telegram. */
export function formatJobWithOffersForTelegram(job: Job): string {
  const channel = "𝕘𝕣𝕒𝕪𝕗𝕒𝕥𝕙𝕖𝕣";
  const lines = [
    `Nytt jobb via ${channel}`,
    "",
    job.title,
    `${job.segment} · ${job.company} · ${job.location} · ${job.employment_type}`,
    "",
    job.description,
    "",
    `Kontakt: ${job.contact}`,
  ];
  if (job.telegram_user) {
    lines.push(`Telegram: @${job.telegram_user.replace(/^@/, "")}`);
  }

  const footer = formatOffersFooterForTelegram(job.segment);
  if (footer) {
    lines.push("", footer);
  }
  return lines.join("\n");
}
