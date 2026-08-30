/**
 * Parse `pg_restore --list` TOC text (custom-format dumps).
 *
 * Real TOC lines look like:
 *   223; 1259 49298 TABLE public User neondb_owner
 *   221; 1259 49257 TABLE public _prisma_migrations neondb_owner
 *
 * Shape:  {dumpId}; {catalogOid} {objOid} TABLE {schema} {name} {owner...}
 * Not: TABLE public."User"
 */

export type DumpTocInfo = {
  ok: boolean;
  tableCount: number;
  hasUser: boolean;
  hasOrder: boolean;
  hasProduct: boolean;
  hasPrismaMigrations: boolean;
  sample: string[];
};

/** Match a TABLE definition line (not TABLE DATA). */
const TABLE_DEF_RE = /^(\d+);\s+(\d+)\s+(\d+)\s+TABLE\s+(\S+)\s+(\S+)(?:\s+(.*))?$/;

function unquoteIdent(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/""/g, '"');
  }
  return raw;
}

export type TocTableRef = {
  dumpId: string;
  schema: string;
  name: string;
  owner: string | null;
  line: string;
};

/** Parse all TABLE (definition) entries from a pg_restore --list listing. */
export function parseTocTableDefs(text: string): TocTableRef[] {
  const out: TocTableRef[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';')) continue;
    if (/\bTABLE DATA\b/.test(line)) continue;
    const m = line.match(TABLE_DEF_RE);
    if (!m) continue;
    out.push({
      dumpId: m[1]!,
      schema: unquoteIdent(m[4]!),
      name: unquoteIdent(m[5]!),
      owner: m[6]?.trim() || null,
      line,
    });
  }
  return out;
}

/** True when TOC defines TABLE (not TABLE DATA) for schema.table. */
export function tocHasTable(text: string, tableName: string, schema = 'public'): boolean {
  return parseTocTableDefs(text).some((t) => t.schema === schema && t.name === tableName);
}

export function tocTableDefinitionLines(text: string): string[] {
  return parseTocTableDefs(text).map((t) => t.line);
}

export function parsePgRestoreList(text: string): DumpTocInfo {
  const defs = parseTocTableDefs(text);
  const hasUser = defs.some((t) => t.schema === 'public' && t.name === 'User');
  const hasOrder = defs.some((t) => t.schema === 'public' && t.name === 'Order');
  const hasProduct = defs.some((t) => t.schema === 'public' && t.name === 'Product');
  const hasPrismaMigrations = defs.some((t) => t.schema === 'public' && t.name === '_prisma_migrations');
  const sample = defs
    .filter((t) => ['User', 'Order', 'Product', '_prisma_migrations', 'UserBlock', 'OrderTransition', 'ProductViewUnique', 'UserRole', 'UserReport'].includes(t.name))
    .map((t) => t.line)
    .slice(0, 20);

  return {
    ok: hasUser && hasOrder && hasProduct && hasPrismaMigrations,
    tableCount: defs.length,
    hasUser,
    hasOrder,
    hasProduct,
    hasPrismaMigrations,
    sample,
  };
}
