// Text into HTML: the four characters that would otherwise be markup. One escaper for the mailers that write HTML by
// hand (the rehearsal's three mails and the texting preference block they carry).
export const esc = (v: unknown): string =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
