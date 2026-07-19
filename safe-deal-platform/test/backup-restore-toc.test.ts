import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePgRestoreList, tocHasTable } from '../scripts/backup-restore-toc';

/** Exact-style lines from a real ONIX custom dump (`pg_restore --list`). */
const SAMPLE_TOC = `
;
; Archive created at 2026-07-18
;
221; 1259 49257 TABLE public _prisma_migrations neondb_owner
223; 1259 49298 TABLE public User neondb_owner
224; 1259 49310 TABLE public Product neondb_owner
226; 1259 49331 TABLE public Order neondb_owner
230; 1259 65665 TABLE public OrderTransition neondb_owner
237; 1259 65778 TABLE public UserBlock neondb_owner
255; 1259 74019 TABLE public UserRole neondb_owner
265; 1259 139271 TABLE public UserReport neondb_owner
274; 1259 188705 TABLE public ProductViewUnique neondb_owner
278; 1259 204825 TABLE public ProductCreationSession neondb_owner
300; 0 0 TABLE DATA public User neondb_owner
301; 0 0 TABLE DATA public Order neondb_owner
`;

test('tocHasTable matches unquoted TOC: TABLE public User', () => {
  assert.equal(tocHasTable(SAMPLE_TOC, 'User'), true);
  assert.equal(tocHasTable(SAMPLE_TOC, 'Order'), true);
  assert.equal(tocHasTable(SAMPLE_TOC, 'Product'), true);
  assert.equal(tocHasTable(SAMPLE_TOC, '_prisma_migrations'), true);
});

test('tocHasTable does not confuse UserBlock with User', () => {
  const onlyBlock = '237; 1259 65778 TABLE public UserBlock neondb_owner\n';
  assert.equal(tocHasTable(onlyBlock, 'User'), false);
  assert.equal(tocHasTable(onlyBlock, 'UserBlock'), true);
});

test('tocHasTable accepts quoted TABLE public "User"', () => {
  const quoted = '223; 1259 49298 TABLE public "User" neondb_owner\n';
  assert.equal(tocHasTable(quoted, 'User'), true);
});

test('parsePgRestoreList: ok true when all required tables present', () => {
  const info = parsePgRestoreList(SAMPLE_TOC);
  assert.equal(info.hasUser, true);
  assert.equal(info.hasOrder, true);
  assert.equal(info.hasProduct, true);
  assert.equal(info.hasPrismaMigrations, true);
  assert.equal(info.ok, true);
  assert.ok(info.tableCount >= 4);
  assert.ok(info.sample.some((l) => l.includes('TABLE public User')));
});

test('parsePgRestoreList: ok false when User missing', () => {
  const noUser = SAMPLE_TOC.replace('223; 1259 49298 TABLE public User neondb_owner\n', '');
  const info = parsePgRestoreList(noUser);
  assert.equal(info.hasUser, false);
  assert.equal(info.ok, false);
});

test('TABLE DATA lines are not counted as table definitions', () => {
  const info = parsePgRestoreList(SAMPLE_TOC);
  assert.ok(!info.sample.some((l) => /TABLE DATA/.test(l)));
});
