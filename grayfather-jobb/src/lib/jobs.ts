import { z } from "zod";
import { sql } from "./db";

export const jobInputSchema = z.object({
  company: z.string().trim().min(2).max(120),
  title: z.string().trim().min(2).max(120),
  location: z.string().trim().min(2).max(120),
  employmentType: z
    .enum(["Heltid", "Deltid", "Timanställning", "Konsult", "Praktik"])
    .default("Heltid"),
  description: z.string().trim().min(20).max(4000),
  contact: z.string().trim().min(3).max(200),
  telegramUser: z.string().trim().max(64).optional().or(z.literal("")),
});

export type JobInput = z.infer<typeof jobInputSchema>;

export type Job = {
  id: string;
  company: string;
  title: string;
  location: string;
  employment_type: string;
  description: string;
  contact: string;
  telegram_user: string | null;
  created_at: string;
  sample?: boolean;
};

const SAMPLE_JOBS: Job[] = [
  {
    id: "sample-barista",
    company: "Café Nord",
    title: "Barista / cafémedarbetare",
    location: "Stockholm",
    employment_type: "Deltid",
    description:
      "Vi söker en serviceinriktad barista till vårt café. Erfarenhet av espresso är meriterande. Flexibla pass vardag och helg.",
    contact: "jobb@cafenord.example",
    telegram_user: null,
    created_at: new Date().toISOString(),
    sample: true,
  },
  {
    id: "sample-lager",
    company: "Lagret AB",
    title: "Lagerarbetare",
    location: "Göteborg",
    employment_type: "Heltid",
    description:
      "Ordning, tempo och truckvana. Vi erbjuder schemalagd heltid med kollektivavtal. Körkort B är ett plus.",
    contact: "rekrytering@lagret.example",
    telegram_user: null,
    created_at: new Date().toISOString(),
    sample: true,
  },
];

export async function listJobs(): Promise<Job[]> {
  try {
    const rows = await sql<Job>(
      `select id, company, title, location, employment_type, description, contact, telegram_user, created_at::text
       from jobs
       order by created_at desc
       limit 100`,
    );
    if (rows.length === 0) return SAMPLE_JOBS;
    return rows;
  } catch {
    return SAMPLE_JOBS;
  }
}

export async function createJob(input: JobInput): Promise<Job> {
  const id = crypto.randomUUID();
  const rows = await sql<Job>(
    `insert into jobs (id, company, title, location, employment_type, description, contact, telegram_user)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id, company, title, location, employment_type, description, contact, telegram_user, created_at::text`,
    [
      id,
      input.company,
      input.title,
      input.location,
      input.employmentType,
      input.description,
      input.contact,
      input.telegramUser || null,
    ],
  );
  const job = rows[0];
  if (!job) throw new Error("Kunde inte spara annonsen");
  return job;
}

export function formatJobForTelegram(job: Job): string {
  const channel = "𝕘𝕣𝕒𝕪𝕗𝕒𝕥𝕙𝕖𝕣";
  const lines = [
    `Nytt jobb via ${channel}`,
    "",
    job.title,
    `${job.company} · ${job.location} · ${job.employment_type}`,
    "",
    job.description,
    "",
    `Kontakt: ${job.contact}`,
  ];
  if (job.telegram_user) {
    lines.push(`Telegram: @${job.telegram_user.replace(/^@/, "")}`);
  }
  return lines.join("\n");
}
