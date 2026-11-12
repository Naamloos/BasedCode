import { defineMode, finalTurn } from './defineMode.js';

export default defineMode({
  id: 'teacher',
  command: 'teach',
  title: 'Teacher chat',
  label: 'Teacher mode',
  color: '#7C3AED',
  menu: 'Teacher: say "I want to learn how to do X" and the agent guides you through it with lessons and exercises, in this project or on its own',
  banner: 'Say what you want to learn. The agent finds out what you already know, then teaches step by step with explanations, small exercises and checks, using this project when it helps.',
  greetings: ['What do you want to learn today?', 'Class is in session. Topic?', 'No dumb questions. What are we learning?'],
  wrapUpNotice: 'The agent posts study notes for this lesson in this chat. The chat is locked afterwards, so you cannot send it more prompts.',
  examples: [
    {
      title: 'Learn a skill',
      hint: 'Lessons and exercises at my level',
      prompt:
        'I want to learn how to [skill]. I already know [what I know] and I want to be able to [what I want to do with it]. Teach me step by step with exercises.',
    },
    {
      title: 'Learn this codebase',
      hint: 'Its own code as the lessons',
      prompt:
        'I want to learn how this project works, using its own code as the lessons. I know [languages and frameworks]. Start with the big picture, then give me small exercises in the real code.',
    },
    {
      title: 'Learn a concept',
      hint: 'Understand it, not just copy it',
      prompt:
        'Teach me [concept]. I already understand [related things I know] but I get lost at [where it stops making sense]. Use small examples, and have me predict what they do before you show me.',
    },
    {
      title: 'Learn a library',
      hint: 'Get productive with a new tool',
      prompt:
        'I want to learn [library or tool] well enough to [what I want to build with it]. Teach me the core ideas first, then exercises, and tell me which parts I can ignore for now.',
    },
  ],
  icon: `
    <path d="M6 11.5v4.6c0 1.6 2.7 3.4 6 3.4s6-1.8 6-3.4v-4.6" fill="#7C3AED" stroke="#4C1D95" stroke-width="1" />
    <path d="M12 4 1.8 8.8 12 13.6l10.2-4.8Z" fill="#A78BFA" stroke="#4C1D95" stroke-width="1" />
    <path d="M12 8.8 19.6 10v5.4" stroke="#CA8A04" stroke-width="1.2" fill="none" />
    <path d="M18.6 15.2h2l.4 3h-2.8Z" fill="#FACC15" stroke="#CA8A04" stroke-width=".8" />
  `,
  prompt: `TEACHER MODE
The user wants to learn to do something. Success is that they understand it and can do it themselves, not that you did it for them.
- First find out what they want to learn, why, and what they already know, so you pitch it right. At most two questions per turn.
- Make a short syllabus with update_plan: small steps that build on each other.
- Each step: explain the concept with one concrete example, then set a small exercise. Use this project's code when it fits; the topic need not be tied to the project. In a plain chat, create small example files in the scratch folder.
- Let them try. Review what they wrote, explain mistakes kindly, and escalate hints gradually instead of giving the answer.
- Check understanding with a quick question before moving on, and recap the step in a line or two.
- One step per turn; no lecture dumps. Point to good official documentation for further reading.
- Have them predict before you run or reveal anything; a wrong prediction is the lesson.
- Use teach-back: ask them to explain the step in their own words, and correct the explanation rather than repeating yours.
- Bring earlier steps back in later exercises, so they recall instead of only recognizing.
- Show the common wrong way and why it fails, not just the right way.
- End the syllabus with a small capstone that combines the steps, done by them.`,
  wrapUpPrompt: `${finalTurn}
Write study notes. Reply in this chat; do not write it to a file.
Sections: What you learned · Key concepts (short explanations with examples) · Common mistakes · Practice exercises to try next · Further reading.`,
});
