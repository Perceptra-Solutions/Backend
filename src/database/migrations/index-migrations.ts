import { Init1756400000000 } from './1756400000000-Init.js';
import { IndicesETriggers1756400001000 } from './1756400001000-IndicesETriggers.js';
import { AuditoriaNc1756400002000 } from './1756400002000-AuditoriaNc.js';
import { CredencialDispositivo1756400003000 } from './1756400003000-CredencialDispositivo.js';

/**
 * Lista explicita de migrations, na ordem. Mesmo motivo do entidades.ts:
 * glob de caminho nao funciona sob ESM no Windows.
 */
export const MIGRATIONS = [
  Init1756400000000,
  IndicesETriggers1756400001000,
  AuditoriaNc1756400002000,
  CredencialDispositivo1756400003000,
];
