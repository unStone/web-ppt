import { prepareSlideOpcNamespaces } from './commands/add-slide-identity';
import { prepareElementSpidNamespaces } from './commands/spid';
import { configureIdentityAllocation } from './identity-allocation';
import type { EditDoc } from './types';

/** provider 分配唯一 slot 后，在任何消息收发前固化本副本的逻辑与 OOXML 身份区间。 */
export function configureCollaborationIdentity(
  doc: EditDoc,
  replicaId: string,
  slot: number,
  count = 4096,
): void {
  configureIdentityAllocation(doc.identity, replicaId, slot, count);
  prepareElementSpidNamespaces(doc);
  if (doc.package) prepareSlideOpcNamespaces(doc);
}
