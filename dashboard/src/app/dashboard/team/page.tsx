// Client-facing name for the same user administration surface. The page is
// scope-aware, so a client_owner sees only their own tenant's users and can only
// assign client roles — the API enforces both.
export { default } from '../users/page';
