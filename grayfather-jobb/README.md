# Grayfather Jobb

Svensk jobb-sida för arbetsgivare i Telegram-communityn
`*+:｡.｡-𝖌𝐫áվꊰ𝑎Եħℯ𝐫-｡.｡:+*`.

## Funktioner

- Yrkessegment: undersköterska, snickare, rivare, asbestsanerare, betonghåltagare, isolerare med flera
- Sök över hela Sverige eller filtrera kommun för kommun
- Partnererbjudanden per segment (smink, arbetskläder, skyddsutrustning, arbetsmaskiner) – byt URL:er i `src/lib/offers.ts` till dina affiliate-länkar
- Publicera annons och kopiera färdig text till Telegram
- Telegram Mini App-stöd (aktiveras inne i Telegram)

## Lokalt

```bash
cd grayfather-jobb
npm install
env -u DATABASE_URL npm run dev
```

Öppna [http://127.0.0.1:3000](http://127.0.0.1:3000).

## Lägga in i Telegram själv

1. Publicera/hosta appen (HTTPS-URL).
2. Öppna [@BotFather](https://t.me/BotFather) → `/newbot` (eller befintlig bot).
3. `/newapp` eller `/setmenubutton` och peka på app-URL:en.
4. Valfritt: sätt secrets `TELEGRAM_BOT_TOKEN` och `TELEGRAM_CHANNEL_URL` hos hosten.

## Branch

Koden ligger på `cursor/grayfather-jobb-4462` under mappen `grayfather-jobb/`.
