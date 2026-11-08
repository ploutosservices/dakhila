// NOT MADE IN THIS ENVIRONMENT — a Google write off production.
//
// The rule: where the vendor offers no test system and the target is the tenant's own resource, the stand-in is the
// layer's statement of the act it did not make, and to whom — no call to the vendor; where an act has recipients, the
// statement names the people it would have reached. Google offers no test directory, so off production every Google
// write RETURNS this — never throws it, and never a stock id that looks like Google's — and the screen that pressed
// shows the statement. Nothing fake is stored: an id is kept only when made.

export type NotMade = { made: false; statement: string; to: string[] }

/** The act not made, the object it was on, and the people it would have reached. */
export function notMade(statement: string, to: string[] = []): NotMade {
  return { made: false, statement: `not made in this environment — ${statement}`, to }
}

export function isNotMade(v: unknown): v is NotMade {
  return typeof v === 'object' && v !== null && (v as { made?: unknown }).made === false
    && typeof (v as { statement?: unknown }).statement === 'string'
}

