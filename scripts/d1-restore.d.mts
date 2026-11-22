export function rowsOf(json: unknown): { name: string; sql?: string; n?: number }[];
export function dropSql(tables: { name: string; sql?: string | null }[], backupSql?: string | null): string;
export function countInserts(sql: string): Record<string, number>;
export function compareCounts(expected: Record<string, number>, live: { name: string; n: number | string }[]): string[];
