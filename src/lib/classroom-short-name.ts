// A GOOGLE CLASSROOM'S SHORT NAME INCLUDES ITS SECTION — the same rule as a roster class's code.
//
// Google has a section in its feed too, and the same short-name rule applies to it.
// A classroom named "X2" with section "B" is "X2B"; one with no section is its name. Every screen and letter
// that names a Google Classroom asks this, never the bare name.
//
// Pure: no store import.

export type ClassroomNameParts = { name: string | null; section: string | null }

export function classroomShortName(c: ClassroomNameParts): string {
  return `${(c.name ?? '').trim()}${(c.section ?? '').trim()}`
}
