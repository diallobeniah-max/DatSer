# Contributing to DatSer

Thank you for your interest in contributing to DatSer! We welcome contributions that help make member and attendance management faster, more reliable, and more accessible for community organizations.

---

## Development Setup

### Prerequisites

- **Node.js**: `v18+` (or `v20+` recommended)
- **npm**: `v9+`
- **Git**: Installed and configured

### Installation

1. **Fork and Clone**:
   ```bash
   git clone https://github.com/diallobeniah-max/DatSer.git
   cd DatSer
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Copy the example environment configuration:
   ```bash
   cp .env.example .env.local
   ```
   Provide your development Supabase URL and anon key (never use production credentials for local development).

4. **Start Development Server**:
   ```bash
   npm run dev
   ```

---

## Quality & Testing Guidelines

Before submitting any Pull Request, ensure that all automated checks pass cleanly:

```bash
# Run the test suite (Vitest + React Testing Library)
npm test

# Run ESLint (must pass with 0 warnings and 0 errors)
npm run lint

# Verify production Vite build
npm run build
```

### Writing Tests

- Add unit tests alongside new utilities (e.g., `src/utils/myUtil.test.js`).
- Component tests belong alongside components (e.g., `src/components/MyComponent.test.jsx`).
- Database migrations must include corresponding structural and security regression tests in `src/services/` or `supabase/migrations/`.

---

## Database Migrations & Security Rules

DatSer manages real-world member and attendance data. Please observe these principles:

1. **Row Level Security (RLS)**: Every new relation must have RLS enabled and explicit policies checking workspace access.
2. **Deterministic Locking**: Use transaction-scoped advisory locks (`pg_advisory_xact_lock`) when allocating codes or executing multi-step batch mutations.
3. **Workspace Isolation**: Never bypass `workspace_owner_id` or assume client-supplied workspace parameters without server-side validation.
4. **No Secrets in Commits**: Never commit `.env` files with active API keys, service role secrets, or real member records.

---

## Pull Request Process

1. Create a feature branch from the latest active branch:
   ```bash
   git checkout -b feature/my-feature-name
   ```
2. Make focused, well-documented commits.
3. Verify all tests pass (`npm test && npm run lint && npm run build`).
4. Open a Pull Request with a clear description of the problem solved, changes made, and testing performed.
