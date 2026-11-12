/**
 * query_preview: a multiple choice question with a live preview. The agent supplies a small HTML/CSS/JS
 * preview that registers basedcode.onPreview(render); the selected option is passed to render. Selecting only
 * previews (no hover, so previews of different heights can't make the options jump); Submit sends the answer.
 */

export type PreviewOption = { label: string; value?: unknown };

const escape = (value: unknown) =>
  String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

export function choicePreviewHtml(args: Record<string, unknown>): string {
  const options = (Array.isArray(args.options) ? args.options : []) as PreviewOption[];
  const data = JSON.stringify(options.map(option => ({ label: option.label, value: option.value ?? option.label })))
    .replace(/</g, '\\u003c');
  const buttons = options
    .map((option, index) => `<button type="button" role="radio" aria-checked="false" tabindex="-1" class="bc-option" data-index="${index}">${escape(option.label)}</button>`)
    .join('');
  return `<style>
.bc-query{display:grid;gap:12px}
.bc-options{display:grid;gap:6px}
.bc-option{text-align:left}
.bc-option.bc-active{outline:2px solid var(--accent, #6366f1);outline-offset:1px}
.bc-preview{border:1px dashed var(--border);border-radius:8px;padding:12px;min-height:60px;overflow:auto}
.bc-custom input{width:100%;box-sizing:border-box;font:inherit;color:var(--fg);background:var(--surface);padding:8px;border:1px solid var(--border);border-radius:6px}
.bc-custom input.bc-active{outline:2px solid var(--accent, #6366f1);outline-offset:1px}
.bc-actions{display:flex;justify-content:flex-end}
</style>
<script>
(() => {
  const listeners = [];
  let current = null;
  basedcode.onPreview = (render) => { listeners.push(render); if (current) render(current.value, current); };
  basedcode.__preview = (option) => {
    current = option;
    for (const render of listeners) { try { render(option.value, option); } catch (error) { console.error(error); } }
  };
})();
</script>
<form class="bc-query">
<label id="bc-question">${escape(args.question)}</label>
<div class="bc-options" role="radiogroup" aria-labelledby="bc-question">${buttons}</div>
<div class="bc-custom"><input name="custom" aria-label="Custom answer" placeholder="Or type your own answer" maxlength="20000"></div>
<div class="bc-preview" aria-live="polite">${String(args.preview ?? '')}</div>
<div class="bc-actions"><button type="submit" class="bc-submit">Submit</button></div>
</form>
<script>
(() => {
  const options = ${data};
  const buttons = [...document.querySelectorAll('.bc-option')];
  const form = document.querySelector('.bc-query');
  const input = form.elements.custom;
  const submit = form.querySelector('.bc-submit');
  let selected = -1;
  let done = false;
  const select = (index) => {
    if (done) return;
    selected = index;
    buttons.forEach((button, i) => {
      button.classList.toggle('bc-active', i === index);
      button.setAttribute('aria-checked', String(i === index));
      button.tabIndex = i === Math.max(index, 0) ? 0 : -1;
    });
    input.classList.toggle('bc-active', index === -1 && Boolean(input.value.trim()));
    submit.disabled = index === -1 && !input.value.trim();
    if (index >= 0) basedcode.__preview({ ...options[index], index, custom: false });
    else if (input.value.trim()) basedcode.__preview({ label: input.value, value: input.value, index: -1, custom: true });
  };
  buttons.forEach((button, index) => {
    button.addEventListener('click', () => select(index));
    button.addEventListener('keydown', (event) => {
      const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
      if (!step) return;
      event.preventDefault();
      const next = (index + step + buttons.length) % buttons.length;
      select(next);
      buttons[next].focus();
    });
  });
  input.addEventListener('input', () => select(input.value.trim() ? -1 : Math.max(selected, 0)));
  input.addEventListener('focus', () => { if (input.value.trim()) select(-1); });
  form.onsubmit = (event) => {
    event.preventDefault();
    if (done) return;
    const answer = selected >= 0 ? options[selected].label : input.value.trim();
    if (!answer) return;
    done = true;
    submit.disabled = true;
    basedcode.submit(answer);
  };
  if (options.length) select(0);
})();
</script>`;
}
