# KARSA Executive Work Tracker

Internal work-management workspace for PT Karsa Lifestyle Nusantara.

## Access model

There is **NO public registration page**.

Accounts are provisioned internally.

### Roles

- **Director** — visibility/read-only executive monitoring.
- **General Manager** — creates assignments and monitors all divisions.
- **Head Divisi Operasional (HDO)** — creates assignments and monitors all divisions.
- **Head Divisi** — sees all jobs in their own division. They can update progress only when explicitly selected as the PIC.
- **Staff** — sees jobs in their own division. They can update progress only for jobs explicitly assigned to their account.

### Core rule

The person selected as `PIC` is the only person allowed to update:

- progress
- status
- blocker
- next action

Other staff in the same division can see the job but cannot update it.

GM/HDO create the assignment; they do not update the PIC's progress.

## Assignment flow

```text
GM / HDO
   ↓
Pilih Divisi
   ↓
Pilih PIC
   ↓
Job masuk langsung ke workspace divisi
   ↓
PIC update progres
   ↓
100% → Siap Review
```

## Current organization accounts

Director:
- Andre Rizki Juanda

Management:
- Johannes Betrand S. Pardosi — General Manager
- Muhammad Hasan Niam — Head Divisi Operasional

Finance:
- Andreas — Head Divisi Finance
- Rizqia Febrianoor — Staff Finance

IT:
- Dimas Putra Pratama — Head Divisi IT
- Vicky Ferdiansyah — Staff IT

R&D:
- Alif — Head Divisi R&D
- Muslimin — Staff R&D
- Reja Maulana — Staff R&D

Operasional:
- Peter Vincent Kusuma — Staff Operasional

## Supabase setup

1. Create a Supabase project.
2. Open SQL Editor.
3. Run `supabase-schema.sql`.
4. Install Node.js on your local computer.
5. Run:
   `npm install`
6. Set environment variables:
   `SUPABASE_URL=...`
   `SUPABASE_SERVICE_ROLE_KEY=...`
7. Run:
   `node provision-users.mjs`

The provisioning script creates the internal Supabase Auth users and matching `public.profiles` records.

It also generates temporary passwords in:
`initial-credentials.txt`

Keep that file private. Distribute credentials through your internal channel, then delete the file.

**Never place the service-role key in `config.js`, GitHub, or the frontend.**

## Frontend connection

Edit `config.js`:

```js
window.KARSA_CONFIG = {
  SUPABASE_URL: "YOUR_PROJECT_URL",
  SUPABASE_KEY: "YOUR_PUBLISHABLE_OR_ANON_KEY",
  DEMO_MODE: false
};
```

The preview/demo login has been intentionally removed.

## Deployment

- GitHub Pages = frontend/static hosting
- Supabase Auth = authentication
- Supabase PostgreSQL = database
- Supabase RLS = access control

## Important production note

Before real company use, add:
- password reset
- notification center
- deadline notifications
- progress history timeline
- assignment audit log
- attachment handling
- realtime updates
- explicit Ops/GM review workflow
- backup/retention policy
