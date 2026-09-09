import type {FontProblem,FontFailure} from './types';

export class FontFault extends Error {
  constructor(readonly reason: FontProblem, readonly missing?: FontFailure['missing'], readonly range?: FontFailure['range']) { super(reason); }
}

export function invalidFont(): never { throw new FontFault('invalid-font'); }
export function resourceLimit(): never { throw new FontFault('resource-limit'); }
