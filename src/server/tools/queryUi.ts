import { colorPickerHtml, fontPickerHtml, radiusPickerHtml } from './designPickers.js';
import { inlineUiDocument } from './inlineUi.js';
import { choicePreviewHtml } from './choicePreview.js';

export function queryDocument(
  name: string,
  args: Record<string, unknown>,
  origin = '',
  files: Record<string, string> = {},
): string {
  if (name === 'query_ui')
    return inlineUiDocument(String(args.html), Array.isArray(args.libraries) ? (args.libraries as string[]) : [], origin, files);
  if (name === 'query_preview')
    return inlineUiDocument(choicePreviewHtml(args), Array.isArray(args.libraries) ? (args.libraries as string[]) : [], origin);
  if (name === 'query_color') return inlineUiDocument(colorPickerHtml(args));
  if (name === 'query_font') return inlineUiDocument(fontPickerHtml(args));
  if (name === 'query_radius') return inlineUiDocument(radiusPickerHtml(args));
  const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
  let control = '<input name="answer" required maxlength="20000" placeholder="' + escape(args.placeholder) + '">';
  if (name === 'query_yes_no') control = '<button type="button" onclick="basedcode.submit(true)">Yes</button> <button type="button" onclick="basedcode.submit(false)">No</button>';
  if (name === 'query_choice') control = '<div style="display:grid;gap:8px">' + (args.options as string[]).map((option, index) => '<button type="button" style="text-align:left" onclick="basedcode.submit(options[' + index + '])">' + escape(option) + '</button>').join('') + '<button type="button" style="text-align:left" onclick="const custom=document.getElementById(\'custom-response\');custom.hidden=false;custom.querySelector(\'input\').focus()">Custom answer</button></div><div id="custom-response" hidden><input name="custom" aria-label="Custom answer" placeholder="Type your answer" maxlength="20000" required><button type="submit">Submit</button></div>';
  if (name === 'query_slider') control = '<input name="answer" type="range" aria-label="Value" min="' + escape(args.min) + '" max="' + escape(args.max) + '" step="' + escape(args.step ?? 1) + '" value="' + escape(args.value ?? args.min) + '" oninput="this.nextElementSibling.value=this.value"><output>' + escape(args.value ?? args.min) + '</output>';
  const options = JSON.stringify(args.options ?? []).replace(/</g, '\\u003c');
  const submit = name === 'query_choice'
    ? 'basedcode.submit(form.elements.custom.value);'
    : 'basedcode.submit(' + (name === 'query_slider' ? 'Number(form.elements.answer.value)' : 'form.elements.answer.value') + ');';
  return inlineUiDocument('<style>form{display:grid;gap:12px}input,select{font:inherit;color:var(--fg);background:var(--surface);padding:8px;border:1px solid var(--border);border-radius:6px}#custom-response:not([hidden]){display:grid;gap:8px}#custom-response input{box-sizing:border-box;width:100%;min-width:0}input[type=range]{padding:0;width:100%}</style><form><label>' + escape(args.question) + '</label>' + control + (name === 'query_yes_no' || name === 'query_choice' ? '' : '<button type="submit">Submit</button>') + '</form><script>const options=' + options + '; document.querySelector("form").onsubmit=event=>{event.preventDefault();const form=event.target;' + submit + '};</script>');
}
