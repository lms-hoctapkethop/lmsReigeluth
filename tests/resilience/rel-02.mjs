import { crashAfterCommit } from '../../apps/api/src/ops/fault.ts'

crashAfterCommit(process.argv[2] ?? 'submitAssignment')
console.log('alive')
