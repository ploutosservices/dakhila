// THE GOOGLE SCOPES THE ROSTER ASKS, ONE PLACE. Each set is what one roster caller requests when it acts AS an account;
// a host that checks a tenant's account ahead of use can ask for these same sets, so its check asks exactly what the
// code will ask. Pure: no imports.
const A = 'https://www.googleapis.com/auth/'

/** Creating a Classroom, as its owner, the lead teacher (classroom-create.ts). */
export const CLASSROOM_CREATE_SCOPES = [A + 'classroom.courses']
/** Classroom writes: a course's state and its roster. */
export const CLASSROOM_WRITE_SCOPES = [A + 'classroom.courses', A + 'classroom.rosters']
/** Workspace account creation (teacher-account.ts). */
export const DIRECTORY_USER_SCOPES = [A + 'admin.directory.user']
