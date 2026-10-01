import { describe, expect, it } from 'vitest'
import { ConfigError } from '../src/config.ts'
import {
  assertStagingEnv,
  stagingClassCodes,
  stagingCsv,
  stagingGuardians,
  stagingObservations,
  stagingRoster,
  stagingStudents,
  stagingSubmissions,
  stagingTeachers,
} from '../src/seed-staging.ts'
import { fillStagingHistory, historyAssignmentItems, requireApprovedLink, submissionSlot } from '../src/seed-staging-history.ts'

describe('seed-staging', () => {
  it('từ chối khi không phải staging', () => {
    expect(() => assertStagingEnv({ HCN_ENV: 'production' })).toThrow(ConfigError)
    expect(() => assertStagingEnv({})).toThrow(/HCN_ENV/)
    expect(() => assertStagingEnv({ HCN_ENV: 'staging' })).not.toThrow()
  })

  it('sinh 1 215 HS, 60 GV, 300 PH, tên tái lập', () => {
    const roster = stagingRoster()
    expect(roster.filter((person) => person.role === 'student' && person.username.startsWith('stg.hs'))).toHaveLength(stagingStudents)
    expect(roster.filter((person) => person.role === 'teacher' && person.username.startsWith('stg.gv'))).toHaveLength(stagingTeachers)
    expect(roster.filter((person) => person.role === 'guardian')).toHaveLength(stagingGuardians)
    expect(stagingClassCodes()).toHaveLength(27)
    expect(stagingStudents).toBe(1215)
    expect(stagingSubmissions).toBe(10_000)
    expect(stagingObservations).toBe(200_000)
    const again = stagingRoster()
    expect(again[0]).toEqual(roster[0])
    expect(stagingCsv(roster.slice(0, 1))).toContain('stg.hs0001,student')
  })

  it('lịch sử gọi đủ use case và từ chối khi chưa có KC đã duyệt', async () => {
    expect(() => requireApprovedLink(undefined)).toThrow(/seed-curriculum/)
    expect(submissionSlot(9999, stagingStudents, historyAssignmentItems)).toEqual({ student: 9999 % stagingStudents, item: 8 })
    expect(() => submissionSlot(stagingStudents * historyAssignmentItems, stagingStudents, historyAssignmentItems)).toThrow(/không đủ/)
    let submissions = 0
    let observations = 0
    const filled = await fillStagingHistory({
      submissions: stagingSubmissions,
      observations: stagingObservations,
      existingSubmissions: 0,
      existingObservations: 0,
      submit: async () => {
        submissions += 1
      },
      observe: async () => {
        observations += 1
      },
    })
    expect(filled).toEqual({ submissions: stagingSubmissions, observations: stagingObservations })
    expect(submissions).toBe(stagingSubmissions)
    expect(observations).toBe(stagingObservations)
    let again = 0
    await fillStagingHistory({
      submissions: stagingSubmissions,
      observations: 3,
      existingSubmissions: stagingSubmissions,
      existingObservations: 3,
      submit: async () => {
        again += 1
      },
      observe: async () => {
        again += 1
      },
    })
    expect(again).toBe(0)
  })
})