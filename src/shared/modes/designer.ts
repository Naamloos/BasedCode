import { defineMode, finalTurn } from './defineMode.js';

export default defineMode({
  id: 'designer',
  command: 'design',
  title: 'Designer chat',
  label: 'Designer mode',
  color: '#EC4899',
  menu: 'Designer: the agent interviews you about a new website or app (purpose, colors, theme, rounding, style, fonts) with interactive pickers and writes a design specification',
  banner:
    'Describe the site or app you have in mind. The agent asks one question at a time, with color, font and rounding pickers, and turns your answers into a design specification.',
  greetings: ['What are we designing today?', 'New app, new look. Tell me about it.', "Let's pick some vibes. What's the project?"],
  wrapUpNotice:
    'The agent writes the final design specification to a file and summarizes it here. The chat is locked afterwards, so you cannot send it more prompts.',
  examples: [
    {
      title: 'Design a new website',
      hint: 'An interview from scratch',
      prompt:
        'I want to design a new website for [what or who]. Its visitors are [audience] and it should feel [three adjectives]. Interview me and write the design spec.',
    },
    {
      title: 'Design an app',
      hint: 'A dashboard, tool or web app',
      prompt:
        'I want to design a web app that [what it does] for [who uses it]. The main screens are [screens]. Interview me about how it should look and behave, and write the design spec.',
    },
    {
      title: 'Landing page',
      hint: 'One page that sells something',
      prompt:
        'I need a landing page for [product]. The one thing visitors should do is [call to action]. Sites I like: [links or names]. Help me design it.',
    },
    {
      title: 'Restyle this project',
      hint: 'A new look for the existing app',
      prompt:
        'Look at the current styling of this project first: its colors, fonts, spacing and components. Tell me what you would keep, then help me design a new look that feels [three adjectives].',
    },
  ],
  icon: `
    <path d="M12 2.5C6.5 2.5 2.5 6.6 2.5 11.6c0 5 4 8.9 8.8 8.9 1.4 0 2.1-.8 2.1-1.8 0-1.3-1.2-1.6-1.2-2.8 0-1 .8-1.6 1.9-1.6h2.4c3.2 0 5-2.2 5-5.2C21.5 6.1 17.4 2.5 12 2.5Z" fill="#FBCFE8" stroke="#9D174D" stroke-width="1" />
    <circle cx="7.4" cy="11.6" r="1.6" fill="#EF4444" />
    <circle cx="9.4" cy="7.2" r="1.6" fill="#F59E0B" />
    <circle cx="14.2" cy="6.4" r="1.6" fill="#22C55E" />
    <circle cx="17.6" cy="9.6" r="1.6" fill="#3B82F6" />
  `,
  prompt: `DESIGNER MODE
Interview the user about a new website or app and turn the answers into a design specification complete enough to build from. Their taste decides; you make sure nothing is missing. Do not build the site here.
- One question per turn, then wait. Use the pickers instead of text questions: query_choice for options, query_preview when options are visual (layouts, styles, themes: selecting one renders it live), query_yes_no, query_color for every color, query_font for every font, query_radius for rounding, query_slider for sizes and spacing, query_ui for anything visual the others cannot show (two layout sketches, button styles). Pre-fill each with suggestions that fit the earlier answers.
- Cover in this order, skipping what does not apply:
  1. Product: what it is, purpose, audience, main pages or screens, the feeling it should give (three adjectives).
  2. Inspiration: sites or brands they like or dislike; existing brand assets.
  3. Theme: light, dark or both (default, or follow the system).
  4. Colors: primary, accent, background, surface, text, success, warning, error; for both themes if there are two. Flag text/background pairs below WCAG AA (4.5:1) and offer a fix.
  5. Typography: fonts for headings, body, UI and code; type scale and weights.
  6. Shape and style: rounding, borders, shadows and depth, overall style (minimal, flat, glass, brutalist, playful, corporate, retro, ...), spacing density, icon style.
  7. Layout: navigation, page width, grid, header and footer, mobile behavior.
  8. Components and motion: buttons, inputs, cards, key components; animation and transition style.
  9. Extras: imagery, accessibility, internationalization, must-haves.
- Every few answers, recap in a couple of lines and show the choices so far with render_ui (colors, fonts and rounding on a sample card and button), so they can correct course early.
- When the interview is done or the user asks, write the spec to a Markdown file (design-spec.md by default) with exact values (hex, font names and weights, sizes, radii) and CSS custom property names for the tokens. Ask before overwriting a file.
- Restyling an existing project: read its current styles and tokens first and say what you would keep, so the spec is a migration rather than a rewrite.
- Ask about real content: sample headlines, the longest label, and whether there is real imagery; a design that only works with ideal text is not done.
- Specify every state, not just the default: hover, focus, active, disabled, loading, empty, error and success.
- Cover accessibility as part of the design: visible focus ring, touch target size, reduced motion, and not relying on color alone.
- Capture voice and tone in a few words (how buttons, errors and empty states are worded); it is part of the look.
- Before writing the spec, show one full preview with render_ui that combines every choice, and let them change anything.`,
  wrapUpPrompt: `${finalTurn}
Write or update the specification as a Markdown file in the workspace (design-spec.md unless it already has another name). Sections: Overview (product, audience, feeling) · Theme · Color palette (hex per theme, contrast notes) · Typography (fonts per element, scale, weights) · Shape and style · Layout · Components · Motion · Extras · Design tokens (CSS custom properties) · Open questions. Then reply here with a short summary and a link to the file.`,
});
