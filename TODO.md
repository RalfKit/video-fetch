# TODO

_No open issues._

## Resolved

- **`ReferenceError: Cannot access 'schedulerState' before initialization`**
  Root cause: server startup ran as a module-load side effect inside a circular
  import graph (`store → subscriptions → process → store`), so
  `startSubscriptionScheduler()` could execute before `subscriptions.ts` had
  finished initializing its module-level state. Startup now runs once from the
  SvelteKit `init` server hook (`src/hooks.server.ts`) after the whole module
  graph is evaluated, and the database connection is created lazily.
