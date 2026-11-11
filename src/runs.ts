// THE RUNS: the host's work that no person starts, each a name of the roster's own. A run calls with the host's
// certificate and a header naming it (ports.ts `Identity.runHeader`), and only on the operations whose `runs` name it
// (routes.ts). The name is a label for least privilege and for the log; the certificate alone proves who calls.
//
//   newsletter-authors  who each address is (person.identities)
//   meet-teachers       each linked class's teachers and their classroom addresses (classroom.teacherAddresses)
//   course-links        the linked classes and the persons who own an address (classroom.links, person.byAddress
//                       own-exact)
//   seed                the comment codes, evaluation templates and roles a new tenant starts with

export const RUNS = ['newsletter-authors', 'meet-teachers', 'course-links', 'seed'] as const

export type RunName = typeof RUNS[number]

export function isRun(name: string): name is RunName {
  return (RUNS as readonly string[]).includes(name)
}
