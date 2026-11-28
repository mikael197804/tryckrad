"use client";

import type { SegmentOffer } from "@/lib/offers";

export function OfferRail({
  offers,
  heading = "Erbjudanden för segmentet",
}: {
  offers: SegmentOffer[];
  heading?: string;
}) {
  if (offers.length === 0) return null;

  return (
    <aside className="offer-rail" aria-label="Segmenterbjudanden">
      <p className="eyebrow">Partnererbjudanden</p>
      <h3>{heading}</h3>
      <p className="offer-note">
        Byt länkarna i koden till dina affiliate-URL:er (smink, maskiner, skydd
        m.m.) för att tjäna provision.
      </p>
      <ul className="offer-list">
        {offers.map((offer) => (
          <li key={offer.id}>
            <p className="offer-cat">{offer.category}</p>
            <p className="offer-title">{offer.title}</p>
            <p className="offer-blurb">{offer.blurb}</p>
            <a
              className="btn primary offer-cta"
              href={offer.url}
              target="_blank"
              rel="noopener noreferrer sponsored"
            >
              {offer.cta}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}
