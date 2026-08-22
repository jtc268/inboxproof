import fs from 'node:fs';
import path from 'node:path';

const BLOG = 'C:\\Users\\husky\\Documents\\Balto\\inboxproof\\public\\blog';
const today = new Date().toISOString().slice(0, 10);

const errors = [
  {
    slug: 'smtp-error-550-5-7-1',
    code: '550 5.7.1',
    kicker: 'Troubleshooting',
    title: 'SMTP error 550 5.7.1: what it means and how to fix it',
    metaDesc: 'SMTP error 550 5.7.1 is a permanent policy rejection. What causes it (blocklisted IP, failed SPF/DKIM/DMARC, spam content) and how to fix it.',
    intro: 'If your mail is coming back with "550 5.7.1" from Gmail or Outlook, the receiving server has permanently refused your message. It is not a network hiccup and retrying will not help. The enhanced status 5.7.1 points to a policy or security rejection, which means the server looked at where your mail came from and decided not to accept it. Here is how to find the cause and fix it.',
    meaningTitle: 'What 550 5.7.1 means',
    meaning: 'The first digit, 5, means a permanent failure: the server will not accept the message and you should not keep retrying. The enhanced code 5.7.1 is a policy or security rejection. In plain terms, the receiving provider decided your message failed a spam, authentication, or reputation check, so it rejected it before it ever reached the recipient\'s inbox.',
    causesTitle: 'The four causes you will actually hit',
    causes: [
      'Your sending IP is on a blocklist. Spamhaus, SpamCop and other real-time blocklists reject mail from listed IPs before they look at your content at all.',
      'Your domain fails authentication. A missing or broken SPF, DKIM, or DMARC record makes the message look spoofed, and large providers reject it on sight.',
      'Your content trips a spam filter. A heavy link-to-text ratio, all-caps, or obvious spam trigger words can earn a 5.7.1 even from a clean IP.',
      'You are sending from a shared or raw IP. Shared hosting IPs and unwarmed datacenter IPs are frequently flagged, so the rejection is about the IP, not you.'
    ],
    fixesTitle: 'How to fix it',
    fixes: [
      'Check your IP reputation. The free InboxProof audit checks your sending IP against major blocklists and tells you immediately if it is listed.',
      'Fix SPF, DKIM and DMARC. The audit checks all three records and shows the exact value to add or correct, so you stop the authentication failure at the source.',
      'Clean up your content. Cut the link-to-text ratio, drop the all-caps, and remove the obvious spam trigger words from the message.',
      'Move to a clean IP. If you are on shared hosting, switch to a dedicated IP or a reputable ESP that manages reputation for you.'
    ],
    related: [
      ['Gmail SMTP error 550-5.7.26', '/blog/gmail-smtp-error-550-5-7-26'],
      ['Is my domain blacklisted?', '/blog/is-my-domain-blacklisted'],
      ['SPF vs DKIM vs DMARC', '/blog/spf-dkim-dmarc'],
      ['Why email lands in spam', '/blog/email-in-spam']
    ]
  },
  {
    slug: 'smtp-error-421-4-7-0',
    code: '421 4.7.0',
    kicker: 'Troubleshooting',
    title: 'Gmail SMTP error 421 4.7.0: too many connections, how to fix it',
    metaDesc: 'Gmail SMTP error 421 4.7.0 means you are opening too many connections from one IP. How to slow down, warm up, and spread volume to stop the rate limit.',
    intro: 'If Gmail is dropping your connections with "421 4.7.0", it is rate-limiting your IP. You are opening too many SMTP connections from one address in a short window. The good news: this is a temporary failure, not a permanent block. Slow down, and the errors stop. Here is how to do that without losing volume.',
    meaningTitle: 'What 421 4.7.0 means',
    meaning: 'The first digit, 4, means a temporary failure: the connection was dropped and the server is asking you to try again later. The enhanced code 4.7.0 is a delivery rate limit. Gmail is not blocking your IP permanently; it is telling you that your address is opening too many SMTP connections at once and to back off.',
    causesTitle: 'The three causes you will actually hit',
    causes: [
      'Too many concurrent connections. Opening dozens of SMTP sessions from one IP at the same time trips Gmail\'s connection rate limit.',
      'Sending too fast. A burst of high volume in a short window looks like an attack, even when the mail is completely legitimate.',
      'A cold IP sending high volume. A brand new IP with no sending history that suddenly sends thousands of messages gets rate limited.'
    ],
    fixesTitle: 'How to fix it',
    fixes: [
      'Cap your concurrent connections. Keep the number of simultaneous SMTP sessions per IP low and let your mailer queue the rest instead of opening everything at once.',
      'Warm up the IP. Start with low volume and increase gradually over days or weeks so the reputation builds before you push hard.',
      'Spread volume across IPs. Use multiple sending IPs or domains so no single address hits the rate limit on its own.',
      'Use an ESP that manages rate limits. Reputable ESPs throttle sending automatically and rotate IPs for you, which removes the problem entirely.'
    ],
    related: [
      ['SMTP error codes explained', '/blog/smtp-error-codes'],
      ['Gmail SMTP error 550-5.7.26', '/blog/gmail-smtp-error-550-5-7-26'],
      ['Cold email deliverability', '/blog/cold-email-deliverability'],
      ['Why email lands in spam', '/blog/email-in-spam']
    ]
  },
  {
    slug: 'smtp-error-550-5-1-1',
    code: '550 5.1.1',
    kicker: 'Troubleshooting',
    title: 'SMTP error 550 5.1.1: user unknown, how to fix it',
    metaDesc: 'SMTP error 550 5.1.1 means the recipient mailbox does not exist. How to tell a hard bounce from a typo, and how to stop sending to dead addresses.',
    intro: 'If you are getting "550 5.1.1" back from Gmail or Outlook, the receiving server is saying the mailbox you are trying to reach does not exist. This is a hard bounce: the address is dead, and retrying will not help. It is usually a list problem, not a domain problem. Here is how to handle it so it stops dragging your sender reputation down.',
    meaningTitle: 'What 550 5.1.1 means',
    meaning: 'The first digit, 5, means a permanent failure. The enhanced code 5.1.1 means the mailbox you are trying to reach does not exist on the receiving server. In plain terms, the address is dead. The server has no such user, and no amount of retrying will change that.',
    causesTitle: 'The four causes you will actually hit',
    causes: [
      'A typo in the address. A missing or extra character, or the wrong domain, produces a 5.1.1 even when the person is real.',
      'The recipient left. The person changed jobs or left the company, and their mailbox was deleted.',
      'The address was never valid. The address was scraped or guessed and never actually existed.',
      'The receiving server has no such user. Even a correctly formatted address can 5.1.1 if the mailbox was removed.'
    ],
    fixesTitle: 'How to fix it',
    fixes: [
      'Verify before you send. Check each address for typos and confirm the domain is the one you intend to reach.',
      'Remove hard bounces. The moment you get a 5.1.1, drop the address from your list so you stop hitting it and inflating your bounce rate.',
      'Validate your list. Run your list through a validation tool before a campaign to catch dead addresses up front instead of after the bounce.',
      'Keep your sending domain healthy. A clean SPF, DKIM and DMARC setup means your valid recipients actually receive your mail, and the bounces you do get are real, not a configuration failure.'
    ],
    related: [
      ['SMTP error codes explained', '/blog/smtp-error-codes'],
      ['Gmail SMTP error 550-5.7.26', '/blog/gmail-smtp-error-550-5-7-26'],
      ['Why email lands in spam', '/blog/email-in-spam'],
      ['Cold email deliverability', '/blog/cold-email-deliverability']
    ]
  }
];

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

function generate(e) {
  const causes = e.causes.map((c, i) => `    <p style="margin:0 0 14px">${i + 1}. ${c}</p>`).join('\n');
  const fixes = e.fixes.map((f, i) => `    <p style="margin:0 0 14px">${i + 1}. ${f}</p>`).join('\n');
  const related = e.related.map(([label, href]) => `<a href="${href}">${label}</a>`).join(' &middot; ');
  return `<!doctype html>
<html lang="en">
<head>
<script>(function(){try{var p=location.pathname||"/";var r=(document.referrer||"").split("/")[2]||"direct";var u="/api/track?page="+encodeURIComponent(p)+"&ref="+encodeURIComponent(r);if(navigator.sendBeacon&&navigator.sendBeacon(u))return;var i=new Image();i.src=u;}catch(e){}})();</script>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(e.title)} | InboxProof</title>
<meta name="description" content="${esc(e.metaDesc)}">
<link rel="canonical" href="https://inboxproof.email/blog/${e.slug}">
<meta property="og:title" content="${esc(e.title)}">
<meta property="og:description" content="${esc(e.metaDesc)}">
<meta property="og:type" content="article">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%236366f1'/%3E%3Cpath d='M8 16h13M15 10l6 6-6 6' stroke='white' stroke-width='3' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E">
<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Article", "headline": e.title, "description": e.metaDesc, "author": { "@type": "Organization", "name": "InboxProof" }, "publisher": { "@type": "Organization", "name": "InboxProof" }, "datePublished": today, "dateModified": today })}</script>
<meta property="og:url" content="https://inboxproof.email/blog/${e.slug}">
<meta property="og:image" content="https://inboxproof.email/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:image" content="https://inboxproof.email/og.png">
</head>
<body>
<nav class="nav">
  <div class="container">
    <a class="logo" href="/">
      <span class="mark"><svg viewBox="0 0 24 24" fill="none"><path d="M4 12h11M11 7l5 5-5 5" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      Inboxproof
    </a>
    <div class="nav-links"><a href="/">Run a free audit</a></div>
  </div>
</nav>

<div class="container" style="max-width:760px;padding:60px 20px 80px">
  <div class="kicker">${e.kicker}</div>
  <h1 style="font-size:34px;margin:10px 0 12px">${esc(e.title)}</h1>
  <p style="opacity:.8;font-size:16px;margin-bottom:36px">${esc(e.intro)}</p>

  <div class="card" style="margin-bottom:28px;background:#eef2ff;border-color:#c7d2fe">
    <h3 style="margin-top:0">Check your setup in seconds</h3>
    <p style="opacity:.8;margin-bottom:14px">The <a href="/">free InboxProof audit</a> runs a 7-point check (MX, SPF, DKIM, DMARC, TLS, PTR, and IP reputation) and returns a 0-100 score with a plain-English fix list. No signup.</p>
    <a class="btn btn-primary" href="/">Run the free check</a>
  </div>

  <h2 style="font-size:24px;margin:36px 0 12px">${esc(e.meaningTitle)}</h2>
  <p>${esc(e.meaning)}</p>

  <h2 style="font-size:24px;margin:36px 0 12px">${esc(e.causesTitle)}</h2>
${causes}

  <h2 style="font-size:24px;margin:36px 0 12px">${esc(e.fixesTitle)}</h2>
${fixes}

  <div style="margin-top:24px;padding:16px;background:#f4f4ff;border-radius:12px">Want this checked automatically every day? <a href="/#pricing" style="font-weight:600">Inboxproof Pro</a> monitors your domain around the clock and alerts you the moment a record breaks or an IP gets listed. <a href="/#pricing" style="font-weight:600">See pricing &rarr;</a></div>
  <p style="opacity:.6;font-size:13px;margin-top:28px">Related: ${related}</p>
</div>

<footer>
  <div class="container">
    <span>&copy; 2026 Inboxproof, Inc.</span>
    <span><a href="/">Home</a> &middot; <a href="/privacy">Privacy</a> &middot; <a href="https://github.com/jtc268/inboxproof" target="_blank" rel="noopener">GitHub</a></span>
  </div>
</footer>
</body>
</html>
`;
}

for (const e of errors) {
  const file = path.join(BLOG, e.slug + '.html');
  fs.writeFileSync(file, generate(e));
  console.log('wrote', e.slug + '.html');
}
console.log('done, today =', today);
