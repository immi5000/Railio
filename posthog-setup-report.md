<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into the Railio FastAPI backend. A `Posthog()` client singleton is initialized at app startup via the lifespan context manager and flushed on shutdown. Six events covering the core Railio workflow — onboarding, ticket lifecycle, messaging, and photo capture — are now instrumented across four router files. Every event uses the Supabase user UUID (`supabase_user_id`) as the distinct ID, keeping users identifiable without sending PII in event properties.

| Event | Description | File |
|---|---|---|
| `user_onboarded` | User completes profile and joins an organization | `backend/railio/routers/users.py` |
| `ticket_created` | Dispatcher opens a new maintenance ticket | `backend/railio/routers/tickets.py` |
| `ticket_status_updated` | A ticket's status is explicitly changed | `backend/railio/routers/tickets.py` |
| `ticket_closed` | A ticket is finalized through the wrap-up flow | `backend/railio/routers/tickets.py` |
| `message_sent` | A dispatcher or tech sends a message in a ticket thread | `backend/railio/routers/messages.py` |
| `photos_uploaded` | A tech uploads one or more photos to a ticket | `backend/railio/routers/photos.py` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- [Analytics basics (wizard) — Dashboard](https://us.posthog.com/project/474767/dashboard/1725939)
- [Tickets created over time](https://us.posthog.com/project/474767/insights/ksuYUqe4)
- [Messages sent over time](https://us.posthog.com/project/474767/insights/Ogm17MJ6)
- [Ticket resolution funnel](https://us.posthog.com/project/474767/insights/yNsIWw8P)
- [Photos uploaded over time](https://us.posthog.com/project/474767/insights/USq0M65F)
- [User onboarding count](https://us.posthog.com/project/474767/insights/QgXwxMz0)

## Verify before merging

- [ ] Run a full production build (the wizard only verified the files it touched) and fix any lint or type errors introduced by the generated code.
- [ ] Run the test suite — call sites that were rewritten or instrumented may need updated mocks or fixtures.
- [ ] Add `POSTHOG_PROJECT_TOKEN` and `POSTHOG_HOST` to `backend/.env.example` (or any bootstrap scripts) so collaborators know what to set.
- [ ] Confirm the returning-visitor path also calls identify — the `user_onboarded` handler only identifies on first-time onboarding; returning sessions on already-onboarded users rely on the distinct ID already being set in PostHog from that first onboarding call.

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
