// A Meet code becomes a URL in exactly one place, store-free, so any reader may import it;
// `classroom-links.ts`, which opens the store, re-exports it.

/** A Meet code becomes a URL in exactly one place. */
export function meetUrl(meet: string | null | undefined): string | null {
  const code = meet?.trim()
  return code ? `https://meet.google.com/${code}` : null
}

/**
 * What a person pastes becomes the Meet CODE in exactly one place.
 *
 * Google Classroom copies the whole link — `https://meet.google.com/abc-defg-hij`, often
 * with `?authuser=0&hs=…` behind it, sometimes with words in front — and we keep only the
 * last part. A Meet code is three-four-three letters; when that shape is
 * anywhere in the text it wins. Otherwise the last path segment of whatever was pasted,
 * without query or hash. Null when nothing usable remains.
 */
export function parseMeetCode(input: string | null | undefined): string | null {
  const text = input?.trim() ?? ''
  if (!text) return null
  const shaped = /\b([a-z]{3}-[a-z]{4}-[a-z]{3})\b/i.exec(text)
  if (shaped) return shaped[1].toLowerCase()
  const last = text
    .replace(/[?#].*$/, '')          // query and hash carry no code
    .replace(/\/+$/, '')             // a trailing slash is not a segment
    .split('/').pop()?.trim() ?? ''
  return last && !/^https?:$/i.test(last) && !last.includes('.') ? last : null
}
