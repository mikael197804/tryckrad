"use client";

import { useState } from "react";
import type { SegmentOffer } from "@/lib/offers";
import {
  formatOfferForTelegram,
  formatSegmentOffersForTelegram,
} from "@/lib/offers";

export function OfferRail({
  offers,
  heading = "Erbjudanden för segmentet",
  segmentLabel = "Alla",
}: {
  offers: SegmentOffer[];
  heading?: string;
  segmentLabel?: string;
}) {
  const [copiedId, setCopiedId] = useState("");

  if (offers.length === 0) return null;

  async function copyText(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
    } catch {
      setCopiedId("");
    }
  }

  const segmentText =
    segmentLabel && segmentLabel !== "Alla"
      ? formatSegmentOffersForTelegram(segmentLabel)
      : offers.map(formatOfferForTelegram).join("\n\n———\n\n");

  return (
    <aside className="offer-rail" aria-label="Segmenterbjudanden">
      <p className="eyebrow">Partnererbjudanden</p>
      <h3>{heading}</h3>
      <p className="offer-note">
        Kopiera texten och klistra in den direkt i Telegram. Byt senare till
        dina Adtraction-spårlänkar i <code>src/lib/offers.ts</code> för
        provision.
      </p>

      <button
        type="button"
        className="btn primary offer-cta"
        onClick={() => copyText("all", segmentText)}
      >
        {copiedId === "all" ? "Kopierad – klistra in i Telegram" : "Kopiera alla till Telegram"}
      </button>

      <ul className="offer-list">
        {offers.map((offer) => {
          const text = formatOfferForTelegram(offer);
          return (
            <li key={offer.id}>
              <p className="offer-cat">{offer.category}</p>
              <p className="offer-title">{offer.title}</p>
              <p className="offer-blurb">{offer.blurb}</p>
              <p className="offer-partner">
                {offer.partner} · {offer.network} · annonslänk
              </p>
              <pre className="offer-telegram-preview">{text}</pre>
              <div className="offer-actions">
                <button
                  type="button"
                  className="btn primary offer-cta"
                  onClick={() => copyText(offer.id, text)}
                >
                  {copiedId === offer.id
                    ? "Kopierad"
                    : "Kopiera till Telegram"}
                </button>
                <a
                  className="btn ghost offer-cta"
                  href={offer.url}
                  target="_blank"
                  rel="noopener noreferrer sponsored"
                >
                  Öppna butik
                </a>
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
