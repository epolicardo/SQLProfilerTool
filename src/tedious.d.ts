// `tedious@15` (transitive via `mssql@9`) ships no type declarations, and the
// current `@types/tedious` package is a stub that defers to those missing
// bundled types. `@types/mssql` still references a few `tedious` types, so this
// ambient module supplies just those. The extension never imports `tedious`
// directly — it only uses the `mssql` pool/request API.
declare module 'tedious' {
    export type Connection = Record<string, never>;

    export interface ConnectionOptions {
        appName?: string;
        encrypt?: boolean;
        trustServerCertificate?: boolean;
    }

    export type ConnectionAuthentication = Record<string, never>;
}
