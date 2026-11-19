# TryckRad

Webbapp som analyserar **Svenska Spels Powerplay** (ishockey) **per speltillfälle** – matcher blandas aldrig mellan omgångar.

## Vad den gör

1. Hämtar alla öppna Powerplay-omgångar från Svenska Spel  
2. Visar varje speltillfälle för sig (SHL, NHL, HA, …)  
3. Bedömer odds + svenska folket  
4. Flaggar lag med tuff **matchbelastning** (matcher tätt inpå)  
5. Läser artiklar/nyheter kopplade till lagen  
6. Genererar **systemrader i kupongformat** för **48–720 kr**

## Kör lokalt

```bash
cd tryckrad
npm install
npm run dev
```

Öppna [http://127.0.0.1:3000](http://127.0.0.1:3000).

API: `GET /api/draws` returnerar analys + system + artiklar för alla öppna speltillfällen.

## Ansvar

Analysverktyg utan vinstgaranti. 18+. Spela ansvarsfullt via Svenska Spel.
