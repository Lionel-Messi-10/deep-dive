const PACK_KEY = 'krillion-party-pack';
const DRAFT_KEY = 'krillion-party-draft';
const TEAM_KEY = 'krillion-party-teams';

const DEFAULT_CATEGORIES = [
  { id: 'plankton', name: 'Plankton', points: 10, color: '#afbdcb' },
  { id: 'too-clever', name: 'Too Clever', points: 15, color: '#ffb16b' },
  { id: 'schooler', name: 'Schooler', points: 30, color: '#79cfdf' },
  { id: 'rare', name: 'Rare', points: 60, color: '#6af0bb' },
  { id: 'deep-cut', name: 'Deep Cut', points: 85, color: '#c49aff' },
  { id: 'krillion', name: 'One in a Krillion', points: 100, color: '#ff5896' },
];

const TEAM_COLORS = ['#79cfdf', '#ff5896', '#ffb16b', '#6af0bb', '#c49aff', '#f4d77b', '#7eb6ff', '#ff8f6b'];

const app = typeof document !== 'undefined' ? document.getElementById('app') : null;

let pack = null;
let draft = null;
let teams = [];
let selected = 0;
let dirty = false;
let run = null;
let toastTimer = 0;
let audioCtx = null;
let focusSel = null;

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function normalize(s) {
  return String(s ?? '').normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
}

function safeColor(c, fallback = '#8dc8e5') {
  return /^#[0-9a-f]{6}$/i.test(c) ? c : fallback;
}

function uid(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function blankPack() {
  return {
    format: 'deep-dive',
    version: 2,
    title: 'Verbal Krillion',
    description: 'Call it out. Rarer answers sink deeper.',
    seconds: 10000,
    categories: clone(DEFAULT_CATEGORIES),
    questions: Array.from({ length: 7 }, () => ({ prompt: '', answers: [] })),
  };
}

function defaultTeams() {
  return [
    { id: 't1', name: 'Team 1', color: TEAM_COLORS[0] },
    { id: 't2', name: 'Team 2', color: TEAM_COLORS[1] },
  ];
}

function migrate(input) {
  if (!input || input.format !== 'deep-dive' || ![1, 2].includes(input.version)) {
    throw new Error('This is not a supported Deep Dive pack.');
  }
  const p = clone(input);
  if (p.version === 1) {
    p.categories = clone(DEFAULT_CATEGORIES);
    if (!Array.isArray(p.questions)) throw new Error('Questions must be a list.');
    for (const q of p.questions) {
      if (!Array.isArray(q.answers)) throw new Error('Answers must be a list.');
      for (const a of q.answers) {
        if (!Number.isInteger(a.points) || a.points < 0 || a.points > 100) {
          throw new Error('Invalid points in the older pack.');
        }
        let cat = p.categories.find((c) => c.points === a.points);
        if (!cat) {
          cat = { id: 'legacy-' + a.points, name: a.points + ' points', points: a.points, color: '#9bacc5' };
          p.categories.push(cat);
        }
        a.category = cat.id;
        delete a.points;
      }
    }
    p.version = 2;
  }
  return p;
}

function cleanPack(input) {
  const p = migrate(input);
  if (typeof p.title !== 'string' || !p.title.trim() || p.title.length > 120) {
    throw new Error('Add a title (up to 120 characters).');
  }
  if (typeof p.description !== 'string' || p.description.length > 2000) {
    throw new Error('Keep the description under 2,000 characters.');
  }
  if (!Number.isInteger(p.seconds) || p.seconds < 5 || p.seconds > 100000) {
    throw new Error('Set a whole-number time limit from 5 to 100000 seconds.');
  }
  if (!Array.isArray(p.categories) || p.categories.length < 1 || p.categories.length > 50) {
    throw new Error('Include 1–50 scoring categories.');
  }
  const ids = new Set();
  const names = new Set();
  const categories = p.categories.map((c) => {
    if (typeof c.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(c.id) || ids.has(c.id)) {
      throw new Error('Category IDs must be unique.');
    }
    if (typeof c.name !== 'string' || !c.name.trim() || c.name.length > 60 || names.has(normalize(c.name))) {
      throw new Error('Give each category a unique name, up to 60 characters.');
    }
    if (!Number.isInteger(c.points) || c.points < 0 || c.points > 10000) {
      throw new Error('Category points must be whole numbers from 0 to 10,000.');
    }
    ids.add(c.id);
    names.add(normalize(c.name));
    return { id: c.id, name: c.name.trim(), points: c.points, color: safeColor(c.color) };
  });
  if (!Array.isArray(p.questions) || p.questions.length < 1 || p.questions.length > 100) {
    throw new Error('Include 1–100 questions.');
  }
  const questions = p.questions.map((q, i) => {
    const label = 'Question ' + (i + 1);
    if (typeof q.prompt !== 'string' || !q.prompt.trim() || q.prompt.length > 500) {
      throw new Error(label + ': add a prompt under 500 characters.');
    }
    if (!Array.isArray(q.answers) || q.answers.length > 1000) {
      throw new Error(label + ': include at most 1,000 answers.');
    }
    const seen = new Set();
    const answers = q.answers.map((a) => {
      if (typeof a.text !== 'string' || !a.text.trim() || a.text.length > 150) {
        throw new Error(label + ': each answer needs a name under 150 characters.');
      }
      if (!ids.has(a.category)) throw new Error(label + ': choose a category for every answer.');
      const aliases = Array.isArray(a.aliases) ? a.aliases : [];
      if (aliases.length > 30 || aliases.some((s) => typeof s !== 'string' || !s.trim() || s.length > 150)) {
        throw new Error(label + ': invalid alternate spellings.');
      }
      for (const s of [a.text, ...aliases].map(normalize)) {
        if (seen.has(s)) throw new Error(label + ': "' + s + '" belongs to more than one answer.');
        seen.add(s);
      }
      return { text: a.text.trim(), category: a.category, aliases: aliases.map((s) => s.trim()) };
    });
    return { prompt: q.prompt.trim(), answers };
  });
  return {
    format: 'deep-dive',
    version: 2,
    title: p.title.trim(),
    description: p.description,
    seconds: p.seconds,
    categories,
    questions,
  };
}

function nextActive(teamIds, fromIndex, outSet) {
  const n = teamIds.length;
  for (let step = 1; step <= n; step++) {
    const i = (fromIndex + step) % n;
    if (!outSet.has(teamIds[i])) return i;
  }
  return null;
}

function markerTop(score, maxScore) {
  if (maxScore <= 0) return 8;
  return 8 + (score / maxScore) * 68;
}

function placeWord(n) {
  const suffix = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (suffix[(v - 20) % 10] || suffix[v] || suffix[0]);
}

function rankTeams(list) {
  const sorted = list.slice().sort((a, b) => b.score - a.score || a.order - b.order);
  let rank = 0;
  let prev = null;
  return sorted.map((team, index) => {
    if (prev === null || team.score !== prev) rank = index + 1;
    prev = team.score;
    return { ...team, rank };
  });
}

function toast(message) {
  if (typeof document === 'undefined') return;
  const el = document.getElementById('toast');
  clearTimeout(toastTimer);
  el.textContent = message;
  el.hidden = false;
  toastTimer = setTimeout(() => { el.hidden = true; }, 4200);
}

function chime(points) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = audioCtx || new Ctx();
    audioCtx.resume();
    const max = Math.max(1, ...pack.categories.map((c) => c.points));
    const notes = [220, 330, points / max > 0.8 ? 880 : 550];
    notes.forEach((freq, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      const t = audioCtx.currentTime + i * 0.08;
      o.type = i === 2 ? 'triangle' : 'sine';
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start(t);
      o.stop(t + 0.3);
    });
  } catch { /* sound is optional */ }
}

function loadPack() {
  try {
    const raw = localStorage.getItem(PACK_KEY);
    if (!raw) return blankPack();
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.questions) || !Array.isArray(data.categories)) return blankPack();
    return data;
  } catch {
    return blankPack();
  }
}

function loadTeams() {
  try {
    const data = JSON.parse(localStorage.getItem(TEAM_KEY));
    if (!Array.isArray(data)) return defaultTeams();
    const cleaned = data.filter((t) => t && typeof t.id === 'string' && typeof t.name === 'string').slice(0, 8);
    if (!cleaned.length) return defaultTeams();
    const seen = new Set();
    return cleaned.map((t, i) => {
      let id = seen.has(t.id) ? uid('t') : t.id;
      seen.add(id);
      return { id, name: t.name.slice(0, 40), color: safeColor(t.color, TEAM_COLORS[i % TEAM_COLORS.length]) };
    });
  } catch {
    return defaultTeams();
  }
}

function saveTeams() {
  localStorage.setItem(TEAM_KEY, JSON.stringify(teams));
}

function saveDraft() {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

function readiness() {
  if (!pack.questions.length) return 'Add a question in Edit game.';
  const missing = pack.questions.map((q, i) => (String(q.prompt || '').trim() ? null : i + 1)).filter(Boolean);
  if (missing.length) return 'Add prompts for question ' + missing.join(', ') + ' before you begin.';
  return pack.questions.length + ' prompts · answers are called out · you award the category';
}

function renderHome() {
  const status = readiness();
  app.innerHTML = `<section class="shell">
    <header class="masthead">
      <div class="eyebrow">Host console</div>
      <h1>VERBAL KRILLION</h1>
      <div class="subtitle">RARER ANSWERS SINK DEEPER</div>
      <p class="lede">${esc(pack.title)} · ${esc(status)}</p>
      ${localStorage.getItem(DRAFT_KEY) ? '<p class="help">Edit game still has unsaved changes.</p>' : ''}
    </header>
    <section class="panel">
      <div class="spread">
        <h2>Teams</h2>
        <span class="help">${teams.length} / 8</span>
      </div>
      <p class="help">Add the teams in circle order. Question 1 starts at the top of the list, and each later question starts one seat further around.</p>
      <ol class="team-list">
        ${teams.map((t, i) => `<li class="team-row">
          <input type="color" aria-label="Color for team ${i + 1}" data-bind="team-color" data-i="${i}" value="${safeColor(t.color)}">
          <input type="text" maxlength="40" aria-label="Team ${i + 1} name" data-bind="team-name" data-i="${i}" value="${esc(t.name)}">
          <button type="button" class="move" data-act="team-up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move team ${i + 1} up">↑</button>
          <button type="button" class="move" data-act="team-down" data-i="${i}" ${i === teams.length - 1 ? 'disabled' : ''} aria-label="Move team ${i + 1} down">↓</button>
          <button type="button" data-act="remove-team" data-i="${i}">Remove</button>
        </li>`).join('')}
      </ol>
      <form class="add-row" id="addTeamForm">
        <input id="newTeam" type="text" maxlength="40" placeholder="New team name" aria-label="New team name" ${teams.length >= 8 ? 'disabled' : ''}>
        <button type="submit" ${teams.length >= 8 ? 'disabled' : ''}>Add team</button>
      </form>
    </section>
    <button type="button" class="primary begin" data-act="begin">Begin the circle</button>
    <div class="row" style="margin-top:12px">
      <button type="button" data-act="edit">Edit game</button>
      <button type="button" data-act="import">Import pack</button>
      <button type="button" data-act="export">Export pack</button>
      <input id="importFile" type="file" accept="application/json,.json" hidden>
    </div>
  </section>`;
}

function openEditor() {
  const raw = localStorage.getItem(DRAFT_KEY);
  if (raw) {
    try {
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.questions) && Array.isArray(data.categories)) {
        draft = data;
        toast('Restored unsaved workshop edits.');
      } else draft = clone(pack);
    } catch {
      draft = clone(pack);
    }
  } else {
    draft = clone(pack);
  }
  selected = Math.min(selected, Math.max(0, draft.questions.length - 1));
  dirty = Boolean(raw);
  renderEditor();
}

function renderEditor() {
  const q = draft.questions[selected];
  app.innerHTML = `<section class="shell">
    <div class="spread">
      <div>
        <div class="eyebrow">Workshop</div>
        <h2>Prompts and score tiers</h2>
      </div>
      <div class="row">
        <button type="button" class="primary" data-act="save">Save</button>
        <button type="button" data-act="export-draft">Export pack</button>
        <button type="button" class="quiet" data-act="discard">Back</button>
      </div>
    </div>
    <div class="panel fields">
      <label><span>Title</span><input type="text" maxlength="120" data-bind="title" value="${esc(draft.title)}"></label>
      <label><span>Description</span><textarea maxlength="2000" data-bind="description">${esc(draft.description)}</textarea></label>
      <label><span>Time limit (seconds)</span>
        <input type="number" min="5" max="100000" step="1" data-bind="seconds" value="${draft.seconds ?? ''}">
      </label>
      <p class="help">The host paces the room. This number is stored with the pack, from 5 to 100000, and the circle stays open until every team has passed.</p>
    </div>
    <section class="panel">
      <h2>Scoring categories</h2>
      <p class="help">Rarer tiers are worth more points. 1 point sinks the team 10 metres.</p>
      ${draft.categories.map((c, i) => `<div class="cat-row">
        <input type="color" aria-label="Color for category ${i + 1}" data-bind="cat-color" data-i="${i}" value="${safeColor(c.color)}">
        <input type="text" maxlength="60" aria-label="Name for category ${i + 1}" data-bind="cat-name" data-i="${i}" value="${esc(c.name)}">
        <input type="number" min="0" max="10000" step="1" aria-label="Points for category ${i + 1}" data-bind="cat-points" data-i="${i}" value="${Number.isFinite(c.points) ? c.points : ''}">
        <button type="button" data-act="delete-cat" data-i="${i}" aria-label="Remove category ${i + 1}">Remove</button>
      </div>`).join('')}
      <button type="button" data-act="add-cat" style="margin-top:8px">Add category</button>
    </section>
    <section class="panel">
      <div class="spread"><h2>Questions</h2><span class="help">${draft.questions.length} prompts</span></div>
      <div class="qtabs">
        ${draft.questions.map((item, i) => `<button type="button" class="qtab ${i === selected ? 'active' : ''}" data-act="select-q" data-i="${i}">${i + 1}. ${esc(item.prompt || 'Untitled')}</button>`).join('')}
      </div>
      <div class="row" style="margin:10px 0">
        <button type="button" data-act="add-q">Add question</button>
        <button type="button" data-act="q-up" ${selected === 0 ? 'disabled' : ''}>Move up</button>
        <button type="button" data-act="q-down" ${selected === draft.questions.length - 1 ? 'disabled' : ''}>Move down</button>
        <button type="button" data-act="delete-q">Delete question</button>
      </div>
      <label><span>Prompt ${selected + 1}</span><textarea maxlength="500" data-bind="prompt">${esc(q.prompt)}</textarea></label>
      <p class="help">Listed answers are optional. When a called answer matches the list, that category lights up for you to confirm.</p>
      <div id="answerRows">
        ${q.answers.map((a, i) => `<div class="answer-row">
          <input type="text" maxlength="150" placeholder="Answer" aria-label="Answer ${i + 1}" data-bind="answer-text" data-i="${i}" value="${esc(a.text)}">
          <select aria-label="Category for answer ${i + 1}" data-bind="answer-cat" data-i="${i}">
            ${draft.categories.map((c) => `<option value="${esc(c.id)}" ${c.id === a.category ? 'selected' : ''}>${esc(c.name || 'Unnamed')} · ${Number.isFinite(c.points) ? c.points : '?'} pts</option>`).join('')}
          </select>
          <input type="text" placeholder="Aliases, comma separated" aria-label="Aliases for answer ${i + 1}" data-bind="answer-alias" data-i="${i}" value="${esc((a.aliases || []).join(', '))}">
          <button type="button" data-act="delete-a" data-i="${i}">Remove</button>
        </div>`).join('')}
      </div>
      <button type="button" data-act="add-a" style="margin-top:8px">Add answer</button>
    </section>
  </section>`;
  if (focusSel) {
    const el = document.querySelector(focusSel);
    focusSel = null;
    el?.focus();
  }
}

function refreshSelects() {
  document.querySelectorAll('[data-bind="answer-cat"]').forEach((sel) => {
    const current = sel.value;
    sel.innerHTML = draft.categories.map((c) => `<option value="${esc(c.id)}">${esc(c.name || 'Unnamed')} · ${Number.isFinite(c.points) ? c.points : '?'} pts</option>`).join('');
    if (draft.categories.some((c) => c.id === current)) sel.value = current;
  });
}

function onDraftInput(target) {
  const bind = target.dataset.bind;
  const i = Number(target.dataset.i);
  dirty = true;
  if (bind === 'title') draft.title = target.value;
  else if (bind === 'description') draft.description = target.value;
  else if (bind === 'seconds') draft.seconds = target.value === '' ? null : Number(target.value);
  else if (bind === 'cat-name') {
    draft.categories[i].name = target.value;
    refreshSelects();
  } else if (bind === 'cat-points') {
    draft.categories[i].points = target.value === '' ? null : Number(target.value);
    refreshSelects();
  } else if (bind === 'cat-color') draft.categories[i].color = target.value;
  else if (bind === 'prompt') {
    draft.questions[selected].prompt = target.value;
    const tab = document.querySelector(`.qtab[data-i="${selected}"]`);
    if (tab) tab.textContent = (selected + 1) + '. ' + (target.value || 'Untitled');
  } else if (bind === 'answer-text') draft.questions[selected].answers[i].text = target.value;
  else if (bind === 'answer-cat') draft.questions[selected].answers[i].category = target.value;
  else if (bind === 'answer-alias') {
    draft.questions[selected].answers[i].aliases = target.value.split(',').map((s) => s.trim()).filter(Boolean);
  }
  saveDraft();
}

function blankAnswer() {
  const cat = draft.categories.find((c) => c.id === 'schooler') || draft.categories[0];
  return { text: '', category: cat ? cat.id : '', aliases: [] };
}

function saveEditor() {
  const prepared = clone(draft);
  if (prepared.seconds === null) {
    toast('Set a whole-number time limit from 5 to 100000 seconds.');
    return;
  }
  for (const q of prepared.questions) {
    q.answers = (q.answers || []).filter((a) => String(a.text || '').trim() || (a.aliases || []).length);
  }
  try {
    pack = cleanPack(prepared);
  } catch (error) {
    toast(error.message);
    return;
  }
  localStorage.setItem(PACK_KEY, JSON.stringify(pack));
  localStorage.removeItem(DRAFT_KEY);
  dirty = false;
  draft = null;
  toast('Game saved.');
  renderHome();
}

function discardEditor() {
  if (dirty && !confirm('Discard workshop edits?')) return;
  localStorage.removeItem(DRAFT_KEY);
  dirty = false;
  draft = null;
  renderHome();
}

function downloadPack(data) {
  let cleaned;
  try {
    cleaned = cleanPack(data);
  } catch (error) {
    toast(error.message);
    return;
  }
  const slug = cleaned.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'krillion';
  const blob = new Blob([JSON.stringify(cleaned, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = slug + '.deepdive.json';
  link.click();
  URL.revokeObjectURL(link.href);
}

function importFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      pack = cleanPack(JSON.parse(String(reader.result)));
      localStorage.setItem(PACK_KEY, JSON.stringify(pack));
      localStorage.removeItem(DRAFT_KEY);
      draft = null;
      dirty = false;
      toast('Pack imported.');
      renderHome();
    } catch (error) {
      toast(error.message || 'Could not import that file.');
    }
  };
  reader.readAsText(file);
}

function teamNamesOk() {
  const names = teams.map((t) => normalize(t.name));
  if (teams.length < 2) return 'Add at least two teams.';
  if (teams.length > 8) return 'Eight teams is the limit.';
  if (names.some((n) => !n)) return 'Every team needs a name.';
  if (new Set(names).size !== names.length) return 'Give each team a different name.';
  return '';
}

function begin() {
  const nameError = teamNamesOk();
  if (nameError) return toast(nameError);
  try {
    pack = cleanPack(pack);
  } catch (error) {
    toast(error.message);
    return;
  }
  localStorage.setItem(PACK_KEY, JSON.stringify(pack));
  saveTeams();
  startGame();
}

function startGame() {
  run = {
    questionIndex: 0,
    scores: Object.fromEntries(teams.map((t) => [t.id, 0])),
    byQuestion: pack.questions.map(() => Object.fromEntries(teams.map((t) => [t.id, 0]))),
    phase: 'play',
    out: new Set(),
    given: new Set(),
    events: [],
    turnIndex: 0,
  };
  startQuestion();
}

function startQuestion() {
  run.phase = 'play';
  run.out = new Set();
  run.given = new Set();
  run.events = [];
  run.turnIndex = run.questionIndex % teams.length;
  renderPlay();
}

function maxScore() {
  return Math.max(0, ...teams.map((t) => run.scores[t.id] || 0));
}

function oceanHTML(settled) {
  const max = maxScore();
  return `<div class="ocean-wrap">
    <div class="depth-axis" aria-hidden="true"><span>Surface</span><span>Deeper</span></div>
    <div class="ocean ${settled ? 'settled' : ''}" id="ocean">
      ${teams.map((t) => {
        const score = run.scores[t.id] || 0;
        const top = markerTop(score, max);
        const active = !settled && run.phase === 'play' && teams[run.turnIndex].id === t.id;
        const out = !settled && run.phase === 'play' && run.out.has(t.id);
        return `<div class="lane ${active ? 'active' : ''} ${out ? 'out' : ''}" data-team="${esc(t.id)}" data-score="${score}" style="--team:${safeColor(t.color)}">
          <div class="lane-name">${esc(t.name)}</div>
          <div class="sea">
            <div class="marker" style="top:${top}%">
              <div class="bath" style="background:${safeColor(t.color)}"></div>
              <div class="marker-score"><span class="pts">${score.toLocaleString()} pts</span><br><span class="metres">${(score * 10).toLocaleString()} m</span></div>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function cribHTML(question) {
  if (!question.answers.length) return '';
  const groups = pack.categories.slice().sort((a, b) => b.points - a.points).map((cat) => {
    const list = question.answers.filter((a) => a.category === cat.id).slice().sort((a, b) => a.text.localeCompare(b.text));
    if (!list.length) return '';
    return `<section class="crib-group"><h3 style="color:${safeColor(cat.color)}">${esc(cat.name)} · ${cat.points}</h3><ul>${list.map((a) => `<li>${esc(a.text)}</li>`).join('')}</ul></section>`;
  }).join('');
  return `<details class="crib"><summary>Listed answers</summary>${groups}</details>`;
}

function renderPlay() {
  const q = pack.questions[run.questionIndex];
  const last = run.questionIndex >= pack.questions.length - 1;
  app.innerHTML = `<section class="play">
    <div class="play-head">
      <div class="eyebrow">Prompt ${run.questionIndex + 1} of ${pack.questions.length}</div>
      <button type="button" class="quiet" data-act="leave">Leave game</button>
    </div>
    <h1 class="prompt">${esc(q.prompt)}</h1>
    ${cribHTML(q)}
    ${oceanHTML(false)}
    <div class="console">
      <div id="liveConsole">
        <div class="eyebrow">Up now</div>
        <div class="up-name" id="turnName"></div>
        <ul class="circle" id="pills"></ul>
        <input id="answer" type="text" maxlength="150" autocomplete="off" spellcheck="false" placeholder="What they called out (optional)" aria-label="Called answer" data-bind="answer">
        <p class="hint" id="hint"></p>
        <div class="host-actions">
          <button type="button" class="pass" data-act="pass">Can't answer</button>
          <div class="cats" id="cats">
            ${pack.categories.map((c) => `<button type="button" class="cat" data-act="award" data-cat="${esc(c.id)}" style="--c:${safeColor(c.color)}">
              <span class="cat-name">${esc(c.name)}</span><span class="cat-pts">${c.points}</span>
            </button>`).join('')}
          </div>
        </div>
        <div class="row">
          <button type="button" id="undoBtn" data-act="undo">Undo</button>
        </div>
        <ul class="log" id="log"></ul>
      </div>
      <div id="recapConsole" hidden>
        <div class="eyebrow">Question closed</div>
        <h2>Everyone's dry.</h2>
        <p class="help" id="recapLine"></p>
        <div class="row">
          <button type="button" class="primary" data-act="next">${last ? 'Final leaderboard' : 'Next prompt'}</button>
          <button type="button" data-act="undo">Undo last pass</button>
        </div>
      </div>
    </div>
  </section>`;
  syncPlay();
}

function teamById(id) {
  return teams.find((t) => t.id === id);
}

function logLine(ev) {
  const name = teamById(ev.teamId)?.name || 'Team';
  if (ev.type === 'pass') return esc(name) + ' passed';
  const cat = pack.categories.find((c) => c.id === ev.categoryId);
  const said = ev.answerText ? ' "' + esc(ev.answerText) + '"' : '';
  return esc(name) + said + ' · ' + esc(cat ? cat.name : 'Score') + ' +' + ev.points;
}

function syncOcean() {
  const ocean = document.getElementById('ocean');
  if (!ocean) return;
  const settled = run.phase !== 'play';
  ocean.classList.toggle('settled', settled);
  const max = maxScore();
  for (const team of teams) {
    const lane = ocean.querySelector(`[data-team="${CSS.escape(team.id)}"]`);
    if (!lane) continue;
    const score = run.scores[team.id] || 0;
    lane.classList.toggle('active', !settled && teams[run.turnIndex].id === team.id);
    lane.classList.toggle('out', !settled && run.out.has(team.id));
    lane.dataset.score = String(score);
    const marker = lane.querySelector('.marker');
    marker.style.top = markerTop(score, max) + '%';
    lane.querySelector('.pts').textContent = score.toLocaleString() + ' pts';
    lane.querySelector('.metres').textContent = (score * 10).toLocaleString() + ' m';
  }
}

function splashScore(teamId, text, color) {
  const marker = document.querySelector(`#ocean [data-team="${CSS.escape(teamId)}"] .marker`);
  if (!marker) return;
  const el = document.createElement('div');
  el.className = 'floater';
  el.style.color = color;
  el.textContent = text;
  marker.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

function matchAnswer(text, question) {
  const n = normalize(text);
  if (!n) return null;
  return question.answers.find((a) => [a.text, ...(a.aliases || [])].some((s) => normalize(s) === n)) || null;
}

function answerKeys(text, question) {
  const norm = normalize(text);
  if (!norm) return [];
  const match = matchAnswer(text, question);
  if (!match) return [norm];
  return [...new Set([match.text, ...(match.aliases || [])].map(normalize))];
}

function refreshHint() {
  const input = document.getElementById('answer');
  const hint = document.getElementById('hint');
  if (!input || !hint || run.phase !== 'play') return;
  const text = input.value.trim();
  const question = pack.questions[run.questionIndex];
  const keys = answerKeys(text, question);
  const dup = keys.some((key) => run.given.has(key));
  const match = !dup && text ? matchAnswer(text, question) : null;
  document.querySelectorAll('#cats [data-act="award"]').forEach((btn) => {
    btn.disabled = dup;
    btn.classList.toggle('suggested', Boolean(match && btn.dataset.cat === match.category));
  });
  if (dup) hint.textContent = 'Already scored this question.';
  else if (match) {
    const cat = pack.categories.find((c) => c.id === match.category);
    hint.textContent = 'Listed answer · ' + cat.name + ' · ' + cat.points + ' pts';
  } else if (text) hint.textContent = 'No listed match. Pick the category.';
  else hint.textContent = 'Pick a category, or mark that this team can\'t answer.';
}

function syncPlay() {
  syncOcean();
  const live = document.getElementById('liveConsole');
  const recap = document.getElementById('recapConsole');
  if (!live || !recap) return;
  const playing = run.phase === 'play';
  live.hidden = !playing;
  recap.hidden = playing;
  if (!playing) {
    const bits = teams.map((t) => t.name + ' +' + (run.byQuestion[run.questionIndex][t.id] || 0));
    document.getElementById('recapLine').textContent = bits.join(' · ');
    return;
  }
  const team = teams[run.turnIndex];
  const name = document.getElementById('turnName');
  name.textContent = team.name;
  name.style.color = safeColor(team.color);
  document.getElementById('pills').innerHTML = teams.map((t, i) => {
    const out = run.out.has(t.id);
    const on = i === run.turnIndex;
    return `<li class="${out ? 'out' : ''} ${on ? 'on' : ''}" style="--team:${safeColor(t.color)}">${esc(t.name)}${out ? ' · out' : ''}</li>`;
  }).join('');
  document.getElementById('undoBtn').disabled = run.events.length === 0;
  document.getElementById('log').innerHTML = run.events.map((ev) => `<li>${logLine(ev)}</li>`).join('');
  const input = document.getElementById('answer');
  input.value = '';
  refreshHint();
}

function award(categoryId) {
  if (!run || run.phase !== 'play') return;
  const input = document.getElementById('answer');
  const text = input ? input.value.trim() : '';
  const question = pack.questions[run.questionIndex];
  const norms = answerKeys(text, question);
  if (norms.some((key) => run.given.has(key))) {
    toast('That answer was already scored this question.');
    return;
  }
  const cat = pack.categories.find((c) => c.id === categoryId);
  if (!cat) return;
  const team = teams[run.turnIndex];
  run.events.push({
    type: 'award',
    teamId: team.id,
    turnIndex: run.turnIndex,
    points: cat.points,
    categoryId: cat.id,
    answerText: text,
    norms,
  });
  run.scores[team.id] += cat.points;
  run.byQuestion[run.questionIndex][team.id] += cat.points;
  for (const key of norms) run.given.add(key);
  run.turnIndex = nextActive(teams.map((t) => t.id), run.turnIndex, run.out);
  chime(cat.points);
  syncOcean();
  splashScore(team.id, '+' + cat.points, safeColor(cat.color));
  syncPlay();
}

function passTeam() {
  if (!run || run.phase !== 'play') return;
  const team = teams[run.turnIndex];
  run.events.push({ type: 'pass', teamId: team.id, turnIndex: run.turnIndex });
  run.out.add(team.id);
  const next = nextActive(teams.map((t) => t.id), run.turnIndex, run.out);
  if (next == null) run.phase = 'recap';
  else run.turnIndex = next;
  syncPlay();
}

function undo() {
  if (!run || !run.events.length) return;
  const ev = run.events.pop();
  if (ev.type === 'award') {
    run.scores[ev.teamId] -= ev.points;
    run.byQuestion[run.questionIndex][ev.teamId] -= ev.points;
    for (const key of ev.norms || []) run.given.delete(key);
  } else {
    run.out.delete(ev.teamId);
  }
  run.turnIndex = ev.turnIndex;
  run.phase = 'play';
  syncPlay();
}

function nextStep() {
  if (!run || run.phase !== 'recap') return;
  if (run.questionIndex >= pack.questions.length - 1) {
    run.phase = 'results';
    renderResults();
    return;
  }
  run.questionIndex += 1;
  startQuestion();
}

function winnerSentence(ranked) {
  const top = ranked[0].score;
  const names = ranked.filter((t) => t.score === top).map((t) => t.name);
  if (names.length === 1) return names[0] + ' sank the deepest.';
  if (names.length === 2) return names[0] + ' and ' + names[1] + ' sank the deepest.';
  return names.slice(0, -1).join(', ') + ', and ' + names[names.length - 1] + ' sank the deepest.';
}

function renderResults() {
  const ranked = rankTeams(teams.map((t, order) => ({
    id: t.id, name: t.name, color: t.color, score: run.scores[t.id] || 0, order,
  })));
  app.innerHTML = `<section class="results">
    <div class="eyebrow">${esc(pack.title)}</div>
    <h1>Final depths</h1>
    <p class="winner">${esc(winnerSentence(ranked))}</p>
    <p class="help">Lower on the ocean is a higher score. The list below is ranked from the deepest team.</p>
    ${oceanHTML(true)}
    <div class="board-wrap panel">
      <table class="board">
        <thead><tr>
          <th>Place</th><th>Team</th><th>Points</th><th>Depth</th>
          ${pack.questions.map((_, i) => `<th>Q${i + 1}</th>`).join('')}
        </tr></thead>
        <tbody>
          ${ranked.map((t) => `<tr class="${t.rank === ranked[0].rank ? 'champ' : ''}">
            <td class="place">${placeWord(t.rank)}</td>
            <td>${esc(t.name)}</td>
            <td>${t.score.toLocaleString()}</td>
            <td>${(t.score * 10).toLocaleString()} m</td>
            ${pack.questions.map((_, i) => `<td>${run.byQuestion[i][t.id] || 0}</td>`).join('')}
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="row" style="margin-top:16px">
      <button type="button" class="primary" data-act="again">Play again</button>
      <button type="button" data-act="home">Teams</button>
    </div>
  </section>`;
  const ocean = document.querySelector('.ocean-wrap');
  if (ocean) ocean.classList.add('ocean-results');
}

function addTeam() {
  if (teams.length >= 8) return toast('Eight teams is the limit.');
  const input = document.getElementById('newTeam');
  const name = input.value.trim();
  if (!name) return toast('Type a team name.');
  if (teams.some((t) => normalize(t.name) === normalize(name))) return toast('Give each team a different name.');
  const used = new Set(teams.map((t) => t.color.toLowerCase()));
  const color = TEAM_COLORS.find((c) => !used.has(c.toLowerCase())) || TEAM_COLORS[teams.length % TEAM_COLORS.length];
  teams.push({ id: uid('t'), name, color });
  saveTeams();
  renderHome();
}

function onClick(event) {
  const btn = event.target.closest('[data-act]');
  if (!btn || btn.disabled) return;
  const act = btn.dataset.act;
  const i = Number(btn.dataset.i);
  if (act === 'begin') return begin();
  if (act === 'edit') return openEditor();
  if (act === 'import') return document.getElementById('importFile').click();
  if (act === 'export') return downloadPack(pack);
  if (act === 'export-draft') return downloadPack(prepareDraft(draft));
  if (act === 'save') return saveEditor();
  if (act === 'discard') return discardEditor();
  if (act === 'add-team') return;
  if (act === 'remove-team') {
    teams.splice(i, 1);
    saveTeams();
    renderHome();
    return;
  }
  if (act === 'team-up' && i > 0) {
    [teams[i - 1], teams[i]] = [teams[i], teams[i - 1]];
    saveTeams();
    renderHome();
    return;
  }
  if (act === 'team-down' && i < teams.length - 1) {
    [teams[i + 1], teams[i]] = [teams[i], teams[i + 1]];
    saveTeams();
    renderHome();
    return;
  }
  if (act === 'select-q') {
    selected = i;
    renderEditor();
    return;
  }
  if (act === 'add-q') {
    if (draft.questions.length >= 100) return toast('Maximum 100 questions.');
    draft.questions.push({ prompt: '', answers: [] });
    selected = draft.questions.length - 1;
    dirty = true;
    saveDraft();
    focusSel = '[data-bind="prompt"]';
    renderEditor();
    return;
  }
  if (act === 'delete-q') {
    if (draft.questions.length === 1) return toast('Keep at least one question.');
    if (!confirm('Delete this question?')) return;
    draft.questions.splice(selected, 1);
    selected = Math.min(selected, draft.questions.length - 1);
    dirty = true;
    saveDraft();
    renderEditor();
    return;
  }
  if (act === 'q-up' && selected > 0) {
    [draft.questions[selected - 1], draft.questions[selected]] = [draft.questions[selected], draft.questions[selected - 1]];
    selected -= 1;
    dirty = true;
    saveDraft();
    renderEditor();
    return;
  }
  if (act === 'q-down' && selected < draft.questions.length - 1) {
    [draft.questions[selected + 1], draft.questions[selected]] = [draft.questions[selected], draft.questions[selected + 1]];
    selected += 1;
    dirty = true;
    saveDraft();
    renderEditor();
    return;
  }
  if (act === 'add-a') {
    if (draft.questions[selected].answers.length >= 1000) return toast('Maximum 1,000 answers per question.');
    draft.questions[selected].answers.push(blankAnswer());
    dirty = true;
    saveDraft();
    focusSel = '#answerRows .answer-row:last-child input';
    renderEditor();
    return;
  }
  if (act === 'delete-a') {
    draft.questions[selected].answers.splice(i, 1);
    dirty = true;
    saveDraft();
    renderEditor();
    return;
  }
  if (act === 'add-cat') {
    if (draft.categories.length >= 50) return toast('Maximum 50 categories.');
    let n = 1;
    while (draft.categories.some((c) => normalize(c.name) === normalize('Custom ' + n))) n += 1;
    draft.categories.push({ id: uid('custom'), name: 'Custom ' + n, points: 100, color: '#f4d77b' });
    dirty = true;
    saveDraft();
    focusSel = '.cat-row:last-child [data-bind="cat-name"]';
    renderEditor();
    return;
  }
  if (act === 'delete-cat') {
    if (draft.categories.length === 1) return toast('Keep at least one category.');
    const id = draft.categories[i].id;
    const used = draft.questions.some((q) => q.answers.some((a) => a.category === id && String(a.text || '').trim()));
    if (used) return toast('That category is still used by an answer.');
    draft.categories.splice(i, 1);
    const fallback = draft.categories[0].id;
    for (const q of draft.questions) {
      for (const a of q.answers) if (a.category === id) a.category = fallback;
    }
    dirty = true;
    saveDraft();
    renderEditor();
    return;
  }
  if (act === 'award') return award(btn.dataset.cat);
  if (act === 'pass') return passTeam();
  if (act === 'undo') return undo();
  if (act === 'next') return nextStep();
  if (act === 'again') return startGame();
  if (act === 'home') {
    run = null;
    renderHome();
    return;
  }
  if (act === 'leave') {
    if (!confirm('Leave this game? Scores so far will be cleared.')) return;
    run = null;
    renderHome();
  }
}

function prepareDraft(source) {
  const prepared = clone(source);
  for (const q of prepared.questions || []) {
    q.answers = (q.answers || []).filter((a) => String(a.text || '').trim() || (a.aliases || []).length);
  }
  return prepared;
}

function onInput(event) {
  const target = event.target;
  const bind = target.dataset.bind;
  if (!bind) return;
  if (bind === 'team-name') {
    teams[Number(target.dataset.i)].name = target.value;
    saveTeams();
    return;
  }
  if (bind === 'team-color') {
    teams[Number(target.dataset.i)].color = target.value;
    saveTeams();
    return;
  }
  if (bind === 'answer') {
    refreshHint();
    return;
  }
  if (draft) onDraftInput(target);
}

function onSubmit(event) {
  if (event.target.id !== 'addTeamForm') return;
  event.preventDefault();
  addTeam();
}

function onChange(event) {
  if (event.target.id === 'importFile' && event.target.files[0]) {
    importFile(event.target.files[0]);
    event.target.value = '';
  }
}

function boot() {
  pack = loadPack();
  teams = loadTeams();
  app.addEventListener('click', onClick);
  app.addEventListener('input', onInput);
  app.addEventListener('submit', onSubmit);
  app.addEventListener('change', onChange);
  renderHome();
}

if (typeof document !== 'undefined') boot();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { cleanPack, migrate, nextActive, markerTop, rankTeams, placeWord, normalize, blankPack };
}
