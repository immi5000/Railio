import { redirect } from "next/navigation";

// `/` serves the static landing page. Source lives in frontend/landing_page/ and is
// synced into public/landing/ by scripts/sync-landing.mjs (predev/prebuild). Edit
// landing_page/, never public/landing/. The interactive demo lives at /app.
export default function Root() {
  redirect("/landing/index.html");
}
