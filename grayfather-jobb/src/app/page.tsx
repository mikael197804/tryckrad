import { JobBoard } from "@/components/JobBoard";
import { channelDisplayName, channelUrl } from "@/lib/telegram";

export default function HomePage() {
  const channel = channelDisplayName();
  const url = channelUrl();

  return (
    <main className="site">
      <header className="hero">
        <div className="hero-media" aria-hidden="true" />
        <div className="hero-mist" aria-hidden="true" />
        <div className="hero-content">
          <p className="brand">
            <span className="brand-mark">{channel}</span>
            Grayfather
          </p>
          <h1>Hitta rätt folk till ditt team</h1>
          <p className="support">
            Arbetsgivare lägger ut jobb i yrkessegment över hela Sverige – sök
            kommun för kommun och dela i Telegram.
          </p>
          <div className="cta-row">
            <a className="btn primary" href="#lagg-ut">
              Lägg ut jobb
            </a>
            <a className="btn ghost" href="#annonser">
              Se annonser
            </a>
          </div>
        </div>
      </header>

      <section className="section">
        <div className="section-inner">
          <p className="eyebrow">Så funkar det</p>
          <h2>Från annons till Telegram på tre steg</h2>
          <p className="lede">
            Segment för bland annat undersköterska, snickare, rivare,
            asbestsanerare, betonghåltagare och isolerare. Du skickar själv in
            appen i Telegram när koden är klar.
          </p>
          <ol className="steps">
            <li>
              <span className="step-num">1</span>
              <div>
                <h3>Välj segment och kommun</h3>
                <p>Sök över hela Sverige eller kommun för kommun.</p>
              </div>
            </li>
            <li>
              <span className="step-num">2</span>
              <div>
                <h3>Publicera annonsen</h3>
                <p>Företag, roll, beskrivning och kontakt sparas i listan.</p>
              </div>
            </li>
            <li>
              <span className="step-num">3</span>
              <div>
                <h3>Dela i Telegram</h3>
                <p>Kopiera färdig text och klistra in i {channel}.</p>
              </div>
            </li>
          </ol>
        </div>
      </section>

      <JobBoard channelUrl={url} />

      <footer className="site-footer">
        <div className="section-inner">
          <strong>Grayfather Jobb</strong>
          <p>
            Kopplad till Telegram-sidan {channel}.{" "}
            {url !== "https://t.me/" ? (
              <a href={url} target="_blank" rel="noreferrer">
                Öppna kanalen
              </a>
            ) : (
              <span>Lägg till TELEGRAM_CHANNEL_URL för direktlänk.</span>
            )}
          </p>
        </div>
      </footer>
    </main>
  );
}
