# Security Policy

## Responsible Disclosure

The DatSer team takes the security and privacy of member and organization data seriously. If you discover a security vulnerability in DatSer, please report it privately and responsibly so we can resolve it promptly.

### Reporting a Vulnerability

- **GitHub Private Vulnerability Reporting**: Please use the **Report a vulnerability** feature under the **Security** tab of the GitHub repository whenever possible.
- **Direct Maintainer Contact**: If GitHub private reporting is unavailable, reach out to the project maintainers directly with details of the vulnerability.

Please provide:
1. A clear description of the vulnerability and its potential impact.
2. Step-by-step reproduction steps, proof-of-concept code, or HTTP request examples.
3. The affected component, file, or migration.

> [!IMPORTANT]
> **Do not** open public GitHub issues for security vulnerabilities.
> **Do not** post real church/member personal information, private database connection strings, service-role keys, or production tokens in bug reports or public forums.

---

## Security Architecture & Threat Model

DatSer manages member registries, contact information, attendance records, and team roles. Security is designed around the following core boundaries:

1. **Row Level Security (RLS) as the Primary Boundary**:
   - All client database queries and mutations route through PostgreSQL Row Level Security.
   - The anon key is public; authorization is strictly determined by PostgreSQL policies checking `auth.uid()`, workspace ownership, and active collaborator memberships.

2. **Workspace Isolation**:
   - DatSer isolates each organization's or owner's data into distinct workspace partitions.
   - Multi-tenant physical month tables require verified `workspace_owner_id` provenance.
   - Cross-workspace queries, member-code claims, and mutations are rejected server-side.

3. **Atomic Transactional Operations & Advisory Locking**:
   - Critical operations (such as member code allocations, batch paper scan saves, and cross-month member imports) use deterministic PostgreSQL advisory locks (`pg_advisory_xact_lock`) and database transactions to prevent race conditions and dual-ownership collisions.

4. **Offline Sync Integrity**:
   - Offline changes queued in IndexedDB are validated with server-side conflict checks during reconnection, preventing stale or unauthorized overwrites.

---

## Supported Versions

| Version / Branch | Supported |
| --- | --- |
| `main` / `feature/ui-v2` | :white_check_mark: Active security fixes |
| Older releases | :x: Please update to the latest branch |
