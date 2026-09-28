// Settings: account & sync, focus, floating widget, tracking, collections, data.
import { $, esc, toast, confirmBox, downloadJson, pickFile, send, applyAccent } from '../../lib/ui.js';
import { getSettings, setSettings, resetSettings, get, set } from '../../lib/store.js';
import { account, signOut, exportAll, importAll, configured } from '../../lib/sync.js';

export async function mount(el) {
  const cfg = await getSettings();
  const acc = await account();
  el.innerHTML = `
    <form class="settings" id="f">
      <fieldset class="span2"><legend>Account</legend>
        <div class="row">
          ${acc?.local ? '<span class="chip warn">Local only - data stays on this device</span>' : `<span>Signed in as <b>${esc(acc?.email || '')}</b></span>`}
          <span class="sp"></span><span class="small muted" id="last"></span>
          ${acc?.local ? '' : '<button type="button" id="sync">Sync now</button>'}
          <button type="button" class="ghost" id="out">${acc?.local ? 'Switch to Google sign-in' : 'Sign out'}</button>
        </div>
        <p class="small faint">Your spaces, collections, tasks, settings and history are saved in a private app folder in your own Google Drive (only Sumi can see it) and merged across your computers. Nothing is sent to anyone else.</p>
      </fieldset>

      <fieldset><legend>Focus timer</legend>
        <label>Focus <input type="number" name="focusMin" min="1" max="240"> min</label>
        <label>Short break <input type="number" name="shortMin" min="1" max="60"> min</label>
        <label>Long break <input type="number" name="longMin" min="1" max="120"> min</label>
        <label>Long break every <input type="number" name="longEvery" min="2" max="10"> sessions</label>
        <label>Daily focus goal <input type="number" name="dailyGoalMin" min="10" max="900"> min</label>
        <label class="ck"><input type="checkbox" name="autoStartBreak"> Start breaks automatically</label>
        <label class="ck"><input type="checkbox" name="autoStartFocus"> Start focus automatically after a break</label>
      </fieldset>

      <fieldset><legend>Floating timer &amp; stopwatch</legend>
        <label class="ck"><input type="checkbox" name="showWidget"> Show on every page while running (drag it anywhere)</label>
        <label>Hide on these sites (one per line)</label>
        <textarea name="widgetExcluded" rows="3" placeholder="e.g. meet.google.com"></textarea>
        <button type="button" class="ghost small" id="reset-pos">Reset widget position</button>
      </fieldset>

      <fieldset><legend>Blocking during focus</legend>
        <label class="ck"><input type="checkbox" name="blockDuringFocus"> Block these sites while a focus session runs</label>
        <textarea name="blocked" rows="5"></textarea>
      </fieldset>

      <fieldset><legend>Time tracking</legend>
        <label class="ck"><input type="checkbox" name="trackUsage"> Track time spent per website</label>
        <label>Idle after <input type="number" name="idleSec" min="15" max="900"> seconds without input</label>
        <label>Never track (one per line)</label>
        <textarea name="excluded" rows="3" placeholder="e.g. mybank.com"></textarea>
      </fieldset>

      <fieldset><legend>Collections &amp; tabs</legend>
        <label>Open saved tabs in <select name="openCardIn"><option value="new">a new tab</option><option value="current">the current tab</option></select></label>
        <label class="ck"><input type="checkbox" name="closeAfterSave"> Close tabs after saving a window</label>
        <label>Tabs are stale after <input type="number" name="staleDays" min="1" max="90"> days</label>
      </fieldset>

      <fieldset><legend>Look</legend>
        <label class="ck"><input type="checkbox" name="clock24"> 24-hour clock</label>
        <label>Accent colour <input type="color" name="accent"></label>
      </fieldset>

      <fieldset class="span2"><legend>Data</legend>
        <div class="row">
          <button type="button" id="export">Export full backup</button>
          <button type="button" id="import">Import backup</button>
          <span class="sp"></span>
          <button type="button" class="danger" id="reset">Reset settings</button>
        </div>
        <p class="small faint">Shortcuts: <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> popup · <kbd>P</kbd> timer · <kbd>W</kbd> stopwatch · <kbd>K</kbd> save window. Change them at chrome://extensions/shortcuts.</p>
      </fieldset>
    </form>`;

  const form = $('#f');
  for (const [k, v] of Object.entries(cfg)) {
    const e = form.elements[k];
    if (!e) continue;
    if (e.type === 'checkbox') e.checked = !!v; else e.value = Array.isArray(v) ? v.join('\n') : v;
  }
  const last = await get('lastSync', 0);
  $('#last').textContent = acc?.local ? '' : last ? `Synced ${new Date(last).toLocaleString()}` : 'Not synced yet';

  form.addEventListener('change', async e => {
    const el2 = e.target;
    if (!el2.name) return;
    let v = el2.type === 'checkbox' ? el2.checked : el2.type === 'number' ? Number(el2.value) : el2.value;
    if (el2.tagName === 'TEXTAREA') v = v.split(/[\n,]/).map(s => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')).filter(Boolean);
    const next = await setSettings({ [el2.name]: v });
    if (el2.name === 'accent') applyAccent(next.accent);
    toast('Saved');
  });
  $('#reset-pos').onclick = async () => { await set('widgetPos', null); toast('Widget moved back to the corner'); };
  $('#sync')?.addEventListener('click', async () => {
    $('#last').textContent = 'Syncing…';
    const r = await send({ type: 'sync' });
    $('#last').textContent = r.ok ? `Synced ${new Date().toLocaleString()}` : r.error;
  });
  $('#out').onclick = async () => {
    if (acc?.local) { if (!configured()) return toast('This build has no Google client ID yet - see README'); await set('account', null); return; }
    if (await confirmBox('Sign out?', 'Your data stays in your Google Drive and on this computer. Sign in again to keep syncing.', 'Sign out')) await signOut();
  };
  $('#export').onclick = async () => downloadJson(`sumi-backup-${new Date().toISOString().slice(0, 10)}.json`, await exportAll());
  $('#import').onclick = async () => {
    const t = await pickFile('.json,application/json');
    if (!t) return;
    try { await importAll(JSON.parse(t)); toast('Backup imported'); setTimeout(() => location.reload(), 600); } catch (e) { toast(e.message); }
  };
  $('#reset').onclick = async () => { if (await confirmBox('Reset all settings?', 'Your collections, tasks and history are kept.', 'Reset')) { await resetSettings(); location.reload(); } };
}
