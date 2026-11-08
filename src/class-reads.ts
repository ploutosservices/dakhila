// THE CLASSES AND TEACHERS, READ (lib/roster-classes-view.ts, roster-teachers-view.ts, roster-classes.ts), each with
// its who-may. The reader groups and labels the rows.
import { may } from './access'
import type { PersonCall, Route } from './routes'
import { badRequest, notFound, ok, S } from './op'
import { getDistinctYears, classDeletionBlockers } from './lib/roster-classes'
import { tenantCatalogCourses, classesOfYearWithEnrolment, classTeacherNamesOfYear, studentsOfYearCount } from './lib/roster-classes-view'
import { classesOfYearWithMeet, teachersOfYear, liveEnrollmentCounts, teacherCandidates } from './lib/roster-teachers-view'
import { classRoster } from './lib/class-roster'
import { namesForRejections } from './lib/rejection-names'
import { departmentRoster, rosterDepartments } from './lib/department-roster'
import { joinedIndex } from './lib/student-joined'
import { sessionTeacherRows } from './lib/mailing-list-teachers'
import { academicYearOf } from './lib/year-context'
import { eq } from 'drizzle-orm'

const T = '/v1/tenants/{slug}/roster'
const CANDIDATES = S.list(S.obj({ id: S.uuid, firstName: S.str, lastName: S.nullable(S.str), email: S.nullable(S.str) }))

function yearOf(s: string): number | null {
  const y = parseInt(s)
  return Number.isFinite(y) ? y : null
}

export const CLASS_READ_ROUTES: Route[] = [
  {
    method: 'GET', path: `${T}/teachers/session`, operationId: 'teacher.session',
    summary: "This session's teachers, once per department they teach in, with their own address and role — what the teacher mailing lists are kept in step with.",
    permission: 'google.read',
    allowed: async c => may(c.caller, 'google.read'),
    response: S.obj({ year: S.num, rows: S.list(S.obj({ personId: S.uuid, firstName: S.str, lastName: S.nullable(S.str), email: S.nullable(S.str), role: S.nullable(S.str), department: S.str })) }),
    handle: async c => {
      const year = await academicYearOf(c.tenant.id)
      return ok({ year, rows: await sessionTeacherRows(c.tenant.id, year) })
    },
  },
  {
    method: 'GET', path: `${T}/departments/{year}`, operationId: 'department.roster',
    summary: "The year's departments, and one department's families as cards — `dept` when it is one of them, else the first: both parents with their contacts, the children with grade, class and whether each joined its Classroom, and whether the family volunteers. `roster` is null when the year has no classes.",
    permission: 'roster.write',
    textParams: ['year'],
    query: { dept: S.str },
    allowed: async c => may(c.caller, 'roster.write'),
    response: S.obj({ departments: S.list(S.str), roster: S.nullable(S.row('a department roster (src/lib/department-roster.ts DepartmentRoster)')) }),
    handle: async c => {
      const year = yearOf(c.params.year)
      if (year === null) return badRequest('year must be a number')
      const departments = await rosterDepartments(c.tenant.id, year)
      const current = c.query.dept && departments.includes(c.query.dept) ? c.query.dept : departments[0]
      if (!current) return ok({ departments, roster: null })
      return ok({ departments, roster: await departmentRoster(c.tenant.id, year, current, await joinedIndex(c.tenant.id)) })
    },
  },
  {
    method: 'GET', path: `${T}/classes/{id}/roster`, operationId: 'class.roster',
    summary: "A class's page: the class, its teachers, its students with whether each joined its Classroom, and — to a roster reader — its families' contact cards; when the joined check refused, the refusal and the names it names; to a roster deleter, why the class cannot be deleted. 404 when the class is not this tenant's.",
    permission: 'roster.read', alsoAllowed: 'household.read (the families come to roster.read alone)',
    allowed: async c => may(c.caller, 'roster.read') || may(c.caller, 'household.read'),
    response: S.row("the class roster (src/lib/class-roster.ts ClassRoster) with `joined` given as `joinedRefusal` (the run's refusal or null), `rejectionNames` (person id to name) and `deletionBlockers`"),
    handle: async c => {
      const pc = c as PersonCall
      const r = await classRoster(c.tenant.id, c.params.id)
      if (!r) return notFound('no such class in this tenant')
      const { joined, families, ...rest } = r
      const refusal = joined.refusal
      return ok({
        ...rest,
        families: may(pc.caller, 'roster.read') ? families : [],
        joinedRefusal: refusal,
        rejectionNames: refusal ? await namesForRejections(c.tenant.id, refusal.rejections) : {},
        deletionBlockers: may(pc.caller, 'roster.delete') ? await classDeletionBlockers(c.tenant.id, r.cls.id) : [],
      })
    },
  },
  {
    method: 'GET', path: `${T}/classes/year/{year}`, operationId: 'class.year',
    summary: "A year's classes with their enrolment and Classroom, their teachers' names, how many children the year holds, and every year with classes, newest first. A roster writer also hears the catalog and everyone who could teach; with `all` set, a roster deleter hears which empty classes may be deleted.",
    permission: 'roster.read', alsoAllowed: 'household.read',
    textParams: ['year'],
    query: { all: S.str },
    allowed: async c => may(c.caller, 'roster.read') || may(c.caller, 'household.read'),
    response: S.obj({
      years: S.list(S.num),
      classes: S.list(S.row('a class with its catalog fields, enrolmentCount and Classroom (src/lib/roster-classes-view.ts classesOfYearWithEnrolment)')),
      teachers: S.list(S.row("a class's teacher: classId, personId, firstName, lastName, typeOfTeacher")),
      studentCount: S.num,
      courses: S.list(S.row('a catalog course (src/lib/roster-classes-view.ts tenantCatalogCourses)')),
      candidates: CANDIDATES,
      deletable: S.list(S.uuid),
    }),
    handle: async c => {
      const pc = c as PersonCall
      const year = yearOf(c.params.year)
      if (year === null) return badRequest('year must be a number')
      const canWrite = may(pc.caller, 'roster.write')
      const [years, classes, teachers, studentCount, courses, candidates] = await Promise.all([
        getDistinctYears(c.tenant.id),
        classesOfYearWithEnrolment(c.tenant.id, year),
        classTeacherNamesOfYear(c.tenant.id, year),
        studentsOfYearCount(c.tenant.id, year),
        canWrite ? tenantCatalogCourses(c.tenant.id) : Promise.resolve([]),
        canWrite ? teacherCandidates(c.tenant.id) : Promise.resolve([]),
      ])
      // The delete rule is asked only of the empty classes, which are answered only with `all`.
      const deletable: string[] = []
      if (c.query.all === '1' && may(pc.caller, 'roster.delete')) {
        const empty = classes.filter(k => Number(k.enrollmentCount || 0) === 0)
        for (const k of empty) if ((await classDeletionBlockers(c.tenant.id, k.id)).length === 0) deletable.push(k.id)
      }
      return ok({ years: years.map(r => r.year), classes, teachers, studentCount, courses, candidates, deletable })
    },
  },
  {
    method: 'GET', path: `${T}/teachers/year/{year}/export`, operationId: 'teacher.export',
    summary: "The teachers export's rows for a year: the classes, their teacher rows with names and contacts, and live students per class (the rows teacher.year reads, asked roster.export).",
    permission: 'roster.export',
    textParams: ['year'],
    allowed: async c => may(c.caller, 'roster.export'),
    response: S.obj({
      classes: S.list(S.row('a class with its catalog fields and classroomCourseId (src/lib/roster-teachers-view.ts classesOfYearWithMeet)')),
      teachers: S.list(S.row("a teacher row with the person's name and contacts (src/lib/roster-teachers-view.ts teachersOfYear)")),
      counts: S.list(S.obj({ classId: S.uuid, cnt: S.num })),
    }),
    handle: async c => {
      const year = yearOf(c.params.year)
      if (year === null) return badRequest('year must be a number')
      const [classes, teachers] = await Promise.all([classesOfYearWithMeet(c.tenant.id, year), teachersOfYear(c.tenant.id, year)])
      return ok({ classes, teachers, counts: await liveEnrollmentCounts(classes.map(k => k.classId)) })
    },
  },
  {
    method: 'GET', path: `${T}/teachers/year/{year}`, operationId: 'teacher.year',
    summary: "A year's classes with their Classroom's Meet, every teacher row with the person's name and contacts, live students per class, everyone who could teach, and every year with classes, newest first.",
    permission: 'roster.read',
    textParams: ['year'],
    allowed: async c => may(c.caller, 'roster.read'),
    response: S.obj({
      years: S.list(S.num),
      classes: S.list(S.row('a class with its catalog fields, classroomCourseId and meet (src/lib/roster-teachers-view.ts classesOfYearWithMeet)')),
      teachers: S.list(S.row("a teacher row with the person's name and contacts (src/lib/roster-teachers-view.ts teachersOfYear)")),
      counts: S.list(S.obj({ classId: S.uuid, cnt: S.num })),
      candidates: CANDIDATES,
    }),
    handle: async c => {
      const year = yearOf(c.params.year)
      if (year === null) return badRequest('year must be a number')
      const [years, classes, teachers, candidates] = await Promise.all([
        getDistinctYears(c.tenant.id), classesOfYearWithMeet(c.tenant.id, year), teachersOfYear(c.tenant.id, year), teacherCandidates(c.tenant.id),
      ])
      const counts = await liveEnrollmentCounts(classes.map(k => k.classId))
      return ok({ years: years.map(r => r.year), classes, teachers, counts, candidates })
    },
  },
]
