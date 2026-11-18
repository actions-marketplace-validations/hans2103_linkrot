// Built-in constants shared across linkrot.

// Regexes for URLs that are never checked.
export const BUILTIN_EXCLUDES = [
  '^https://outlook\\.(live|office)\\.com/calendar/',
  // Cloudflare e-mail obfuscation: the address is decoded in the browser, the path itself is always 404
  '/cdn-cgi/l/email-protection',
];

// Hosts (including subdomains) that block bots: 403/429/999 from them is doubt, not broken.
export const DOUBT_HOSTS = ['linkedin.com', 'facebook.com', 'instagram.com', 'x.com', 'twitter.com'];

// Reference kinds that are never reported.
export const NEVER_REPORT_KINDS = ['canonical', 'alternate', 'og'];
