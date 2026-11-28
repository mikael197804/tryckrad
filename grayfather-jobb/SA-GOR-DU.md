# Så gör du – Grayfather Jobb till Telegram

Detta är bara kod. Du lägger själv in texterna i din Telegram-sida  
`*+:｡.｡-𝖌𝐫áվꊰ𝑎Եħℯ𝐫-｡.｡:+*`.

---

## A) Snabbaste sättet (bara klistra in text)

1. Öppna filen **`telegram-texter.txt`** i mappen `grayfather-jobb`.
2. Markera ett block, t.ex. “Erbjudanden för Snickare”.
3. Kopiera (`Ctrl+C` / långtryck → Kopiera på mobilen).
4. Öppna Telegram → din sida/kanal Grayfather.
5. Klistra in texten som ett vanligt meddelande och skicka.

Klart. Du behöver inte ändra någon kod för detta.

---

## B) Lägga ut ett jobb (annons)

### Alternativ 1 – via appen (om du kör den)

1. Starta appen lokalt:
   ```bash
   cd grayfather-jobb
   npm install
   npm run dev
   ```
2. Öppna http://127.0.0.1:3000 i webbläsaren.
3. Scrolla till **Lägg ut ett jobb**.
4. Fyll i företag, roll, **segment** (t.ex. Snickare), **kommun**, beskrivning och kontakt.
5. Tryck **Publicera annons**.
6. Tryck **Kopiera till Telegram**.
7. Öppna Telegram → klistra in → skicka.

Texten innehåller både jobbannonsen och korta reklamlänkar för det yrkessegmentet.

### Alternativ 2 – skriv själv i Telegram

Skriv ungefär så här och skicka:

```text
Nytt jobb via grayfather

Snickare
Snickare · Mitt Företag AB · Uppsala · Heltid

Vi söker en snickare med erfarenhet...

Kontakt: dig@företag.se
```

---

## C) Reklam / tjäna pengar (affiliate)

1. Skapa konto på **https://www.adtraction.com/**
2. Ansök till programmen du vill använda, t.ex.:
   - KICKS / Eleven → smink & skönhet  
   - Verktygsproffsen / Proffsmagasinet → verktyg & maskiner  
3. När du är godkänd: kopiera din **spårlänk** i Adtraction.
4. Öppna filen **`src/lib/offers.ts`**.
5. Hitta raden `url: "https://..."` för den butiken.
6. Byt till din spårlänk, spara.
7. Kör om generering av textfilen om du vill (eller kopiera från appen), och klistra in i Telegram.

Tills du bytt länkar fungerar vanliga butikslänkar – du tjänar då ingen provision.

Mer detaljer: **`AFFILIATE.md`**.

---

## D) Söka jobb i appen

1. Under **Lediga jobb i Sverige**.
2. Välj **segment** (undersköterska, snickare, rivare, …).
3. Välj **Hela Sverige** eller en **kommun**.
4. Ev. skriv fritext i sökfältet.

---

## E) Koppla hela appen som Mini App i Telegram (valfritt)

När du hostat appen med en HTTPS-adress:

1. Öppna **@BotFather** i Telegram.
2. `/newbot` (eller välj befintlig bot).
3. `/newapp` eller `/setmenubutton`.
4. Klistra in din app-URL.

Detta behövs **inte** om du bara vill klistra in text manuellt.

---

## Filer du bryr dig om

| Fil | Vad den är till för |
| --- | --- |
| `telegram-texter.txt` | Färdiga texter att kopiera till Telegram |
| `src/lib/offers.ts` | Byt affiliate-länkar här |
| `AFFILIATE.md` | Mer om provision / Adtraction |
| `SA-GOR-DU.md` | Denna guide |
