/* MeToo web app (iPhone-friendly). Everything is stored on this phone only. */
'use strict';

// ------------------------------------------------------------------ helpers

const KEY_CONTACTS = 'metoo_contacts_v1';
const KEY_COMPLAINTS = 'metoo_complaints_v1';
const KEY_SETTINGS = 'metoo_settings_v1';

const $ = (sel) => document.querySelector(sel);
const view = $('#view');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    toast('Could not save on this phone. Is private browsing on?');
    return false;
  }
}

const getContacts = () => load(KEY_CONTACTS, []);
const getComplaints = () => load(KEY_COMPLAINTS, []);
const getSettings = () => load(KEY_SETTINGS, { name: '' });

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

function two(n) { return String(n).padStart(2, '0'); }

/** Normalises an Indian mobile number to +91XXXXXXXXXX where possible. */
function normalizePhone(raw) {
  const cleaned = String(raw).replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.length === 10) return '+91' + cleaned;
  if (cleaned.length === 11 && cleaned.startsWith('0')) return '+91' + cleaned.slice(1);
  if (cleaned.length === 12 && cleaned.startsWith('91')) return '+' + cleaned;
  return cleaned;
}

function isValidPhone(n) { return /^\+?[0-9]{10,14}$/.test(n); }

function isIOS() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
}

function smsUrl(numbers, body) {
  if (isIOS()) {
    return 'sms:/open?addresses=' + numbers.map(encodeURIComponent).join(',') +
      '&body=' + encodeURIComponent(body);
  }
  return 'sms:' + numbers.join(',') + '?body=' + encodeURIComponent(body);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied');
  } catch (e) {
    toast('Could not copy. Press and hold the text to copy it.');
  }
}

// ----------------------------------------------------------- emergency tools

function callFirst() {
  const contacts = getContacts();
  if (!contacts.length) {
    toast('Add a trusted contact first');
    location.hash = '#/contacts';
    return;
  }
  location.href = 'tel:' + contacts[0].phone;
}

function getPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(p),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  });
}

function buildMessage(pos) {
  const now = new Date();
  const hhmm = two(now.getHours()) + ':' + two(now.getMinutes());
  const name = (getSettings().name || '').trim();
  const sign = name ? ' - ' + name : '';
  if (!pos) {
    return 'EMERGENCY: I need help. I could not get my location. ' +
      'Please call me now. (MeToo, ' + hhmm + ')' + sign;
  }
  const lat = pos.coords.latitude.toFixed(6);
  const lng = pos.coords.longitude.toFixed(6);
  const acc = Math.round(pos.coords.accuracy || 0);
  return 'EMERGENCY: I need help. My location: https://maps.google.com/?q=' + lat + ',' + lng +
    ' (accuracy about ' + acc + ' m). Sent via MeToo at ' + hhmm + '.' + sign;
}

function openSheet(html) {
  const s = $('#sheet');
  s.innerHTML = '<div class="panel">' + html + '</div>';
  s.hidden = false;
}

function closeSheet() {
  const s = $('#sheet');
  s.hidden = true;
  s.innerHTML = '';
}

async function sendLocation() {
  const contacts = getContacts();
  if (!contacts.length) {
    toast('Add a trusted contact first');
    location.hash = '#/contacts';
    return;
  }
  openSheet('<h2>Getting your location...</h2><p class="muted">This takes a few seconds. ' +
    'If your phone asks, choose Allow.</p>');
  const pos = await getPosition();
  const message = buildMessage(pos);
  const url = smsUrl(contacts.map((c) => c.phone), message);
  openSheet(
    '<h2>' + (pos ? 'Ready to send' : 'No location found') + '</h2>' +
    (pos ? '' : '<p>Allow location for this website in your iPhone settings. ' +
      'The message below will still ask them to call you.</p>') +
    '<p class="muted">To: ' + esc(contacts.map((c) => c.name).join(', ')) + '</p>' +
    '<div class="msg">' + esc(message) + '</div>' +
    '<div class="stack">' +
      '<a class="btn" href="' + esc(url) + '">Open Messages, then press Send</a>' +
      contacts.map((c, i) => '<a class="btn alert-line" href="tel:' + esc(c.phone) + '">' +
        (i === 0 ? 'Call ' : 'No answer? Call ') + esc(c.name) + '</a>').join('') +
      '<button class="btn soft" data-act="copy-msg">Copy message</button>' +
      '<button class="btn line" data-act="close-sheet">Close</button>' +
    '</div>'
  );
  sheetMessage = message;
  // Try to open Messages straight away. The button above is the backup.
  try { location.href = url; } catch (e) { /* use the button */ }
}
let sheetMessage = '';

// ------------------------------------------------------------------- siren

let sirenAudio = null;
let sirenUrl = null;
let wakeLock = null;

function makeSirenWav() {
  const rate = 22050;
  const secs = 2;
  const n = rate * secs;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (off, str) => { for (let i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 2, true);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const f = 700 + 800 * (0.5 - 0.5 * Math.cos(2 * Math.PI * t / secs));
    phase += 2 * Math.PI * f / rate;
    let s = 0.75 * Math.sin(phase) + 0.25 * Math.sin(2 * phase);
    s = Math.max(-1, Math.min(1, s * 1.2));
    v.setInt16(44 + i * 2, Math.round(s * 32767 * 0.95), true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

async function sirenStart() {
  try {
    if (!sirenAudio) {
      sirenUrl = URL.createObjectURL(makeSirenWav());
      sirenAudio = new Audio(sirenUrl);
      sirenAudio.loop = true;
    }
    sirenAudio.volume = 1;
    await sirenAudio.play();
  } catch (e) {
    toast('Could not play the siren. Turn the volume up and try again.');
    return;
  }
  $('#siren').hidden = false;
  try {
    if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen');
  } catch (e) { /* not available: the screen may lock */ }
}

function sirenStop() {
  try { if (sirenAudio) { sirenAudio.pause(); sirenAudio.currentTime = 0; } } catch (e) {}
  try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch (e) {}
  $('#siren').hidden = true;
}

// ------------------------------------------------------------- rights data
// General information only. Have a lawyer or your university's legal aid cell
// check this text before it is shared widely.

const HELPLINES = [
  ['Emergency', '112', 'Police, ambulance, fire. Use if you are in danger now.'],
  ['Women Helpline', '181', 'Counselling, and connects you to police, legal and shelter help.'],
  ['Police: women in distress', '1091', 'Police helpline for women.'],
  ['Free legal aid (NALSA)', '15100', 'Free legal advice and a free lawyer.'],
  ['Cyber crime', '1930', 'Online harassment, blackmail, fraud. Also report at cybercrime.gov.in.'],
  ['Childline', '1098', 'If the person who needs help is under 18.'],
];

const RIGHTS = [
  ['You do not have to decide today',
    'Reporting is your choice. These steps keep your options open whatever you decide.', [
    'Get to a safe place first. Call 112 if you are in danger.',
    'Keep evidence: screenshots, messages, call logs, photos, names of witnesses. Do not delete anything.',
    'After a physical or sexual assault, a medical examination soon after helps your case. Hospitals must give free treatment to survivors of sexual assault and acid attacks. If you have already washed or changed, still go.',
    'Write down what happened with dates while you remember it. The Complaint tab keeps it private on this phone.',
    'You can speak to a counsellor or lawyer first, at no cost: call 181 or 15100.',
    'Some complaints have time limits, so do not wait a long time without checking.']],
  ['Filing a police complaint (FIR)',
    'You can ask any police station to register your complaint.', [
    'Zero FIR: if the crime happened in another area, the station must still register it and transfer it.',
    'In many states you can also file an e-FIR online, then sign it at the station within three days.',
    'For serious (cognizable) offences the police must register an FIR. Ask for a free copy.',
    'For sexual offences, you can ask for your statement to be recorded by a woman police officer, and at a place that is comfortable for you.',
    'If the police refuse, send your complaint in writing to the Superintendent of Police, or approach a Magistrate.',
    'You can bring someone you trust with you.']],
  ['Free legal help',
    'Women are entitled to free legal services under the Legal Services Authorities Act.', [
    'Call 15100 (NALSA) or visit the District Legal Services Authority (DLSA) at the district court.',
    'Ask for a panel lawyer. The lawyer is free for your case.',
    'Your university or college may also have a legal aid cell or a committee for women.']],
  ['One Stop Centres (Sakhi)',
    'Government centres that give help in one place.', [
    'Medical help, police support, legal aid, counselling and temporary shelter.',
    'Call 181 and ask to be connected to the One Stop Centre in your district.']],
  ['Harassment at work or on campus',
    'The Sexual Harassment of Women at Workplace Act (POSH), 2013 protects you at work, and UGC rules cover colleges and universities.', [
    'Every workplace with 10 or more staff, and every college or university, must have an Internal Committee.',
    'File a written complaint with the Committee. This is generally due within 3 months of the incident, and can be extended by up to 3 more months with a reason.',
    'Settlement (conciliation) can happen only if you ask for it.',
    'Your identity must be kept confidential, and you cannot be punished for complaining.',
    'You can also go to the police at the same time.']],
  ['Stalking, online abuse, leaked images',
    'Stalking, secretly recording or sharing private images, and sexual harassment are crimes.', [
    'Take screenshots showing the date, name and link. Do not delete the messages.',
    'Report at cybercrime.gov.in or call 1930. You can also report to the app or website.',
    'StopNCII.org can help stop intimate images from spreading online.',
    'Block the person only after you have saved the evidence.']],
  ['Violence at home',
    'The Protection of Women from Domestic Violence Act, 2005 protects women at home, including in live-in relationships.', [
    'You can ask a court for a protection order, the right to stay in the shared home, money for expenses, and custody orders.',
    'Contact the district Protection Officer, call 181, or go to the police.',
    'Domestic violence can also be reported to the police as cruelty.']],
  ['Your privacy',
    'The law protects survivors of sexual offences.', [
    'Publishing the name or identity of a survivor of a sexual offence is prohibited.',
    'Trials for rape cases are held in private (in camera).',
    'Ask the police, hospital and committee to keep your details confidential.']],
];

// ------------------------------------------------------------------- views

function renderHome() {
  const contacts = getContacts();
  const needContacts = contacts.length === 0;
  const needInstall = isIOS() && !isStandalone();
  view.innerHTML =
    '<h2>Welcome</h2>' +
    '<p>MeToo helps you reach the people you trust, quickly. Here is how to set it up and use it.</p>' +

    (needContacts
      ? '<div class="card warn"><h3>Finish setup</h3>' +
        '<p>You have not added a trusted contact yet.</p>' +
        '<a class="btn" href="#/contacts">Add a trusted contact</a></div>'
      : '') +
    (needInstall
      ? '<div class="card warn"><h3>Add MeToo to your Home Screen</h3>' +
        '<p>In Safari, tap the Share button, then <b>Add to Home Screen</b>. ' +
        'Do this first, then add your contacts inside the new MeToo icon.</p>' +
        '<a class="btn soft" href="#/settings">Show me how</a></div>'
      : '') +

    '<h3>In an emergency</h3>' +
    '<button class="btn alert big" data-act="send-location">SOS: alert my contacts</button>' +
    '<div class="grid actions">' +
      '<a class="btn soft" href="tel:112">Call 112</a>' +
      (getSettings().siren ? '<button class="btn soft" data-act="siren-start">Siren</button>' : '') +
    '</div>' +
    '<div class="card"><h3>What the SOS button does</h3><ol class="steps">' +
      '<li><b>Location message</b>Finds your location and opens a message to ALL your contacts. Press Send.</li>' +
      '<li><b>Calls</b>Then call your first contact. If they do not pick up, call the next one in the list.</li>' +
    '</ol></div>' +
    '<p class="muted">An iPhone cannot call or text by itself: you confirm each call and press Send. ' +
    'Open MeToo with a double tap on the back of your iPhone (Settings tab) to get here fast.</p>' +

    '<h3>Set up (once)</h3>' +
    '<ol class="steps">' +
      '<li><b>Add your trusted contacts</b>Open the Contacts tab. The first one is the person the Call button rings.</li>' +
      '<li><b>Add MeToo to your Home Screen</b>Safari > Share > Add to Home Screen. Then open MeToo from that icon.</li>' +
      '<li><b>Allow location</b>The first time you press Send my location, choose Allow. Choose "Allow While Using App".</li>' +
      '<li><b>Quick access (optional)</b>Settings has steps to open MeToo by double-tapping the back of your iPhone.</li>' +
    '</ol>' +

    '<div class="card beige"><p>MeToo is a student prototype. Test it with your own numbers first. ' +
    'In real danger, call 112.</p></div>' +
    '<a class="btn line" href="#/settings">Settings</a>';
}

function renderContacts() {
  const contacts = getContacts();
  view.innerHTML =
    '<h2>Trusted contacts</h2>' +
    '<p class="muted">The first contact is the one the Call button rings. ' +
    '"Send my location" writes to everyone on this list.</p>' +
    '<form data-form="add-contact" class="card">' +
      '<label for="c-name">Name</label>' +
      '<input id="c-name" name="name" autocomplete="off" required>' +
      '<label for="c-phone">Phone number</label>' +
      '<input id="c-phone" name="phone" type="tel" inputmode="tel" autocomplete="off" placeholder="98765 43210" required>' +
      '<div style="margin-top:14px"><button class="btn" type="submit">Add contact</button></div>' +
    '</form>' +
    (contacts.length
      ? '<ul class="list">' + contacts.map((c, i) =>
          '<li><span class="num">' + (i + 1) + '</span>' +
          '<div class="grow"><b>' + esc(c.name) + '</b><span>' + esc(c.phone) + '</span></div>' +
          '<div class="row-actions">' +
            '<button data-act="c-up" data-i="' + i + '"' + (i === 0 ? ' disabled' : '') + ' aria-label="Move up">Up</button>' +
            '<button data-act="c-down" data-i="' + i + '"' + (i === contacts.length - 1 ? ' disabled' : '') + ' aria-label="Move down">Down</button>' +
            '<button class="del" data-act="c-del" data-i="' + i + '" aria-label="Delete">Delete</button>' +
          '</div></li>').join('') + '</ul>'
      : '<p class="muted">No contacts yet.</p>');
}

function complaintShareText(c) {
  const d = new Date(c.createdAt);
  const saved = d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) +
    ' ' + two(d.getHours()) + ':' + two(d.getMinutes());
  return [
    'Complaint record (MeToo)',
    'Saved on: ' + saved,
    'When it happened: ' + (c.when || 'not stated'),
    'Place: ' + (c.place || 'not stated'),
    'What happened: ' + c.details,
    'Person(s) involved: ' + (c.accused || 'not stated'),
    'Contact number: ' + (c.contactPhone || 'not given'),
  ].join('\n');
}

function renderComplaint(arg) {
  const all = getComplaints().slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (arg === 'new') {
    view.innerHTML =
      '<h2>New complaint record</h2>' +
      '<p class="muted">Private. Kept only on this phone. Nothing is sent anywhere.</p>' +
      '<form data-form="add-complaint" class="card">' +
        '<label for="k-when">When it happened</label><input id="k-when" name="when" placeholder="Date and time, as best you remember">' +
        '<label for="k-place">Place</label><input id="k-place" name="place">' +
        '<label for="k-details">What happened</label><textarea id="k-details" name="details" required></textarea>' +
        '<label for="k-accused">Person(s) involved</label><input id="k-accused" name="accused">' +
        '<label for="k-phone">Your contact number</label><input id="k-phone" name="contactPhone" type="tel" inputmode="tel">' +
        '<div style="margin-top:14px" class="grid">' +
          '<a class="btn line" href="#/complaint">Cancel</a>' +
          '<button class="btn" type="submit">Save</button>' +
        '</div>' +
      '</form>';
    return;
  }
  if (arg) {
    const c = all.find((x) => x.id === arg);
    if (!c) { location.hash = '#/complaint'; return; }
    const f = (label, val) => '<div class="field-view"><b>' + label + '</b><span class="pre">' + esc(val || 'not stated') + '</span></div>';
    view.innerHTML =
      '<h2>Complaint record</h2>' +
      '<div class="card">' +
        f('Saved on', new Date(c.createdAt).toLocaleString()) +
        f('When it happened', c.when) + f('Place', c.place) + f('What happened', c.details) +
        f('Person(s) involved', c.accused) + f('Contact number', c.contactPhone) +
      '</div>' +
      '<div class="grid">' +
        '<button class="btn" data-act="k-share" data-id="' + esc(c.id) + '">Share</button>' +
        '<button class="btn soft" data-act="k-copy" data-id="' + esc(c.id) + '">Copy text</button>' +
      '</div>' +
      '<button class="btn danger" data-act="k-del" data-id="' + esc(c.id) + '">Delete this record</button>' +
      '<p><a href="#/complaint">Back to the list</a></p>';
    return;
  }
  view.innerHTML =
    '<h2>Complaint log</h2>' +
    '<p class="muted">Write down what happened while you remember it. Private, saved only on this phone. ' +
    'It is not a police complaint. See the Rights tab for how to file one.</p>' +
    '<a class="btn" href="#/complaint/new">New record</a>' +
    (all.length
      ? '<ul class="list">' + all.map((c) =>
          '<li><div class="grow"><b>' + esc(c.when || 'Date not stated') + '</b>' +
          '<span>' + esc((c.details || '').slice(0, 70)) + (c.details && c.details.length > 70 ? '...' : '') + '</span></div>' +
          '<a class="btn small soft" href="#/complaint/' + esc(c.id) + '">Open</a></li>').join('') + '</ul>'
      : '<p class="muted">No records yet.</p>');
}

function renderRights() {
  view.innerHTML =
    '<h2>Your rights and helplines</h2>' +
    '<p class="muted">General information, not legal advice. For your own case, ask a lawyer ' +
    'or call free legal aid on 15100.</p>' +
    '<div class="card">' + HELPLINES.map((h) =>
      '<div class="helpline"><div><b>' + esc(h[0]) + '</b><small>' + esc(h[2]) + '</small></div>' +
      '<a class="btn small n" href="tel:' + esc(h[1]) + '">' + esc(h[1]) + '</a></div>').join('') + '</div>' +
    RIGHTS.map((r) =>
      '<details><summary>' + esc(r[0]) + '</summary><p>' + esc(r[1]) + '</p><ul>' +
      r[2].map((p) => '<li>' + esc(p) + '</li>').join('') + '</ul></details>').join('');
}

function renderSettings() {
  const s = getSettings();
  const here = location.href.split('#')[0];
  view.innerHTML =
    '<h2>Settings</h2>' +
    '<div class="card"><h3>Your name (optional)</h3>' +
      '<p class="muted">Added at the end of the location message, so your contacts know who it is from.</p>' +
      '<input id="s-name" value="' + esc(s.name) + '" autocomplete="name" placeholder="Your name"></div>' +

    '<div class="card"><h3>Add MeToo to your Home Screen</h3>' +
      '<ol class="steps">' +
        '<li>Open this page in <b>Safari</b> (it does not work from other browsers).</li>' +
        '<li>Tap the <b>Share</b> button at the bottom of the screen.</li>' +
        '<li>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>' +
        '<li>Open MeToo from the new icon, then add your contacts there. Contacts added inside Safari do not move to the icon.</li>' +
      '</ol></div>' +

    '<div class="card"><h3>Open MeToo with a double tap on the back of your iPhone</h3>' +
      '<ol class="steps">' +
        '<li>Open the <b>Shortcuts</b> app > <b>+</b> > add the action <b>Open URLs</b>.</li>' +
        '<li>Paste this address as the URL:<div class="url">' + esc(here) + '</div>' +
          '<button class="btn small soft" style="margin-top:8px" data-act="copy-url">Copy address</button></li>' +
        '<li>Name the shortcut "MeToo" and save it.</li>' +
        '<li>Go to iPhone <b>Settings > Accessibility > Touch > Back Tap</b>. Choose <b>Double Tap</b> and pick the MeToo shortcut.</li>' +
      '</ol>' +
      '<p class="muted">Back Tap needs iPhone 8 or newer. It opens MeToo; you still press the button you need.</p></div>' +

    '<div class="card"><h3>Siren</h3>' +
      '<label class="switch-row"><span>Show a Siren button on the Home page</span>' +
      '<input type="checkbox" id="s-siren"' + (s.siren ? ' checked' : '') + '></label>' +
      '<p class="muted">Off by default. Turn the volume up first. The siren plays only while MeToo is open.</p>' +
      '<button class="btn soft" data-act="siren-start">Test siren</button></div>' +

    '<div class="card"><h3>Your data</h3>' +
      '<p class="muted">Contacts and complaint records are stored only on this phone.</p>' +
      '<button class="btn danger" data-act="wipe">Delete all my data</button></div>' +

    '<p class="muted">MeToo is a student prototype. Test it with your own numbers first. In real danger, call 112.</p>';
  const sirenBox = $('#s-siren');
  if (sirenBox) {
    sirenBox.addEventListener('change', () => {
      save(KEY_SETTINGS, Object.assign(getSettings(), { siren: sirenBox.checked }));
    });
  }
  const nameInput = $('#s-name');
  if (nameInput) {
    nameInput.addEventListener('input', () => {
      save(KEY_SETTINGS, Object.assign(getSettings(), { name: nameInput.value }));
    });
  }
}

// ------------------------------------------------------------------ router

function route() {
  const parts = (location.hash || '#/home').replace(/^#\/?/, '').split('/');
  const name = parts[0] || 'home';
  const arg = parts[1];
  const map = {
    home: renderHome, contacts: renderContacts, complaint: renderComplaint,
    rights: renderRights, settings: renderSettings,
  };
  (map[name] || renderHome)(arg);
  document.querySelectorAll('.tabs a').forEach((a) => {
    a.classList.toggle('on', a.dataset.tab === name || (!map[name] && a.dataset.tab === 'home'));
  });
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);

// ---------------------------------------------------------------- actions

const actions = {
  'call-first': () => callFirst(),
  'send-location': () => sendLocation(),
  'siren-start': () => sirenStart(),
  'siren-stop': () => sirenStop(),
  'close-sheet': () => closeSheet(),
  'copy-msg': () => copyText(sheetMessage),
  'copy-url': () => copyText(location.href.split('#')[0]),

  'c-up': (el) => moveContact(+el.dataset.i, -1),
  'c-down': (el) => moveContact(+el.dataset.i, 1),
  'c-del': (el) => {
    const list = getContacts();
    const c = list[+el.dataset.i];
    if (!c || !confirm('Delete ' + c.name + '?')) return;
    list.splice(+el.dataset.i, 1);
    save(KEY_CONTACTS, list);
    renderContacts();
  },

  'k-share': async (el) => {
    const c = getComplaints().find((x) => x.id === el.dataset.id);
    if (!c) return;
    const text = complaintShareText(c);
    if (navigator.share) {
      try { await navigator.share({ text }); } catch (e) { /* cancelled */ }
    } else {
      copyText(text);
    }
  },
  'k-copy': (el) => {
    const c = getComplaints().find((x) => x.id === el.dataset.id);
    if (c) copyText(complaintShareText(c));
  },
  'k-del': (el) => {
    if (!confirm('Delete this record? This cannot be undone.')) return;
    save(KEY_COMPLAINTS, getComplaints().filter((x) => x.id !== el.dataset.id));
    location.hash = '#/complaint';
  },

  'wipe': () => {
    if (!confirm('Delete all contacts and complaint records on this phone?')) return;
    try {
      localStorage.removeItem(KEY_CONTACTS);
      localStorage.removeItem(KEY_COMPLAINTS);
      localStorage.removeItem(KEY_SETTINGS);
    } catch (e) { /* ignore */ }
    toast('All data deleted');
    location.hash = '#/home';
    route();
  },
};

function moveContact(i, delta) {
  const list = getContacts();
  const j = i + delta;
  if (j < 0 || j >= list.length) return;
  const tmp = list[i]; list[i] = list[j]; list[j] = tmp;
  save(KEY_CONTACTS, list);
  renderContacts();
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = actions[el.dataset.act];
  if (fn) fn(el, e);
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  if (form.dataset.form === 'add-contact') {
    const name = (data.name || '').trim();
    const phone = normalizePhone(data.phone || '');
    if (!name) return toast('Enter a name');
    if (!isValidPhone(phone)) return toast('That phone number does not look right');
    const list = getContacts();
    if (list.some((c) => c.phone === phone)) return toast('That number is already on the list');
    list.push({ name, phone });
    if (save(KEY_CONTACTS, list)) { toast('Contact added'); renderContacts(); }
  } else if (form.dataset.form === 'add-complaint') {
    const details = (data.details || '').trim();
    if (!details) return toast('Write what happened');
    const list = getComplaints();
    list.push({
      id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
      createdAt: new Date().toISOString(),
      when: (data.when || '').trim(),
      place: (data.place || '').trim(),
      details,
      accused: (data.accused || '').trim(),
      contactPhone: (data.contactPhone || '').trim(),
    });
    if (save(KEY_COMPLAINTS, list)) { toast('Saved on this phone'); location.hash = '#/complaint'; }
  }
});

// Close the bottom sheet when the dark area is tapped.
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });

// Keep the screen awake if the page comes back while the siren plays.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && !$('#siren').hidden && navigator.wakeLock) {
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* ignore */ }
  }
});

route();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* works online without it */ });
  });
}
