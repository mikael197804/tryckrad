import type { JobSegment } from "./segments";

export type SegmentOffer = {
  id: string;
  title: string;
  blurb: string;
  category: string;
  partner: string;
  network: string;
  /**
   * Byt till din spårade affiliate-länk från Adtraction (eller annat nät)
   * när du är godkänd i programmet. Tills dess pekar länken på butiken.
   */
  url: string;
  cta: string;
};

/**
 * Reklam per yrkessegment – svenska butiker med kända affiliate-program.
 * Skapa konto på Adtraction, ansök till programmen, byt `url` till dina spårlänkar.
 */
export const SEGMENT_OFFERS: Record<JobSegment, SegmentOffer[]> = {
  Undersköterska: [
    {
      id: "us-kicks",
      title: "Smink & hudvård hos KICKS",
      blurb: "Skönhet för långa vårdpass – affiliate via Adtraction.",
      category: "Smink & vård",
      partner: "KICKS",
      network: "Adtraction",
      url: "https://www.kicks.se/",
      cta: "Öppna KICKS",
    },
    {
      id: "us-eleven",
      title: "Skönhet hos Eleven",
      blurb: "Upp till ca 15 % provision via Adtraction (enligt Eleven).",
      category: "Smink & vård",
      partner: "Eleven",
      network: "Adtraction",
      url: "https://eleven.se/",
      cta: "Öppna Eleven",
    },
    {
      id: "us-comforth",
      title: "Egenvård hos Comforth",
      blurb: "Nordisk vård & välmående – affiliate via Adtraction.",
      category: "Smink & vård",
      partner: "Comforth",
      network: "Adtraction",
      url: "https://comforth.se/",
      cta: "Öppna Comforth",
    },
  ],
  Snickare: [
    {
      id: "sn-verktyg",
      title: "Verktyg & maskiner – Verktygsproffsen",
      blurb: "Byggverktyg med ca 5 % provision via Adtraction.",
      category: "Arbetsmaskiner",
      partner: "Verktygsproffsen",
      network: "Adtraction",
      url: "https://www.verktygsproffsen.se/",
      cta: "Öppna Verktygsproffsen",
    },
    {
      id: "sn-proffs",
      title: "Proffsmagasinet – verktyg för bygget",
      blurb: "Stort sortiment för snickeri och husbyggnation via Adtraction.",
      category: "Arbetsmaskiner",
      partner: "Proffsmagasinet",
      network: "Adtraction",
      url: "https://www.proffsmagasinet.se/",
      cta: "Öppna Proffsmagasinet",
    },
  ],
  Rivare: [
    {
      id: "riv-verktyg",
      title: "Rivningsverktyg hos Verktygsproffsen",
      blurb: "Hammare, kofötter och maskiner – Adtraction-affiliate.",
      category: "Arbetsmaskiner",
      partner: "Verktygsproffsen",
      network: "Adtraction",
      url: "https://www.verktygsproffsen.se/",
      cta: "Se verktyg",
    },
    {
      id: "riv-proffs",
      title: "Skydd & verktyg hos Proffsmagasinet",
      blurb: "Utrustning för rivningsjobb via Adtraction.",
      category: "Skydd",
      partner: "Proffsmagasinet",
      network: "Adtraction",
      url: "https://www.proffsmagasinet.se/",
      cta: "Se sortiment",
    },
  ],
  Asbestsanerare: [
    {
      id: "asb-proffs",
      title: "Andningsskydd & overaller",
      blurb: "Skyddsutrustning för sanering via Proffsmagasinet / Adtraction.",
      category: "Skydd",
      partner: "Proffsmagasinet",
      network: "Adtraction",
      url: "https://www.proffsmagasinet.se/",
      cta: "Se skydd",
    },
  ],
  Betonghåltagare: [
    {
      id: "bet-verktyg",
      title: "Borr & sågblad för betong",
      blurb: "Maskiner och förbrukning via Verktygsproffsen / Adtraction.",
      category: "Arbetsmaskiner",
      partner: "Verktygsproffsen",
      network: "Adtraction",
      url: "https://www.verktygsproffsen.se/",
      cta: "Se maskiner",
    },
  ],
  Isolerare: [
    {
      id: "iso-proffs",
      title: "Isoleringsverktyg & skydd",
      blurb: "Knivar, tejp och skyddsutrustning via Proffsmagasinet.",
      category: "Arbetsmaskiner",
      partner: "Proffsmagasinet",
      network: "Adtraction",
      url: "https://www.proffsmagasinet.se/",
      cta: "Se verktyg",
    },
  ],
  Elektriker: [
    {
      id: "el-verktyg",
      title: "Elverktyg & mätinstrument",
      blurb: "Handverktyg för installation via Verktygsproffsen.",
      category: "Arbetsmaskiner",
      partner: "Verktygsproffsen",
      network: "Adtraction",
      url: "https://www.verktygsproffsen.se/",
      cta: "Se verktyg",
    },
  ],
  "VVS-montör": [
    {
      id: "vvs-proffs",
      title: "VVS-verktyg & material",
      blurb: "Pressverktyg och tillbehör via Proffsmagasinet.",
      category: "Arbetsmaskiner",
      partner: "Proffsmagasinet",
      network: "Adtraction",
      url: "https://www.proffsmagasinet.se/",
      cta: "Se sortiment",
    },
  ],
  Målare: [
    {
      id: "mal-proffs",
      title: "Måleriverktyg & material",
      blurb: "Rollers, tejp och verktyg via Proffsmagasinet.",
      category: "Material",
      partner: "Proffsmagasinet",
      network: "Adtraction",
      url: "https://www.proffsmagasinet.se/",
      cta: "Se produkter",
    },
  ],
  Plattsättare: [
    {
      id: "plat-verktyg",
      title: "Verktyg för plattsättning",
      blurb: "Skärare och handverktyg via Verktygsproffsen.",
      category: "Material",
      partner: "Verktygsproffsen",
      network: "Adtraction",
      url: "https://www.verktygsproffsen.se/",
      cta: "Se verktyg",
    },
  ],
  Takläggare: [
    {
      id: "tak-proffs",
      title: "Fallskydd & takverktyg",
      blurb: "Säkerhetsutrustning via Proffsmagasinet / Adtraction.",
      category: "Skydd",
      partner: "Proffsmagasinet",
      network: "Adtraction",
      url: "https://www.proffsmagasinet.se/",
      cta: "Se skydd",
    },
  ],
  Ställningsbyggare: [
    {
      id: "stall-proffs",
      title: "Fallskydd & handskar",
      blurb: "Skydd för ställningsarbete via Proffsmagasinet.",
      category: "Skydd",
      partner: "Proffsmagasinet",
      network: "Adtraction",
      url: "https://www.proffsmagasinet.se/",
      cta: "Se skydd",
    },
  ],
  Truckförare: [
    {
      id: "truck-proffs",
      title: "Skyddsskor & hörselskydd",
      blurb: "Utrustning för lagergolv via Proffsmagasinet.",
      category: "Skydd",
      partner: "Proffsmagasinet",
      network: "Adtraction",
      url: "https://www.proffsmagasinet.se/",
      cta: "Se skydd",
    },
  ],
  Lagerarbetare: [
    {
      id: "lager-proffs",
      title: "Arbetshandskar & skor",
      blurb: "Slitstarka plagg via Proffsmagasinet.",
      category: "Arbetskläder",
      partner: "Proffsmagasinet",
      network: "Adtraction",
      url: "https://www.proffsmagasinet.se/",
      cta: "Se kläder",
    },
  ],
  Chaufför: [
    {
      id: "chauf-proffs",
      title: "Arbetskläder för förare",
      blurb: "Bekväma plagg via Proffsmagasinet.",
      category: "Arbetskläder",
      partner: "Proffsmagasinet",
      network: "Adtraction",
      url: "https://www.proffsmagasinet.se/",
      cta: "Se sortiment",
    },
  ],
  Lokalvårdare: [
    {
      id: "lok-proffs",
      title: "Skydd & skor för lokalvård",
      blurb: "Praktisk utrustning via Proffsmagasinet.",
      category: "Material",
      partner: "Proffsmagasinet",
      network: "Adtraction",
      url: "https://www.proffsmagasinet.se/",
      cta: "Se produkter",
    },
  ],
  "Kock / köksbiträde": [
    {
      id: "kok-kicks",
      title: "Hudvård för kökspersonal",
      blurb: "Smink & vård efter långa pass – KICKS / Adtraction.",
      category: "Smink & vård",
      partner: "KICKS",
      network: "Adtraction",
      url: "https://www.kicks.se/",
      cta: "Öppna KICKS",
    },
  ],
  "Barista / café": [
    {
      id: "cafe-eleven",
      title: "Skönhet & styling för caféjobb",
      blurb: "Eleven via Adtraction – smink som syns i kundmöten.",
      category: "Smink & vård",
      partner: "Eleven",
      network: "Adtraction",
      url: "https://eleven.se/",
      cta: "Öppna Eleven",
    },
  ],
  Butiksmedarbetare: [
    {
      id: "butik-kicks",
      title: "Smink & styling – KICKS",
      blurb: "Produkter för kundnära jobb, affiliate via Adtraction.",
      category: "Smink & vård",
      partner: "KICKS",
      network: "Adtraction",
      url: "https://www.kicks.se/",
      cta: "Öppna KICKS",
    },
    {
      id: "butik-lyko",
      title: "Skönhet hos LYKO",
      blurb: "Stort skönhetssortiment – sök LYKO i Adtraction.",
      category: "Smink & vård",
      partner: "LYKO",
      network: "Adtraction",
      url: "https://www.lyko.com/sv/",
      cta: "Öppna LYKO",
    },
  ],
  Administratör: [
    {
      id: "admin-comforth",
      title: "Egenvård för kontorsvardag",
      blurb: "Comforth via Adtraction – produkter för återhämtning.",
      category: "Smink & vård",
      partner: "Comforth",
      network: "Adtraction",
      url: "https://comforth.se/",
      cta: "Öppna Comforth",
    },
  ],
  Övrigt: [
    {
      id: "ovr-verktyg",
      title: "Verktyg & maskiner",
      blurb: "Bredd för många yrken – Verktygsproffsen / Adtraction.",
      category: "Arbetsmaskiner",
      partner: "Verktygsproffsen",
      network: "Adtraction",
      url: "https://www.verktygsproffsen.se/",
      cta: "Se verktyg",
    },
    {
      id: "ovr-smink",
      title: "Smink & skönhet",
      blurb: "KICKS via Adtraction – bred skönhetskategori.",
      category: "Smink & vård",
      partner: "KICKS",
      network: "Adtraction",
      url: "https://www.kicks.se/",
      cta: "Öppna KICKS",
    },
  ],
};

export function offersForSegment(segment: string): SegmentOffer[] {
  if (segment in SEGMENT_OFFERS) {
    return SEGMENT_OFFERS[segment as JobSegment];
  }
  return SEGMENT_OFFERS["Övrigt"];
}

export function offersForFilter(segmentFilter: string): SegmentOffer[] {
  if (!segmentFilter || segmentFilter === "Alla") {
    return [
      ...SEGMENT_OFFERS.Snickare,
      ...SEGMENT_OFFERS.Undersköterska,
      ...SEGMENT_OFFERS.Asbestsanerare,
      ...SEGMENT_OFFERS.Betonghåltagare,
      ...SEGMENT_OFFERS.Isolerare,
    ].slice(0, 6);
  }
  return offersForSegment(segmentFilter);
}
