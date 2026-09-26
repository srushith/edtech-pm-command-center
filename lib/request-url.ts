// proxy.ts copies each dashboard request's path and query into this request header, so the
// layout knows which address the server HTML is rendered for (layouts get no pathname). The shell
// renders from it while hydrating: see useShellLocation in components/shell/shell-context.tsx.
// Display only: it says which page was asked for, never who may see it.
export const REQUEST_URL_HEADER = "x-cc-request-url";
