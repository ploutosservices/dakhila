// The email recipient groups' names and types — pure, no store.
//
// LANGUAGE GROUPS: the parents of enrolled students, and the teachers, narrowed to one of the school's language
// departments (SchoolRules.courses.languages). A language group is the same group narrowed to classes whose catalog
// department is that language. THE GOVERNING BODY is a group only where the school's rules name one
// (SchoolRules.codes.governingBody), by the name and label they give it.

const WHOLE = ['enrolled-students', 'enrolled-parents', 'teachers'] as const
const NARROWED = ['enrolled-parents', 'teachers'] as const

/** A recipient group's name: a whole group, or `enrolled-parents-{language}` / `teachers-{language}`. */
export type RecipientGroup = string

/** What the groups are made from: the school's languages and its governing body, if it names one. */
export type GroupRules = { languages: readonly string[]; governingBody: { group: string; label: string } | null }

/** The language a word names, in a label: its first letter capitalised. */
const languageLabel = (l: string) => l.charAt(0).toUpperCase() + l.slice(1)

/** Every group the school offers, in order: students; parents, then parents by language;
 *  teachers, then teachers by language; the governing body. */
export function groupRows(g: GroupRules): RecipientGroup[][] {
  return [
    ['enrolled-students'],
    ['enrolled-parents', ...g.languages.map(l => `enrolled-parents-${l}`)],
    ['teachers', ...g.languages.map(l => `teachers-${l}`)],
    ...(g.governingBody ? [[g.governingBody.group]] : []),
  ]
}

/** Each group's label. */
export function groupLabels(g: GroupRules): Record<RecipientGroup, string> {
  const labels: Record<RecipientGroup, string> = {
    'enrolled-students': 'Enrolled students',
    'enrolled-parents': 'Parents of enrolled students',
    'teachers': 'Teachers',
  }
  if (g.governingBody) labels[g.governingBody.group] = g.governingBody.label
  for (const l of g.languages) {
    labels[`enrolled-parents-${l}`] = `Parents of enrolled ${languageLabel(l)} students`
    labels[`teachers-${l}`] = `${languageLabel(l)} teachers`
  }
  return labels
}

/** Whether a group is the school's governing body. */
export function isGoverningBody(g: GroupRules, group: RecipientGroup): boolean {
  return g.governingBody !== null && group === g.governingBody.group
}

/** The language a group is narrowed to, or null for a whole group; undefined for a name that is no group of the
 *  school's. */
export function groupLanguage(g: GroupRules, group: RecipientGroup): string | null | undefined {
  if ((WHOLE as readonly string[]).includes(group) || isGoverningBody(g, group)) return null
  for (const base of NARROWED) {
    const l = group.startsWith(`${base}-`) ? group.slice(base.length + 1) : null
    if (l && g.languages.includes(l)) return l
  }
  return undefined
}
