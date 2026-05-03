# Run the backend

## 1. Fill in keys

Open `.env` and replace the placeholders:

- `OPENAI_API_KEY` — required. Used for both the chat model and corpus embeddings.

## 2. Install + set up the DB

```bash
cd backend
npm install
npm run db:migrate       # creates .railio.db
npm run db:seed          # loads assets + parts + demo tickets
npm run corpus:fetch     # downloads real CFR sources into corpus-sources/raw/ (~700 KB)
npm run db:seed-corpus   # parses, chunks, embeds, loads the manual + tribal corpus
```

## 3. Start the server

```bash
npm run dev
```

Listens on `http://localhost:3001`. The frontend on `:3000` calls it via CORS.

## 4. (Optional) Test it

In another terminal, with `npm run dev` running:

```bash
npm run e2e            # drives a full ticket end-to-end
npm run verify-chain   # confirms the messages hash chain is intact
```
