# Frontend

TanStack Start + React 19 + Tailwind 4 + shadcn/ui.

Run from **repo root** (dependencies install via root `package.json`):

```bash
npm ci
npm run dev      # port 5173, proxies /api → localhost:8080
npm run build
npm run lint
npm run format   # after editing .tsx files
```

| Path              | Purpose                               |
| ----------------- | ------------------------------------- |
| `src/routes/`     | `/form`, `/chat`, `/` redirect        |
| `src/components/` | `LoanWizard`, `wizard/`, shadcn `ui/` |
| `src/lib/`        | API clients, form/intake helpers      |
