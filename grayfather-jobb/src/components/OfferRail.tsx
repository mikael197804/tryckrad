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
        Annonslänkar per yrkessegment. Skapa konto på{" "}
        <a href="https://www.adtraction.com/" target="_blank" rel="noreferrer">
          Adtraction
        </a>
        , ansök till butikerna och byt URL:erna i{" "}
        <code>src/lib/offers.ts</code> till dina spårlänkar för att tjäna
        provision.
      </p>
      <ul className="offer-list">
        {offers.map((offer) => (
          <li key={offer.id}>
            <p className="offer-cat">{offer.category}</p>
            <p className="offer-title">{offer.title}</p>
            <p className="offer-blurb">{offer.blurb}</p>
            <p className="offer-partner">
              {offer.partner} · {offer.network} · annonslänk
            </p>
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
