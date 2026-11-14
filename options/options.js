const DEFAULTS = {
  autoLog: true,
  threshold: 65,
  geminiKey: '',
  youtubeKey: '',
  model: 'gemini-2.5-flash',
  channels: 'raghvtalkz: tech, AI tools, career tips in Telugu/Tenglish\nentri-coding-telugu: coding and IT jobs for Telugu students',
};
const $ = (id) => document.getElementById(id);

(async () => {
  const { settings = {} } = await chrome.storage.local.get('settings');
  const s = { ...DEFAULTS, ...settings };
  $('autoLog').checked = s.autoLog;
  $('threshold').value = s.threshold;
  $('geminiKey').value = s.geminiKey;
  $('youtubeKey').value = s.youtubeKey;
  $('model').value = s.model;
  $('channels').value = s.channels;
})();

$('save').addEventListener('click', async () => {
  const settings = {
    autoLog: $('autoLog').checked,
    threshold: Math.min(100, Math.max(50, Number($('threshold').value) || 65)),
    geminiKey: $('geminiKey').value.trim(),
    youtubeKey: $('youtubeKey').value.trim(),
    model: $('model').value.trim() || DEFAULTS.model,
    channels: $('channels').value.trim(),
  };
  await chrome.storage.local.set({ settings });
  $('status').textContent = 'Saved ✓';
  setTimeout(() => { $('status').textContent = ''; }, 1500);
});

$('testYt').addEventListener('click', () => {
  const key = $('youtubeKey').value.trim();
  if (!key) { $('ytStatus').textContent = 'Key pettandi.'; return; }
  $('ytStatus').textContent = 'Checking…';
  chrome.runtime.sendMessage({ type: 'yt-key-test', key }, (r) => {
    $('ytStatus').textContent = r?.ok ? '✓ Key work avutundi. Save click cheyandi.' : '✗ ' + (r?.error || 'fail');
  });
});
