# Grayfather Jobb

Svensk jobb-sida för arbetsgivare som söker anställda via Telegram-communityn
`*+:｡.｡-𝖌𝐫áվꊰ𝑎Եħℯ𝐫-｡.｡:+*`.

## Lokalt

```bash
npm install
env -u DATABASE_URL npm run dev
```

Öppna [http://127.0.0.1:3000](http://127.0.0.1:3000).

## Koppla till Telegram

1. Öppna [@BotFather](https://t.me/BotFather) i Telegram.
2. Skapa bot med `/newbot` (eller välj befintlig).
3. Spara bot-tokenen som secret `TELEGRAM_BOT_TOKEN` i Cursor.
4. Sätt kanalens länk som secret `TELEGRAM_CHANNEL_URL` (t.ex. `https://t.me/dittkanalnamn`).
5. Kör `/newapp` eller `/setmenubutton` i BotFather och peka på den publicerade app-URL:en.
6. Lägg till boten som admin i din Telegram-sida/kanal om den ska kunna posta.

## Secrets

- `TELEGRAM_BOT_TOKEN` — validerar Mini App-sessioner när den är satt
- `TELEGRAM_CHANNEL_URL` — direktlänk till din Grayfather-sida
