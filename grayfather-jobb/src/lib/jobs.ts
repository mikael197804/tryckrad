import { z } from "zod";
import { sql } from "./db";
import { JOB_SEGMENTS } from "./segments";

export const jobInputSchema = z.object({
  company: z.string().trim().min(2).max(120),
  title: z.string().trim().min(2).max(120),
  segment: z.enum(JOB_SEGMENTS),
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
  segment: string;
  location: string;
  employment_type: string;
  description: string;
  contact: string;
  telegram_user: string | null;
  created_at: string;
  sample?: boolean;
};

export type JobFilters = {
  q?: string;
  segment?: string;
  location?: string;
};

const SAMPLE_JOBS: Job[] = [
  {
    id: "sample-underskoterska",
    company: "Omsorg Norr",
    title: "Undersköterska till hemtjänst",
    segment: "Undersköterska",
    location: "Umeå",
    employment_type: "Heltid",
    description:
      "Vi söker undersköterska till hemtjänst med fokuslarbete och dokumentation. Vårdutbildning krävs. Körkort B är meriterande.",
    contact: "rekrytering@omsorgnorr.example",
    telegram_user: null,
    created_at: new Date().toISOString(),
    sample: true,
  },
  {
    id: "sample-snickare",
    company: "Bygglaget AB",
    title: "Snickare till nyproduktion",
    segment: "Snickare",
    location: "Uppsala",
    employment_type: "Heltid",
    description:
      "Erfaren snickare sökes till husbyggnation. Du trivs i team, kan ritningar och har koll på arbetsmiljö.",
    contact: "jobb@bygglaget.example",
    telegram_user: null,
    created_at: new Date().toISOString(),
    sample: true,
  },
  {
    id: "sample-rivare",
    company: "Riv & Sanera",
    title: "Rivare / asbestsanerare",
    segment: "Asbestsanerare",
    location: "Göteborg",
    employment_type: "Heltid",
    description:
      "Rivning och asbestsanering i industri- och bostadsprojekt. Certifikat och skyddsutrustning enligt branschkrav.",
    contact: "hr@rivsanera.example",
    telegram_user: null,
    created_at: new Date().toISOString(),
    sample: true,
  },
  {
    id: "sample-betong",
    company: "Håltagning Syd",
    title: "Betonghåltagare",
    segment: "Betonghåltagare",
    location: "Malmö",
    employment_type: "Heltid",
    description:
      "Håltagning i betong för nybyggnation och ROT. Erfarenhet av sågning och borrning är ett krav.",
    contact: "jobb@haltagningssyd.example",
    telegram_user: null,
    created_at: new Date().toISOString(),
    sample: true,
  },
  {
    id: "sample-isolerare",
    company: "Isolera Väst",
    title: "Isolerare",
    segment: "Isolerare",
    location: "Borås",
    employment_type: "Heltid",
    description:
      "Isolering av väggar, tak och installationer. Vi söker dig som är noggrann och van vid byggarbetsplats.",
    contact: "rekrytering@isoleravast.example",
    telegram_user: null,
    created_at: new Date().toISOString(),
    sample: true,
  },
];

function matchesFilters(job: Job, filters: JobFilters): boolean {
  const q = filters.q?.trim().toLocaleLowerCase("sv") ?? "";
  const segment = filters.segment?.trim() ?? "";
  const location = filters.location?.trim() ?? "";

  if (segment && segment !== "Alla" && job.segment !== segment) return false;
  if (
    location &&
    location !== "Hela Sverige" &&
    job.location.toLocaleLowerCase("sv") !== location.toLocaleLowerCase("sv")
  ) {
    return false;
  }
  if (!q) return true;

  const haystack = [
    job.title,
    job.company,
    job.segment,
    job.location,
    job.description,
  ]
    .join(" ")
    .toLocaleLowerCase("sv");
  return haystack.includes(q);
}

export async function listJobs(filters: JobFilters = {}): Promise<Job[]> {
  try {
    const rows = await sql<Job>(
      `select id, company, title, segment, location, employment_type, description, contact, telegram_user, created_at::text
       from jobs
       order by created_at desc
       limit 500`,
    );
    const source = rows.length === 0 ? SAMPLE_JOBS : rows;
    return source.filter((job) => matchesFilters(job, filters));
  } catch {
    return SAMPLE_JOBS.filter((job) => matchesFilters(job, filters));
  }
}

export async function createJob(input: JobInput): Promise<Job> {
  const id = crypto.randomUUID();
  const rows = await sql<Job>(
    `insert into jobs (id, company, title, segment, location, employment_type, description, contact, telegram_user)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning id, company, title, segment, location, employment_type, description, contact, telegram_user, created_at::text`,
    [
      id,
      input.company,
      input.title,
      input.segment,
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
    `${job.segment} · ${job.company} · ${job.location} · ${job.employment_type}`,
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
