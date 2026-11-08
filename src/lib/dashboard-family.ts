// A FAMILY'S AND ITS VIEWER'S READS, AS ONE ANSWER: the family record, its children, its members' ids, its parents
// with each one's texting state, and the viewer's own name and addresses; and the class, school-day, evaluation,
// volunteering and event reads — the viewer's own classes learnt and taught this academic year, the next school days,
// whether a child of the family has a submitted evaluation, and the family's volunteering work and events.
import { getFamilyRecord, type FamilyRecord } from './roster-family-record'
import { getFamilyMembers } from './roster-families'
import {
  familyChildren, familyParentsWithPhone, personNameAndAddresses, teachingClassesOf, upcomingSchoolDays, familySubmittedEvaluation,
} from './dashboard'
import { getStudentSchedule } from './roster-classes'
import { volunteerHistory, type VolunteerHistoryRow } from './volunteering'
import { eventHistory, type EventHistoryRow } from './events'
import { currentAcademicYear, localDateStr, schoolYearBounds } from './years'
import { yearRules } from './year-context'
import { ports } from '../ports'
import { textingStates } from './sms-consent'
import type { TextingState } from './sms-words'

export type DashboardParent = { id: string; firstName: string; lastName: string | null; phone: string | null; state: TextingState | null }
export type DashboardFamily = {
  record: FamilyRecord | null
  familyKids: Awaited<ReturnType<typeof familyChildren>>
  memberIds: string[]
  /** The family's parents with the texting state of the number each holds; null when the family names none. */
  parents: DashboardParent[] | null
  me: Awaited<ReturnType<typeof personNameAndAddresses>> | null
  /** The viewer's own classes this academic year, as a student and as a teacher. */
  myClasses: Awaited<ReturnType<typeof getStudentSchedule>>
  teachingClasses: Awaited<ReturnType<typeof teachingClassesOf>>
  /** The next school days from today through the academic year's end. */
  upcomingEvents: Awaited<ReturnType<typeof upcomingSchoolDays>>
  /** One submitted evaluation of the family's children this academic year, if any. */
  completedEvals: Awaited<ReturnType<typeof familySubmittedEvaluation>>
  volunteerWork: VolunteerHistoryRow[]
  eventHistory: EventHistoryRow[]
}

export async function dashboardFamily(tenantId: string, familyId: string | null, mePersonId: string | null, includeActivity: boolean): Promise<DashboardFamily> {
  const y = await yearRules(tenantId)
  const at = ports().clock.now()
  const aYear = currentAcademicYear(y, at)
  const [record, familyKids, members, parents, me, myClasses, teachingClasses, upcomingEvents, completedEvals] = await Promise.all([
    familyId ? getFamilyRecord(tenantId, familyId, { includeActivity }) : Promise.resolve(null),
    familyId ? familyChildren(tenantId, familyId) : Promise.resolve([]),
    familyId ? getFamilyMembers(tenantId, familyId) : Promise.resolve([]),
    familyId ? familyParentsWithPhone(tenantId, familyId) : Promise.resolve(null),
    mePersonId ? personNameAndAddresses(mePersonId) : Promise.resolve(null),
    mePersonId ? getStudentSchedule(tenantId, mePersonId, aYear) : Promise.resolve([]),
    mePersonId ? teachingClassesOf(tenantId, mePersonId, aYear) : Promise.resolve([]),
    upcomingSchoolDays(tenantId, localDateStr(y, at), schoolYearBounds(y, aYear).endDate),
    familyId ? familySubmittedEvaluation(tenantId, familyId, aYear) : Promise.resolve([]),
  ])
  const memberIds = members.map(m => m.id)
  const [texting, volunteerWork, events] = await Promise.all([
    parents ? textingStates(tenantId, parents) : Promise.resolve(null),
    familyId ? volunteerHistory(tenantId, memberIds) : Promise.resolve([]),
    familyId ? eventHistory(tenantId, memberIds) : Promise.resolve([]),
  ])
  return {
    record, familyKids, memberIds, me,
    parents: parents ? parents.map(p => ({ ...p, state: texting?.get(p.id)?.state ?? null })) : null,
    myClasses, teachingClasses, upcomingEvents, completedEvals, volunteerWork, eventHistory: events,
  }
}
