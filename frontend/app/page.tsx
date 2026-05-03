import { redirect } from "next/navigation";

// `/` serves the static landing page that lives at /public/landing/index.html.
// The interactive demo (role picker → dispatcher/tech flows) lives at /app.
export default function Root() {
  redirect("/landing/index.html");
}
