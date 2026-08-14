# DatSer

**Open-source attendance and member management for churches, youth ministries, nonprofits, and community teams.**

DatSer is a fast, offline-resilient attendance tracking and member-management dashboard built with React, Vite, and Supabase. Born out of real-world church and youth ministry workflows in Ghana, DatSer replaces fragile spreadsheets and complex enterprise software with a streamlined, secure system designed for fast Sunday check-ins, durable member registries, and multi-team collaboration.

![DatSer Dashboard](docs/readme-dashboard.png)

---

## Why DatSer Exists

Many local churches, youth fellowships, community organizations, and small nonprofits struggle with attendance tracking. They are often caught between two extremes:

1. **Fragile Spreadsheets & Paper Rosters**: Manual paper lists are easily misplaced, and multi-tab spreadsheets are prone to duplicate rows, accidental overwrites, formatting corruption, and zero mobile offline reliability.
2. **Expensive Enterprise Church Management Systems**: Bulky, costly platforms designed for large Western institutions that require high monthly subscriptions, complex onboarding, and constant high-speed connectivity.

**DatSer solves this problem** by providing a lightweight, purpose-built dashboard that works seamlessly on desktop browsers, mobile screens, and Android devices—even when internet access is spotty or unavailable during services.

---

## Key Features

### ⚡ Fast Attendance Check-in
- **Instant Marking**: Mark members present or absent with single-tap controls and instant summary counters.
- **Sunday Service Calendar**: Automatically identifies and tracks Sunday services across any calendar month.
- **Missing-Data Prompts**: Optional guided reminders to collect important missing member profile details (phone, level, etc.) during check-in.

### 👥 Member Directory & Real-time Search
- **Instant Search**: Real-time filtering across member names, phone numbers, unique member codes, and custom tags.
- **Rich Profiles**: Track full names, contact info, school/work level, date of birth, emergency contacts, and attendance history.
- **Cross-Month Lookup**: Search and present members from historical month tables without manual re-entry.

### 🔒 Workspace Isolation & Multi-Month Tracking
- **Dedicated Monthly Rosters**: Organizes records into distinct monthly attendance relations (e.g., `January_2026`, `August_2026`).
- **Workspace Security**: Complete tenant data isolation powered by PostgreSQL Row Level Security (RLS).
- **Collaborator Team Access**: Securely invite team members and volunteers with owner-controlled permissions.

### 📶 Offline-First Resilience
- **Local Caching**: Download active workspace and month data locally via IndexedDB.
- **Offline Queue**: Continue marking attendance without internet connectivity on mobile or desktop.
- **Conflict-Safe Sync**: Automatically syncs queued records upon reconnection with server-side conflict verification.

### 🏷️ Canonical Member Codes & Badges
- **Monotonic Alphanumeric Codes**: Deterministic member code generation (e.g., `A01`, `001`, `AAA`) unique per workspace.
- **Printable Badges & QR Passes**: Generate badges and evergreen QR codes for fast scanner check-in.

### 📊 Analytics & Export
- **Attendance Insights**: Review attendance trends, gender breakdowns, and regular vs. newcomer ratios.
- **CSV Data Export**: Export filtered member rosters and monthly attendance logs to standard CSV files.

### 📱 Android & Mobile App Support
- **Capacitor Integration**: Packaged as an Android APK with offline asset bundling.
- **Private Release Management**: In-app APK updates with Supabase Storage and version tracking.

### ♿ Accessibility & Customization
- **Visual Themes**: Built-in Light and Dark modes.
- **Typography Support**: Scalable font sizing and dedicated **OpenDyslexic** font support for enhanced readability.

---

## Security & Reliability Architecture

DatSer handles real-world community and member data. The platform is engineered with a security-first architecture:

- **Row Level Security (RLS) as Primary Boundary**: Database queries and mutations strictly enforce PostgreSQL RLS policies tied to authenticated user IDs and verified workspace collaborator roles.
- **Deterministic Transactional Advisory Locking**: Critical operations (e.g., member code allocations) use `pg_advisory_xact_lock` to eliminate concurrency races and dual-ownership collisions.
- **Provenance Verification**: Strict database constraints and migration-level integrity guards prevent orphaned or cross-workspace member adoption.
- **Automated Quality Verification**: Automated test coverage spanning frontend components, state management, offline sync coordinators, and PostgreSQL migration security invariants.

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| **Frontend Framework** | [React 18](https://react.dev/) + [Vite](https://vitejs.dev/) |
| **Styling** | [Tailwind CSS](https://tailwindcss.com/) + PostCSS + Custom Design Tokens |
| **Backend & Database** | [Supabase](https://supabase.com/) (PostgreSQL 17, PostgREST, Auth, Realtime, Storage) |
| **Client Storage** | IndexedDB + `localStorage` |
| **Mobile Runtime** | [Capacitor](https://capacitorjs.com/) (Android) |
| **Icons** | [Lucide React](https://lucide.dev/) |
| **Testing** | [Vitest](https://vitest.dev/), React Testing Library, Playwright |

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18.0.0 or higher recommended)
- [npm](https://www.npmjs.com/) (v9.0.0 or higher)
- A [Supabase](https://supabase.com/) project (or local Supabase instance)

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/diallobeniah-max/DatSer.git
   cd DatSer
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```
   Fill in your Supabase credentials:
   ```env
   VITE_SUPABASE_URL=https://your-project-id.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-public-key
   VITE_SUPABASE_REDIRECT_URL=http://localhost:5173
   ```

4. **Start Local Development**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Quality Assurance & Testing

DatSer includes automated unit, integration, migration, and smoke-test coverage.

```bash
# Run automated Vitest test suite
npm test

# Run code style & static analysis check
npm run lint

# Verify production Vite build bundle
npm run build

# Run Playwright smoke tests
npm run test:smoke
```

---

## Project Documentation

Detailed guides and architecture specifications are available in the repository:

- 📶 **[Offline Mode Architecture](OFFLINE_MODE.md)** — IndexedDB queuing, synchronization, and conflict resolution.
- 📱 **[Android APK Guide](ANDROID_APK.md)** — Capacitor setup, local bundling, and APK compilation.
- 🔄 **[In-App Updates](APP_UPDATES.md)** — Private APK update distribution via Supabase Storage.
- ♿ **[Accessibility Features](ACCESSIBILITY_FEATURES.md)** — High contrast, font scaling, and OpenDyslexic support.
- 🔒 **[Security Policy](SECURITY.md)** — Vulnerability reporting and security architecture.
- 🤝 **[Contributing Guidelines](CONTRIBUTING.md)** — Code standards, PR workflow, and quality rules.

---

## Project Status & Roadmap

DatSer is actively developed and maintained for local ministry operations. Ongoing areas of active development include:

- [x] Fast Sunday attendance tracking & real-time search
- [x] Multi-month workspace isolation with PostgreSQL RLS
- [x] Offline-first IndexedDB sync coordinator
- [x] Deterministic member-code allocation & advisory locking
- [ ] Paper Scan OCR sheet extraction & Compare-and-Correct workflow (in active development)
- [ ] Automated multi-service attendance reporting (Morning / Evening sessions)
- [ ] Enhanced SMS and parent notification integrations

---

## License

DatSer is open-source software licensed under the [MIT License](LICENSE).
