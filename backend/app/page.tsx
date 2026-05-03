export default function RootPage() {
  return (
    <main style={{ fontFamily: "ui-sans-serif, system-ui", padding: 32 }}>
      <h1>Railio backend</h1>
      <p>API-only app on port 3001. UI lives in the frontend on :3000.</p>
      <p>See <code>/api/tickets</code>, <code>/api/parts</code>, <code>/api/corpus/chunks/:id</code>.</p>
    </main>
  );
}
