import type { JobSegment } from "./segments";

export type SegmentOffer = {
  id: string;
  title: string;
  blurb: string;
  category: string;
  /** Byt till din egen affiliate-URL innan du går live. */
  url: string;
  cta: string;
};

/**
 * Reklamplatser per yrkessegment.
 * Byt `url` till dina affiliate-länkar (smink, verktyg, maskiner, m.m.).
 * Länkar märkta example.com är platshållare.
 */
export const SEGMENT_OFFERS: Record<JobSegment, SegmentOffer[]> = {
  Undersköterska: [
    {
      id: "us-care",
      title: "Hudvård & smink för långa pass",
      blurb: "Lätta produkter som håller under arbetspass.",
      category: "Smink & vård",
      url: "https://example.com/affiliate/vard-smink",
      cta: "Se erbjudande",
    },
    {
      id: "us-shoes",
      title: "Arbetsskor med dämpning",
      blurb: "Skor anpassade för vårdgolv och långa dagar.",
      category: "Arbetskläder",
      url: "https://example.com/affiliate/vardskor",
      cta: "Jämför skor",
    },
  ],
  Snickare: [
    {
      id: "sn-tools",
      title: "Handverktyg & sågar",
      blurb: "Verktygspaket för snickeri och husbyggnation.",
      category: "Arbetsmaskiner",
      url: "https://example.com/affiliate/snickarverktyg",
      cta: "Se verktyg",
    },
    {
      id: "sn-machine",
      title: "Kap- och gersåg",
      blurb: "Maskiner för precisionskap på bygget.",
      category: "Arbetsmaskiner",
      url: "https://example.com/affiliate/gersag",
      cta: "Se maskiner",
    },
  ],
  Rivare: [
    {
      id: "riv-gear",
      title: "Rivningsutrustning",
      blurb: "Hammare, kofötter och skydd för rivningsjobb.",
      category: "Arbetsmaskiner",
      url: "https://example.com/affiliate/rivning",
      cta: "Se utrustning",
    },
  ],
  Asbestsanerare: [
    {
      id: "asb-protect",
      title: "Andningsskydd & overaller",
      blurb: "Skyddsutrustning för saneringsmiljöer.",
      category: "Skydd",
      url: "https://example.com/affiliate/asbestskydd",
      cta: "Se skydd",
    },
  ],
  Betonghåltagare: [
    {
      id: "bet-drill",
      title: "Betongborr & sågblad",
      blurb: "Förbrukning och maskiner för håltagning.",
      category: "Arbetsmaskiner",
      url: "https://example.com/affiliate/betong",
      cta: "Se sortiment",
    },
  ],
  Isolerare: [
    {
      id: "iso-gear",
      title: "Isoleringsverktyg",
      blurb: "Knivar, tejp och skyddsutrustning för isolering.",
      category: "Arbetsmaskiner",
      url: "https://example.com/affiliate/isolering",
      cta: "Se verktyg",
    },
  ],
  Elektriker: [
    {
      id: "el-tools",
      title: "Mätinstrument & handverktyg",
      blurb: "Utrustning för elinstallationer.",
      category: "Arbetsmaskiner",
      url: "https://example.com/affiliate/elverktyg",
      cta: "Se verktyg",
    },
  ],
  "VVS-montör": [
    {
      id: "vvs-tools",
      title: "Pressverktyg & kopplingar",
      blurb: "Material och verktyg för VVS-montage.",
      category: "Arbetsmaskiner",
      url: "https://example.com/affiliate/vvs",
      cta: "Se sortiment",
    },
  ],
  Målare: [
    {
      id: "mal-paint",
      title: "Färg & rollers",
      blurb: "Förbrukning till målare på bygge och ROT.",
      category: "Material",
      url: "https://example.com/affiliate/malarfarg",
      cta: "Se produkter",
    },
  ],
  Plattsättare: [
    {
      id: "plat-tools",
      title: "Kakelskärare & fästmassa",
      blurb: "Verktyg och material för plattsättning.",
      category: "Material",
      url: "https://example.com/affiliate/plattsattning",
      cta: "Se sortiment",
    },
  ],
  Takläggare: [
    {
      id: "tak-gear",
      title: "Säkerhetssele & takverktyg",
      blurb: "Utrustning för arbete på tak.",
      category: "Skydd",
      url: "https://example.com/affiliate/tak",
      cta: "Se utrustning",
    },
  ],
  Ställningsbyggare: [
    {
      id: "stall-gear",
      title: "Fallskydd & handskar",
      blurb: "Skydd för ställningsarbete.",
      category: "Skydd",
      url: "https://example.com/affiliate/stallning",
      cta: "Se skydd",
    },
  ],
  Truckförare: [
    {
      id: "truck-gear",
      title: "Skyddsskor & hörselskydd",
      blurb: "Utrustning för lagergolv och truckmiljö.",
      category: "Skydd",
      url: "https://example.com/affiliate/truck",
      cta: "Se skydd",
    },
  ],
  Lagerarbetare: [
    {
      id: "lager-gear",
      title: "Arbetshandskar & skor",
      blurb: "Slitstarka plagg för lagerarbete.",
      category: "Arbetskläder",
      url: "https://example.com/affiliate/lager",
      cta: "Se kläder",
    },
  ],
  Chaufför: [
    {
      id: "chauf-gear",
      title: "Förarutrustning",
      blurb: "Bekväma plagg och tillbehör för långa körningar.",
      category: "Arbetskläder",
      url: "https://example.com/affiliate/chauffor",
      cta: "Se erbjudanden",
    },
  ],
  Lokalvårdare: [
    {
      id: "lok-clean",
      title: "Städmaterial & skor",
      blurb: "Produkter för lokalvårdare i vardagen.",
      category: "Material",
      url: "https://example.com/affiliate/lokalvard",
      cta: "Se produkter",
    },
  ],
  "Kock / köksbiträde": [
    {
      id: "kok-gear",
      title: "Kockknivar & skor",
      blurb: "Utrustning för kökspersonal.",
      category: "Arbetskläder",
      url: "https://example.com/affiliate/kok",
      cta: "Se sortiment",
    },
  ],
  "Barista / café": [
    {
      id: "cafe-gear",
      title: "Baristatillbehör",
      blurb: "Kanna, termometer och förkläden.",
      category: "Material",
      url: "https://example.com/affiliate/barista",
      cta: "Se tillbehör",
    },
  ],
  Butiksmedarbetare: [
    {
      id: "butik-style",
      title: "Smink & styling",
      blurb: "Produkter som syns i kundnära jobb.",
      category: "Smink & vård",
      url: "https://example.com/affiliate/butik-smink",
      cta: "Se smink",
    },
  ],
  Administratör: [
    {
      id: "admin-desk",
      title: "Kontor & ergonomi",
      blurb: "Skärmstativ, tangentbord och belysning.",
      category: "Kontor",
      url: "https://example.com/affiliate/kontor",
      cta: "Se produkter",
    },
  ],
  Övrigt: [
    {
      id: "ovr-workwear",
      title: "Allmänna arbetskläder",
      blurb: "Basutrustning för många yrkesroller.",
      category: "Arbetskläder",
      url: "https://example.com/affiliate/arbetsklader",
      cta: "Se kläder",
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
